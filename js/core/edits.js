import * as M from './model.js';
import { msg } from './messages.js';
import { PICKLISTS, parseCellInput, validateBranch, validateExercise } from './schema.js';

/**
 * @typedef {import('./model.js').Dataset} Dataset
 * @typedef {import('./model.js').Exercise} Exercise
 * @typedef {import('./model.js').Target} Target
 * @typedef {import('./model.js').Violation} Violation
 * @typedef {import('./model.js').Result} Result
 * @typedef {{ seq: number, group: number, at: string, target: Target,
 *   op: 'set' | 'delete' | 'addRecord' | 'removeRecord', path: string[], oldValue: unknown,
 *   oldExisted: boolean, newValue: unknown, file: string, index?: number, newTags?: string[] }} Edit
 *   Edits that share a group undo together. index is the array position of an exercise record
 *   or the key position of a deleted or reverted key.
 * @typedef {{ method: string, args: unknown[] }} Command  one public editor call, used for replay
 * @typedef {{ repoPath: string, recordKey: string, field: string, oldValue: unknown, newValue: unknown }} Change
 *   A net change after collapsing all edits of a record.
 * @typedef {{ kind: 'branchLevel', tree: string, branchId: string, level: string }
 *   | { kind: 'otherSide', exerciseId: string }} Reference
 */

const GENDERS = PICKLISTS.gender;
const REPLAYABLE = new Set(['setField', 'setTags', 'setOtherSide', 'addExercise', 'deleteExercise', 'revertField']);
const DIGITS = /^\d+$/;

/** @param {string[] | null} path @param {import('./messages.js').Message} m */
const fail = (path, m) => ({ ok: false, errors: [{ path: path ?? [], ...m }] });
const exerciseTarget = (id) => ({ kind: 'exercise', id });
const unsafePath = (keys) => fail(keys, msg('unsafeField', { name: keys.find(M.isUnsafeKey) }));
const changeKey = (c) => `${c.recordKey}|${c.field}`;

const fileOf = (target) => (target.kind === 'exercise' ? M.EXERCISES : `skillTrees/${target.tree}.json`);
const treeOf = (ds, name) => (Object.hasOwn(ds.trees, name) ? ds.trees[name] : undefined);

function resolve(ds, target) {
  if (!target) return undefined;
  if (target.kind === 'exercise') return ds.index.exerciseById.get(String(target.id));
  const tree = treeOf(ds, target.tree);
  return tree && Object.hasOwn(tree, target.branchId) ? tree[target.branchId] : undefined;
}

const validate = (target, record) => (target.kind === 'exercise' ? validateExercise(record) : validateBranch(record));

/** The shape "Add parameter" writes under values.<param>. */
export function emptyParameter() {
  const genders = () => ({ default: {}, m: {}, w: {}, k: {} });
  return { startValue: genders(), targetValue: genders() };
}

const isCellPath = (path) => path.length === 5 && path[0] === 'values' &&
  (path[2] === 'startValue' || path[2] === 'targetValue') && GENDERS.includes(path[3]);

// Inserts key at position pos so a re-added key keeps its old place.
function insertKeyAt(parent, key, value, pos) {
  const keys = Object.keys(parent);
  if (pos == null || pos < 0 || pos >= keys.length) {
    parent[key] = value;
    return;
  }
  const moved = keys.slice(pos).map((k) => [k, parent[k]]);
  for (const [k] of moved) delete parent[k];
  parent[key] = value;
  for (const [k, v] of moved) parent[k] = v;
}

// Moves a write up to the first missing (or null) parent, so undo removes everything it created.
function normalize(record, path, value) {
  for (let i = 1; i < path.length; i++) {
    const v = M.getAt(record, path.slice(0, i));
    if (v === null || typeof v !== 'object') {
      const built = {};
      M.setAt(built, path.slice(i), value);
      return { path: path.slice(0, i), value: built };
    }
  }
  return { path, value };
}

const firstFailure = (results) => results.find((r) => !r.ok) ?? { ok: true };

// The exercise ids a replayable command reads or writes.
function exerciseIdsOf({ method, args }) {
  const [first, second] = Array.isArray(args) ? args : [];
  if (method === 'setOtherSide') return [first, second].filter((id) => id != null).map(String);
  if (method === 'deleteExercise') return [String(first)];
  if (method === 'addExercise') return first?.id != null ? [String(first.id)] : [];
  return first?.kind === 'exercise' ? [String(first.id)] : [];
}

/** @param {Dataset} ds @param {string | number} exerciseId @returns {Reference[]} */
export function referencesTo(ds, exerciseId) {
  const id = String(exerciseId);
  const levels = (ds.index.branchRefsByExerciseId.get(id) ?? [])
    .map(({ tree, branchId, level }) => ({ kind: 'branchLevel', tree, branchId, level }));
  const sides = (ds.index.otherSideRefsByExerciseId.get(id) ?? [])
    .filter((src) => src !== id)
    .map((src) => ({ kind: 'otherSide', exerciseId: src }));
  return [...levels, ...sides];
}

/** @param {Editor} editor @returns {string} */
function nextExerciseId(editor) {
  let n = editor.highWater.exerciseId + 1;
  while (editor.ds.index.exerciseById.has(String(n)) || String(n) === M.PAUSE_ID) n++;
  return String(n);
}

/**
 * Applies validated edits to a dataset, keeps the journal for undo and the
 * command log for replay. Views change the dataset through `Editor` methods only.
 */
export class Editor {
  /** @type {Edit[]} */
  #journal = [];
  /** @type {(Command & { group: number })[]} */
  #commandLog = [];
  /** @type {((edits: Edit[]) => void)[]} */
  #listeners = [];
  #seq = 0;
  #groupSeq = 0;
  /** @type {Map<string, unknown> | null} "recordKey|field" to the new value at the last export */
  #exported = null;

  /** @param {Dataset} ds */
  constructor(ds) {
    this.ds = ds;
    // A delete never lowers the mark, so a deleted id never comes back.
    this.highWater = { exerciseId: ds.loadMax.exerciseId, branchId: ds.loadMax.branchId };
  }

  #originalRecord(target) {
    const { ds } = this;
    if (target.kind === 'exercise') return M.originalExercise(ds, target.id);
    const data = M.originalData(ds, fileOf(target));
    return data && Object.hasOwn(data, target.branchId) ? data[target.branchId] : undefined;
  }

  #newEdit(group, target, op, path, { oldValue, oldExisted, newValue, index, newTags }) {
    /** @type {Edit} */
    const e = { seq: ++this.#seq, group, at: new Date().toISOString(), target, op, path, oldValue, oldExisted, newValue, file: fileOf(target) };
    if (index != null) e.index = index;
    if (newTags) e.newTags = newTags;
    return e;
  }

  #revertEdit(e) {
    const { ds } = this;
    if (e.op === 'addRecord' || e.op === 'removeRecord') {
      if (e.target.kind === 'exercise') {
        if (e.op === 'addRecord') {
          const pos = ds.exercises.findIndex((x) => x.id === e.target.id);
          if (pos !== -1) ds.exercises.splice(pos, 1);
        } else {
          ds.exercises.splice(e.index, 0, e.oldValue);
        }
      } else if (e.op === 'addRecord') {
        delete ds.trees[e.target.tree][e.target.branchId];
      } else {
        ds.trees[e.target.tree][e.target.branchId] = e.oldValue;
      }
      return;
    }
    const record = resolve(ds, e.target);
    if (e.op === 'set') {
      if (e.oldExisted) M.setAt(record, e.path, M.clone(e.oldValue));
      else M.deleteAt(record, e.path);
    } else {
      insertKeyAt(M.getAt(record, e.path.slice(0, -1)), e.path.at(-1), M.clone(e.oldValue), e.index);
    }
  }

  #notify(edits) {
    for (const fn of [...this.#listeners]) fn([...edits]);
  }

  // Runs fn with a transaction context; all writes share one group and undo together.
  #transact(method, args, fn) {
    const { ds } = this;
    const group = this.#groupSeq + 1;
    /** @type {Edit[]} */
    const pending = [];
    const ctx = {
      set: (target, path, value, { index: keyIndex, newTags } = {}) => {
        const record = resolve(ds, target);
        if (!record) return fail(path, msg('recordGone'));
        const plan = normalize(record, path, value);
        const trial = structuredClone(record);
        M.setAt(trial, plan.path, M.clone(plan.value));
        const errors = validate(target, trial);
        if (errors.length) return { ok: false, errors };
        const oldExisted = M.hasAt(record, plan.path);
        const oldValue = M.clone(M.getAt(record, plan.path));
        const index = !oldExisted && keyIndex != null && plan.path.length === path.length ? keyIndex : null;
        if (index != null) insertKeyAt(M.getAt(record, plan.path.slice(0, -1)), plan.path.at(-1), M.clone(plan.value), index);
        else M.setAt(record, plan.path, M.clone(plan.value));
        pending.push(this.#newEdit(group, target, 'set', plan.path, {
          oldValue, oldExisted, newValue: M.clone(plan.value), index, newTags
        }));
        return { ok: true };
      },
      del: (target, path) => {
        const record = resolve(ds, target);
        if (!record) return fail(path, msg('recordGone'));
        if (!M.hasAt(record, path)) return { ok: true };
        const trial = structuredClone(record);
        M.deleteAt(trial, path);
        const errors = validate(target, trial);
        if (errors.length) return { ok: false, errors };
        const index = Object.keys(M.getAt(record, path.slice(0, -1))).indexOf(path.at(-1));
        const oldValue = M.getAt(record, path);
        M.deleteAt(record, path);
        pending.push(this.#newEdit(group, target, 'delete', path, { oldValue, oldExisted: true, newValue: undefined, index }));
        return { ok: true };
      },
      addRecord: (target, record, index) => {
        pending.push(this.#newEdit(group, target, 'addRecord', [], { oldValue: undefined, oldExisted: false, newValue: M.clone(record), index }));
      },
      removeRecord: (target, record, index) => {
        pending.push(this.#newEdit(group, target, 'removeRecord', [], { oldValue: record, oldExisted: true, newValue: undefined, index }));
      }
    };
    const result = fn(ctx);
    if (!result || result.ok === false) {
      for (const e of pending.toReversed()) this.#revertEdit(e);
      if (pending.length) ds.index = M.buildIndex(ds);
      return result;
    }
    if (pending.length) {
      this.#groupSeq = group;
      this.#journal.push(...pending);
      this.#commandLog.push({ group, method, args: M.clone(args) });
      ds.index = M.buildIndex(ds);
      this.#notify(pending);
    }
    return result;
  }

  /** @param {Target} target @param {(string | number)[]} path @param {unknown} value @returns {Result} */
  setField(target, path, value) {
    const { ds } = this;
    const record = resolve(ds, target);
    if (!record) return fail([], msg('recordMissing'));
    if (!Array.isArray(path) || path.length === 0) return fail([], msg('noField'));
    let keys = path.map(String);
    if (keys.some(M.isUnsafeKey)) return unsafePath(keys);
    const [head] = keys;
    if (head === 'tags') return fail(keys, msg('tagsViaEditor'));
    if (target.kind === 'exercise' && head === 'id') return fail(keys, msg('idFixed'));
    if (target.kind === 'branch' && head === 'levels') return fail(keys, msg('levelsViaLadder'));
    if (target.kind === 'exercise' && head === 'name' && keys.length === 1 &&
        (typeof value !== 'string' || value.trim() === '')) {
      return fail(keys, msg('nameEmpty'));
    }

    let next = value;
    if (isCellPath(keys)) {
      if (typeof next === 'string') {
        const parsed = parseCellInput(next);
        if (!parsed.ok) return fail(keys, msg('cellNumber'));
        next = parsed.value;
      } else if (typeof next !== 'number' || !Number.isFinite(next)) {
        return fail(keys, msg('cellNumber'));
      }
      if (next === '' && !M.hasAt(record, keys)) return { ok: true };
    }
    if (target.kind === 'exercise' && keys.length === 1 && (head === 'displayName' || head === 'description') &&
        next === '' && record[head] !== '') {
      next = null;
    }
    if (M.hasAt(record, keys) && M.deepEqual(M.getAt(record, keys), next)) return { ok: true };

    // A value under a missing parameter creates the full parameter shape first.
    if (target.kind === 'exercise' && head === 'values' && keys.length > 2 &&
        !M.isObject(M.getAt(record, ['values', keys[1]]))) {
      const shape = emptyParameter();
      M.setAt(shape, keys.slice(2), next);
      next = shape;
      keys = ['values', keys[1]];
    }
    return this.#transact('setField', [target, keys, next], (ctx) => ctx.set(target, keys, next));
  }

  /**
   * Rejects tags outside the vocabulary unless confirmed, rejects PAUSE always, removes duplicates.
   * @param {Target} target @param {string[]} tags @param {{ confirmedNewTags?: string[] }} [opts] @returns {Result}
   */
  setTags(target, tags, opts) {
    const { ds } = this;
    const record = resolve(ds, target);
    if (!record) return fail([], msg('recordMissing'));
    if (!Array.isArray(tags)) return fail(['tags'], msg('tagsList'));
    if (tags.some((t) => typeof t !== 'string')) return fail(['tags'], msg('tagText'));
    const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    if (clean.includes(M.PAUSE_TAG)) return fail(['tags'], msg('pauseTag', { tag: M.PAUSE_TAG }));
    const confirmed = opts?.confirmedNewTags ?? [];
    const counts = ds.index.tagCounts;
    const fresh = clean.filter((t) => !counts.exercise.has(t) && !counts.branch.has(t));
    const unconfirmed = fresh.filter((t) => !confirmed.includes(t));
    if (unconfirmed.length) return fail(['tags'], msg('newTagUnconfirmed', { tags: unconfirmed.join(', ') }));
    if (M.deepEqual(record.tags, clean)) return { ok: true };
    return this.#transact('setTags', [target, clean, { confirmedNewTags: fresh }], (ctx) =>
      ctx.set(target, ['tags'], clean, { newTags: fresh.length ? fresh : undefined }));
  }

  /** With linkBack, all writes share one group. @returns {Result} */
  setOtherSide(id, otherId, opts) {
    const { ds } = this;
    const selfId = String(id);
    const ex = ds.index.exerciseById.get(selfId);
    if (!ex) return fail([], msg('exerciseMissing', { id: selfId }));
    const partnerId = otherId == null ? null : String(otherId);
    const both = Boolean(opts?.linkBack);
    if (partnerId === selfId) return fail(['otherSideExerciseId'], msg('ownOtherSide'));
    if (partnerId !== null && !ds.index.exerciseById.has(partnerId)) return fail(['otherSideExerciseId'], msg('exerciseMissing', { id: partnerId }));
    const field = ['otherSideExerciseId'];
    return this.#transact('setOtherSide', [selfId, partnerId, { linkBack: both }], (ctx) => {
      const results = [];
      const oldPartner = ex.otherSideExerciseId == null ? null : String(ex.otherSideExerciseId);
      if ((ex.otherSideExerciseId ?? null) !== partnerId) results.push(ctx.set(exerciseTarget(selfId), field, partnerId));
      if (both) {
        const p = oldPartner && oldPartner !== partnerId ? ds.index.exerciseById.get(oldPartner) : null;
        if (p && p.otherSideExerciseId === selfId) results.push(ctx.set(exerciseTarget(p.id), field, null));
        if (partnerId) {
          const o = ds.index.exerciseById.get(partnerId);
          const q = o.otherSideExerciseId != null && o.otherSideExerciseId !== selfId
            ? ds.index.exerciseById.get(String(o.otherSideExerciseId))
            : null;
          if (q && q.id !== selfId && q.otherSideExerciseId === partnerId) results.push(ctx.set(exerciseTarget(q.id), field, null));
          if (o.otherSideExerciseId !== selfId) results.push(ctx.set(exerciseTarget(partnerId), field, selfId));
        }
      }
      return firstFailure(results);
    });
  }

  /** @param {{ id?: string | number }} [opts] @returns {{ ok: true, id: string } | { ok: false, errors: Violation[] }} */
  addExercise(opts) {
    const { ds } = this;
    const id = opts?.id != null ? String(opts.id) : nextExerciseId(this);
    if (!DIGITS.test(id) || ds.index.exerciseById.has(id)) return fail(['id'], msg('idTaken', { id }));
    const defaults = {
      id, name: 'New exercise', displayName: null,
      level: { m: 1, w: 1 }, tags: [],
      isAdvanceByReps: false, isAdvanceByDuration: false, isJump: false,
      description: null, video: null, picture: null, otherSideExerciseId: null, values: null
    };
    const template = ds.exercises.find((x) => x.id !== M.PAUSE_ID);
    // Key order of the first non-Pause exercise, then the remaining defaults.
    const order = new Set([...Object.keys(template ?? {}), ...Object.keys(defaults)]);
    const record = Object.fromEntries([...order].filter((k) => Object.hasOwn(defaults, k)).map((k) => [k, defaults[k]]));
    const target = exerciseTarget(id);
    const result = this.#transact('addExercise', [{ id }], (ctx) => {
      const errors = validateExercise(record);
      if (errors.length) return { ok: false, errors };
      ds.exercises.push(record);
      ctx.addRecord(target, record, ds.exercises.length - 1);
      return { ok: true, id };
    });
    if (result.ok) this.highWater.exerciseId = Math.max(this.highWater.exerciseId, Number(id));
    return result;
  }

  /** @returns {Result | { ok: false, reason: import('./messages.js').Message, references: Reference[] }} */
  deleteExercise(id) {
    const { ds } = this;
    const exId = String(id);
    if (exId === M.PAUSE_ID) return { ok: false, reason: msg('pauseNoDelete'), references: [] };
    const ex = ds.index.exerciseById.get(exId);
    if (!ex) return fail([], msg('exerciseMissing', { id: exId }));
    const references = referencesTo(ds, exId);
    if (references.length) return { ok: false, reason: msg('inUse'), references };
    return this.#transact('deleteExercise', [exId], (ctx) => {
      const pos = ds.exercises.indexOf(ex);
      ds.exercises.splice(pos, 1);
      ctx.removeRecord(exerciseTarget(exId), ex, pos);
      return { ok: true };
    });
  }

  /** Undoes the last group. @returns {Edit[] | null} */
  undo() {
    const journal = this.#journal;
    if (!journal.length) return null;
    const { group } = journal.at(-1);
    const undone = [];
    while (journal.at(-1)?.group === group) undone.push(journal.pop());
    for (const e of undone) this.#revertEdit(e);
    this.#commandLog = this.#commandLog.filter((c) => c.group !== group);
    this.ds.index = M.buildIndex(this.ds);
    this.#notify(undone);
    return undone;
  }

  /** Restores the loaded value of one field. @param {Target} target @param {(string | number)[]} path @returns {Result} */
  revertField(target, path) {
    if (!Array.isArray(path) || path.length === 0) return fail([], msg('noField'));
    const keys = path.map(String);
    if (keys.some(M.isUnsafeKey)) return unsafePath(keys);
    const orig = this.#originalRecord(target);
    if (!orig) return fail(keys, msg('noLoadedValue'));
    const record = resolve(this.ds, target);
    if (!record) return fail(keys, msg('recordMissing'));
    const origHas = M.hasAt(orig, keys);
    const curHas = M.hasAt(record, keys);
    if (origHas && curHas && M.deepEqual(M.getAt(orig, keys), M.getAt(record, keys))) return { ok: true };
    if (!origHas && !curHas) return { ok: true };
    return this.#transact('revertField', [target, keys], (ctx) => {
      if (!origHas) return ctx.del(target, keys);
      const index = Object.keys(M.getAt(orig, keys.slice(0, -1))).indexOf(keys.at(-1));
      return ctx.set(target, keys, M.clone(M.getAt(orig, keys)), { index });
    });
  }

  /** @returns {Edit[]} */
  journal() {
    return [...this.#journal];
  }

  /** The number of journal entries, without a copy of the journal. @returns {number} */
  get journalLength() {
    return this.#journal.length;
  }

  /** @returns {Command[]} */
  commands() {
    return this.#commandLog.map(({ method, args }) => ({ method, args: M.clone(args) }));
  }

  /** @param {Command[]} commands @returns {{ applied: number, failed: { command: Command, errors: Violation[] }[] }} */
  replay(commands) {
    let applied = 0;
    const failed = [];
    // Ids of replayed addExercise calls that failed. Later commands on them would change another exercise.
    const notAdded = new Set();
    for (const command of commands ?? []) {
      let r;
      const known = Boolean(command) && REPLAYABLE.has(command.method);
      const ids = known ? exerciseIdsOf(command) : [];
      const skipId = ids.find((id) => notAdded.has(id));
      if (!known) {
        r = fail([], msg('unknownCommand', { method: String(command?.method) }));
      } else if (skipId !== undefined) {
        r = fail([], msg('notAdded', { id: skipId }));
      } else {
        try {
          r = this[command.method](...M.clone(command.args ?? []));
        } catch (e) {
          r = fail([], e.code ? msg(e.code, e.params) : msg('text', { text: e.message }));
        }
      }
      if (r && r.ok !== false) {
        applied++;
        continue;
      }
      if (command?.method === 'addExercise' && ids.length) notAdded.add(ids[0]);
      failed.push({ command, errors: r.errors ?? [{ path: [], ...r.reason }] });
    }
    return { applied, failed };
  }

  /** @returns {Change[]} */
  netChanges() {
    const seen = new Set();
    /** @type {Change[]} */
    const out = [];
    const diff = (a, b, path, base) => {
      if (M.isObject(a) && M.isObject(b)) {
        const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
        for (const k of keys) diff(a[k], b[k], [...path, k], base);
        return;
      }
      if (!M.deepEqual(a, b)) out.push({ ...base, field: path.join('.'), oldValue: M.clone(a), newValue: M.clone(b) });
    };
    for (const e of this.#journal) {
      const recordKey = M.recordKeyOf(e.target);
      if (seen.has(recordKey)) continue;
      seen.add(recordKey);
      const base = { repoPath: M.REPO_BASE + e.file, recordKey };
      const orig = this.#originalRecord(e.target);
      const cur = resolve(this.ds, e.target);
      if (!orig && !cur) continue;
      if (!orig) out.push({ ...base, field: '(new record)', oldValue: undefined, newValue: M.clone(cur) });
      else if (!cur) out.push({ ...base, field: '(deleted)', oldValue: M.clone(orig), newValue: undefined });
      else diff(orig, cur, [], base);
    }
    return out;
  }

  /** @param {Change[]} [changes] the current netChanges(), to skip computing them again @returns {number} */
  changeCount(changes = this.netChanges()) {
    return changes.length;
  }

  /** Stores the new value of every net change at export time. */
  markExported() {
    this.#exported = new Map(this.netChanges().map((c) => [changeKey(c), M.clone(c.newValue)]));
  }

  /** Takes over the export mark of another editor on the same Exercises.json. @param {Editor} other */
  copyExportMark(other) {
    this.#exported = other.#exported && new Map(other.#exported);
  }

  /**
   * Net changes that differ from the last export, plus exported changes that are gone.
   * Before any export it equals changeCount().
   * @param {Change[]} [changes] the current netChanges(), to skip computing them again
   * @returns {number}
   */
  unexportedCount(changes = this.netChanges()) {
    const exported = this.#exported;
    if (!exported) return changes.length;
    const current = new Set();
    let n = 0;
    for (const c of changes) {
      const key = changeKey(c);
      current.add(key);
      if (!exported.has(key) || !M.deepEqual(exported.get(key), c.newValue)) n++;
    }
    for (const key of exported.keys()) if (!current.has(key)) n++;
    return n;
  }

  /** Calls fn with the applied edits after every change. @param {(edits: Edit[]) => void} fn @returns {() => void} */
  subscribe(fn) {
    this.#listeners.push(fn);
    return () => {
      const i = this.#listeners.indexOf(fn);
      if (i !== -1) this.#listeners.splice(i, 1);
    };
  }
}
