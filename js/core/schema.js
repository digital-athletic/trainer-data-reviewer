// Mirrors the common, exercise and skill tree schemas of the athlete app.
// Some rules are stricter than valibot: level keys 1 to 6 and no unknown keys
// inside values. The editor adds the edit-only rules (non-empty name, numeric cells).
import { MESSAGES, msg } from './messages.js';
import { isObject, recordKeyOf } from './model.js';

/**
 * @typedef {import('./model.js').Violation} Violation
 * @typedef {import('./model.js').Dataset} Dataset
 * @typedef {{ ok: true, value: number | '' } | ({ ok: false } & import('./messages.js').Message)} CellInput
 */

export const PICKLISTS = Object.freeze({
  trainingLevel: Object.freeze(['default', 'beginner', 'intermediate', 'advanced', 'professional']),
  trainingParameter: Object.freeze(['duration', 'height', 'repetition', 'weight']),
  valueTypeType: Object.freeze(['weightFMax', 'weightAbsolute', 'Unknown', 'Single']),
  gender: Object.freeze(['default', 'm', 'w', 'k'])
});
export const CELL_MESSAGE = MESSAGES.cellNumber;

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const list = (values) => values.join(', ');
const PARTS = [['startValue', 'startMissing'], ['targetValue', 'targetMissing']];
/** @param {string[]} path @param {keyof typeof MESSAGES} code @param {Record<string, unknown>} [params] @returns {Violation} */
const violation = (path, code, params) => ({ path, ...msg(code, params) });

function validateValueType(node, path, out) {
  if (!isObject(node)) {
    out.push(violation(path, 'valueGroup'));
    return;
  }
  for (const [gender, cells] of Object.entries(node)) {
    const gpath = [...path, gender];
    if (gender === 'type') {
      if (!isObject(cells) || !PICKLISTS.valueTypeType.includes(cells.type)) {
        out.push(violation([...gpath, 'type'], 'weightType', { list: list(PICKLISTS.valueTypeType) }));
      }
      continue;
    }
    if (!PICKLISTS.gender.includes(gender)) {
      out.push(violation(gpath, 'unknownGender', { gender, list: list(PICKLISTS.gender) }));
      continue;
    }
    if (!isObject(cells)) {
      out.push(violation(gpath, 'levelGroup'));
      continue;
    }
    for (const [level, v] of Object.entries(cells)) {
      if (!PICKLISTS.trainingLevel.includes(level)) {
        out.push(violation([...gpath, level], 'unknownLevel', { level, list: list(PICKLISTS.trainingLevel) }));
      } else if (typeof v !== 'string' && !isNumber(v)) {
        out.push(violation([...gpath, level], 'cellNumber'));
      }
    }
  }
}

function validateValues(values, out) {
  if (values === null) return;
  if (!isObject(values)) {
    out.push(violation(['values'], 'valuesGroup'));
    return;
  }
  for (const [param, p] of Object.entries(values)) {
    const ppath = ['values', param];
    if (!PICKLISTS.trainingParameter.includes(param)) {
      out.push(violation(ppath, 'unknownParam', { param, list: list(PICKLISTS.trainingParameter) }));
      continue;
    }
    if (!isObject(p)) {
      out.push(violation(ppath, 'paramParts'));
      continue;
    }
    for (const [part, missing] of PARTS) {
      if (!Object.hasOwn(p, part)) out.push(violation([...ppath, part], missing));
      else validateValueType(p[part], [...ppath, part], out);
    }
  }
}

function stringOrNull(ex, key, out, optional = false) {
  if (optional && !Object.hasOwn(ex, key)) return;
  if (ex[key] !== null && typeof ex[key] !== 'string') out.push(violation([key], 'textOrEmpty'));
}

function validateTags(tags, out) {
  if (!Array.isArray(tags)) out.push(violation(['tags'], 'tagsList'));
  else if (tags.some((t) => typeof t !== 'string')) out.push(violation(['tags'], 'tagText'));
}

/** @param {unknown} ex @returns {Violation[]} */
export function validateExercise(ex) {
  if (!isObject(ex)) return [violation([], 'exerciseRecord')];
  /** @type {Violation[]} */
  const out = [];
  if (typeof ex.id !== 'string' || ex.id === '') out.push(violation(['id'], 'idText'));
  if (!isObject(ex.level)) {
    out.push(violation(['level'], 'levelMissing'));
  } else {
    for (const g of ['m', 'w']) {
      if (!isNumber(ex.level[g])) out.push(violation(['level', g], 'levelNumber', { gender: g }));
    }
  }
  if (typeof ex.name !== 'string') out.push(violation(['name'], 'nameText'));
  for (const key of ['displayName', 'description', 'picture', 'video']) stringOrNull(ex, key, out);
  if (!Object.hasOwn(ex, 'values')) out.push(violation(['values'], 'valuesMissing'));
  else validateValues(ex.values, out);
  validateTags(ex.tags, out);
  for (const flag of ['isAdvanceByReps', 'isAdvanceByDuration', 'isJump']) {
    if (typeof ex[flag] !== 'boolean') out.push(violation([flag], 'flagBoolean'));
  }
  stringOrNull(ex, 'otherSideExerciseId', out, true);
  if (Object.hasOwn(ex, 'equivalentExercises') &&
      (!Array.isArray(ex.equivalentExercises) || ex.equivalentExercises.some((t) => typeof t !== 'string'))) {
    out.push(violation(['equivalentExercises'], 'equivalentList'));
  }
  if (Object.hasOwn(ex, 'conversionFactor') && !isNumber(ex.conversionFactor)) {
    out.push(violation(['conversionFactor'], 'conversionNumber'));
  }
  return out;
}

/** @param {unknown} branch @returns {Violation[]} */
export function validateBranch(branch) {
  if (!isObject(branch)) return [violation([], 'branchRecord')];
  /** @type {Violation[]} */
  const out = [];
  validateTags(branch.tags, out);
  if (!isObject(branch.levels)) {
    out.push(violation(['levels'], 'levelsGroup'));
    return out;
  }
  for (const [key, l] of Object.entries(branch.levels)) {
    if (!/^[1-6]$/.test(key)) {
      out.push(violation(['levels', key], 'branchLevelKey', { level: key }));
    } else if (!isObject(l) || typeof l.exerciseId !== 'string') {
      out.push(violation(['levels', key, 'exerciseId'], 'branchLevelTarget', { level: key }));
    }
  }
  return out;
}

/** @param {Dataset} ds @returns {{ recordKey: string, violations: Violation[] }[]} */
export function validateDataset(ds) {
  const out = [];
  for (const ex of ds.exercises) {
    const violations = validateExercise(ex);
    if (violations.length) out.push({ recordKey: recordKeyOf({ kind: 'exercise', id: ex?.id }), violations });
  }
  for (const tree of ds.treeNames) {
    for (const [bid, branch] of Object.entries(ds.trees[tree])) {
      const violations = validateBranch(branch);
      if (violations.length) out.push({ recordKey: recordKeyOf({ kind: 'branch', tree, branchId: bid }), violations });
    }
  }
  return out;
}

/** Number with decimal comma or point, or empty. Empty yields "". @param {unknown} text @returns {CellInput} */
export function parseCellInput(text) {
  const s = String(text ?? '').trim();
  if (s === '') return { ok: true, value: '' };
  const normal = s.replace(',', '.');
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(normal)) return { ok: true, value: Number.parseFloat(normal) };
  return { ok: false, ...msg('cellNumber') };
}
