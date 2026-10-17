import { DATA_TARGET_PATH } from './config.js';
import { messageError } from './messages.js';

/**
 * @typedef {Record<string, string>} RawFiles  path ("Exercises.json" or "skillTrees/SK.json") to raw text
 * @typedef {Record<string, unknown>} Exercise
 * @typedef {{ tags: string[], levels: Record<string, { exerciseId: string }> }} Branch
 * @typedef {{ path: string, repoPath: string, kind: 'exercises' | 'skillTree', treeName?: string,
 *   raw: string, data: unknown, trailingNewline: boolean }} FileEntry
 * @typedef {{ tree: string, branchId: string, level: string }} BranchRef
 * @typedef {{ exerciseById: Map<string, Exercise>, branchRefsByExerciseId: Map<string, BranchRef[]>,
 *   otherSideRefsByExerciseId: Map<string, string[]>, treeOfBranch: Map<string, string>,
 *   tagCounts: { exercise: Map<string, number>, branch: Map<string, number> } }} Index
 * @typedef {{ files: Record<string, FileEntry>, exercises: Exercise[],
 *   trees: Record<string, Record<string, Branch>>, treeNames: string[], index: Index,
 *   loadMax: { exerciseId: number, branchId: number } }} Dataset
 * @typedef {{ kind: 'exercise', id: string } | { kind: 'branch', tree: string, branchId: string }} Target
 * @typedef {{ path: string[] } & import('./messages.js').Message} Violation
 * @typedef {{ ok: true } | { ok: false, errors: Violation[] }} Result
 * @typedef {{ path: string, repoPath: string, fileName: string, text: string }} ChangedFile
 */

export const REPO_BASE = `${DATA_TARGET_PATH}/`;
export const EXERCISES = 'Exercises.json';
export const PAUSE_ID = '999999';
export const PAUSE_TAG = 'PAUSE';
/**
 * Tag groups in display order. key names the label of the group in the UI dictionaries.
 * @type {readonly { readonly prefix: string, readonly key: string }[]}
 */
export const TAG_GROUPS = Object.freeze([
  ['SKILL_', 'skill'],
  ['REGION_', 'region'],
  ['EXERCISE_DIRECTION_', 'direction'],
  ['EQ_TYPE_', 'weightType'],
  ['EQ_', 'equipment'],
  ['PLACE_', 'place'],
  ['SIDE_', 'side'],
  ['AGE_', 'age'],
  ['PAIN_', 'pain'],
  ['SEASON_PHASE_', 'seasonPhase'],
  ['MUSCLE_', 'muscle'],
  ['MUSCLE_SECONDARY_', 'secondaryMuscle'],
  ['MUSCLE_INVOLVEMENT_', 'muscleInvolvement']
].map(([prefix, key]) => Object.freeze({ prefix, key })));
/** The TAG_GROUPS prefixes, longest first, so the first match is the longest. */
const TAG_PREFIXES = Object.freeze(TAG_GROUPS.map((g) => g.prefix).sort((a, b) => b.length - a.length));

const DIGITS = /^\d+$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** True for a key that reaches the prototype chain. @param {unknown} key */
export const isUnsafeKey = (key) => UNSAFE_KEYS.has(String(key));

function assertSafePath(path) {
  const bad = path.find(isUnsafeKey);
  if (bad !== undefined) throw messageError('unsafeField', { name: bad });
}

/**
 * "exercise:429", "branch:SKKG/979", or with a level "branch:SKKG/979:L3".
 * @param {Target} target @param {string | number} [level] @returns {string}
 */
export const recordKeyOf = (target, level) =>
  (target.kind === 'exercise' ? `exercise:${target.id}` : `branch:${target.tree}/${target.branchId}`) +
  (level == null ? '' : `:L${level}`);

/** The reverse of recordKeyOf, or null for an unknown shape. @param {string} key @returns {{ target: Target, level?: string } | null} */
export function parseRecordKey(key) {
  const m = /^(exercise|branch):(.*?)(?::L(\d))?$/.exec(String(key));
  if (!m) return null;
  const [, kind, rest, level] = m;
  if (kind === 'exercise') return { target: { kind, id: rest }, level };
  const cut = rest.lastIndexOf('/');
  if (cut === -1) return null;
  return { target: { kind, tree: rest.slice(0, cut), branchId: rest.slice(cut + 1) }, level };
}

// Parsed copies of the loaded raw texts, keyed by FileEntry. Never mutated.
const originals = new WeakMap();
// The loaded exercises by id, keyed by the Exercises.json FileEntry.
const originalById = new WeakMap();

/** @param {unknown} v @returns {v is Record<string, unknown>} */
export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** @param {unknown} a @param {unknown} b @returns {boolean} */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

/** @template T @param {T} v @returns {T} */
export const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function parseFile(path, text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw messageError('notJson', { path, detail: e.message });
  }
}

/**
 * Builds a dataset from Exercises.json and any skillTrees/*.json files. Skill trees are optional:
 * a raw map with Exercises.json alone gives a dataset with zero skill trees.
 * @param {RawFiles} raw @returns {Dataset} Throws an Error with a plain message.
 */
export function load(raw) {
  if (typeof raw?.[EXERCISES] !== 'string') {
    throw messageError('exercisesMissing', { path: `${DATA_TARGET_PATH}/${EXERCISES}` });
  }
  /** @type {Record<string, FileEntry>} */
  const files = {};
  const trees = {};
  for (const [path, text] of Object.entries(raw)) {
    const data = parseFile(path, text);
    /** @type {FileEntry} */
    const entry = {
      path,
      repoPath: REPO_BASE + path,
      kind: path === EXERCISES ? 'exercises' : 'skillTree',
      raw: text,
      data,
      trailingNewline: text.endsWith('\n')
    };
    if (entry.kind === 'exercises') {
      if (!Array.isArray(data)) throw messageError('exercisesNotList');
    } else {
      const match = /^skillTrees\/([^/]+)\.json$/.exec(path);
      if (!match || isUnsafeKey(match[1])) throw messageError('unexpectedFile', { path });
      // Every branch is a record, so a picked work file or other JSON object fails here.
      if (!isObject(data) || !Object.values(data).every(isObject)) throw messageError('treeNotObject', { path });
      const [, treeName] = match;
      entry.treeName = treeName;
      trees[treeName] = data;
    }
    files[path] = entry;
  }
  /** @type {Dataset} */
  const ds = {
    files,
    exercises: files[EXERCISES].data,
    trees,
    treeNames: Object.keys(trees).sort(),
    index: null,
    loadMax: { exerciseId: 0, branchId: 0 }
  };
  for (const ex of ds.exercises) {
    if (typeof ex?.id !== 'string' || !DIGITS.test(ex.id)) continue;
    const n = Number(ex.id);
    if (n < Number(PAUSE_ID) && n > ds.loadMax.exerciseId) ds.loadMax.exerciseId = n;
  }
  for (const tree of ds.treeNames) {
    for (const bid of Object.keys(trees[tree])) {
      if (DIGITS.test(bid) && Number(bid) > ds.loadMax.branchId) ds.loadMax.branchId = Number(bid);
    }
  }
  ds.index = buildIndex(ds);
  return ds;
}

const pushTo = (map, key, value) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/** @param {Dataset} ds @returns {Index} */
export function buildIndex(ds) {
  /** @type {Index} */
  const index = {
    exerciseById: new Map(),
    branchRefsByExerciseId: new Map(),
    otherSideRefsByExerciseId: new Map(),
    treeOfBranch: new Map(),
    tagCounts: { exercise: new Map(), branch: new Map() }
  };
  const count = (map, tags) => {
    if (!Array.isArray(tags)) return;
    for (const t of new Set(tags)) map.set(t, (map.get(t) ?? 0) + 1);
  };
  for (const ex of ds.exercises) {
    index.exerciseById.set(ex.id, ex);
    count(index.tagCounts.exercise, ex.tags);
    if (ex.otherSideExerciseId != null) pushTo(index.otherSideRefsByExerciseId, String(ex.otherSideExerciseId), ex.id);
  }
  for (const tree of ds.treeNames) {
    for (const [bid, branch] of Object.entries(ds.trees[tree])) {
      index.treeOfBranch.set(bid, tree);
      count(index.tagCounts.branch, branch?.tags);
      const levels = isObject(branch?.levels) ? branch.levels : {};
      for (const [level, l] of Object.entries(levels)) {
        if (l?.exerciseId == null) continue;
        pushTo(index.branchRefsByExerciseId, String(l.exerciseId), { tree, branchId: bid, level });
      }
    }
  }
  return index;
}

/** @param {Dataset} ds @returns {{ exercises: number, trees: number, branches: number }} */
export function stats(ds) {
  const branches = ds.treeNames.reduce((sum, tree) => sum + Object.keys(ds.trees[tree]).length, 0);
  return { exercises: ds.exercises.length, trees: ds.treeNames.length, branches };
}

/**
 * FNV-1a, 32 bit, over the path and raw text of Exercises.json. The skill tree files are optional
 * and the trainer edits no branch, so a backup or work file matches with and without them.
 * @param {Dataset} ds
 */
export function fingerprint(ds) {
  let h = 0x811c9dc5;
  const feed = (s) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  feed(EXERCISES);
  feed('\u0000');
  feed(ds.files[EXERCISES].raw);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Undefined for a missing path or a path with an unsafe key. @param {unknown} obj @param {string[]} path */
export function getAt(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (isUnsafeKey(key) || cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, key)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** @param {unknown} obj @param {string[]} path */
export function hasAt(obj, path) {
  if (path.length === 0) return true;
  if (path.some(isUnsafeKey)) return false;
  const parent = getAt(obj, path.slice(0, -1));
  return parent !== null && typeof parent === 'object' && Object.hasOwn(parent, path.at(-1));
}

/**
 * Writes in place and creates missing parents. Throws on an unsafe key.
 * @param {Record<string, unknown> | unknown[]} obj @param {string[]} path @param {unknown} value
 */
export function setAt(obj, path, value) {
  assertSafePath(path);
  let cur = obj;
  for (const key of path.slice(0, -1)) {
    if (!Object.hasOwn(cur, key) || cur[key] === null || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key];
  }
  cur[path.at(-1)] = value;
}

/** Throws on an unsafe key. @param {unknown} obj @param {string[]} path */
export function deleteAt(obj, path) {
  assertSafePath(path);
  const parent = getAt(obj, path.slice(0, -1));
  if (parent === null || typeof parent !== 'object') return;
  const key = path.at(-1);
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else delete parent[key];
}

/** The parsed loaded text of a file, never mutated. @param {Dataset} ds @param {string} path */
export function originalData(ds, path) {
  const entry = ds.files[path];
  if (!entry) return undefined;
  if (!originals.has(entry)) originals.set(entry, JSON.parse(entry.raw));
  return originals.get(entry);
}

/**
 * The loaded version of an exercise, or undefined for a new one. Never mutated.
 * @param {Dataset} ds @param {string | number} id @returns {Exercise | undefined}
 */
export function originalExercise(ds, id) {
  const entry = ds.files[EXERCISES];
  if (!entry) return undefined;
  if (!originalById.has(entry)) {
    const list = originalData(ds, EXERCISES).filter(Boolean);
    originalById.set(entry, new Map(list.map((ex) => [String(ex.id), ex])));
  }
  return originalById.get(entry).get(String(id));
}

/**
 * True when the field at path differs from the loaded file. New exercises never count as changed.
 * @param {Dataset} ds @param {Exercise} rec @param {string[]} path @returns {boolean}
 */
export function isChanged(ds, rec, path) {
  const orig = originalExercise(ds, rec.id);
  if (!orig) return false;
  const had = hasAt(orig, path);
  if (had !== hasAt(rec, path)) return true;
  return had && !deepEqual(getAt(orig, path), getAt(rec, path));
}

/** The calendar date in the local time zone as YYYY-MM-DD. @param {Date} [date] @returns {string} */
export function localDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** @param {Dataset} ds @param {string} path @returns {string} */
export function serializeFile(ds, path) {
  const entry = ds.files[path];
  const text = JSON.stringify(entry.data, null, 2) + (entry.trailingNewline ? '\n' : '');
  if (text === entry.raw || deepEqual(entry.data, originalData(ds, path))) return entry.raw;
  return text;
}

function orderedPaths(ds) {
  const paths = Object.keys(ds.files).filter((p) => p !== EXERCISES).sort();
  return ds.files[EXERCISES] ? [EXERCISES, ...paths] : paths;
}

/** @param {Dataset} ds @returns {ChangedFile[]} */
export function changedFiles(ds) {
  return orderedPaths(ds).flatMap((path) => {
    const entry = ds.files[path];
    const text = serializeFile(ds, path);
    return text === entry.raw ? [] : [{ path, repoPath: entry.repoPath, fileName: path.split('/').at(-1), text }];
  });
}

/** @param {string} tag @returns {string} */
export function tagPrefix(tag) {
  const known = TAG_PREFIXES.find((p) => tag.startsWith(p));
  if (known) return known;
  const cut = tag.indexOf('_');
  return cut === -1 ? tag : tag.slice(0, cut + 1);
}

/** @param {Exercise} ex @returns {string} */
export const exerciseLabel = (ex) => ex.displayName ?? ex.name;
