// Mirrors the common, exercise and skill tree schemas of the athlete app.
// Some rules are stricter than valibot: level keys 1 to 6 and no unknown keys
// inside values. The editor adds the edit-only rules (non-empty name, numeric cells).
import { isObject, recordKeyOf } from './model.js';

/**
 * @typedef {import('./model.js').Violation} Violation
 * @typedef {import('./model.js').Dataset} Dataset
 * @typedef {{ ok: true, value: number | '' } | { ok: false, message: string }} CellInput
 */

export const PICKLISTS = Object.freeze({
  trainingLevel: Object.freeze(['default', 'beginner', 'intermediate', 'advanced', 'professional']),
  trainingParameter: Object.freeze(['duration', 'height', 'repetition', 'weight']),
  valueTypeType: Object.freeze(['weightFMax', 'weightAbsolute', 'Unknown', 'Single']),
  gender: Object.freeze(['default', 'm', 'w', 'k'])
});
export const CELL_MESSAGE = 'Enter a number such as 12 or 2.5, or leave the cell empty.';

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const list = (values) => values.join(', ');
const PARTS = [['startValue', 'Start value'], ['targetValue', 'Target value']];

function validateValueType(node, path, out) {
  if (!isObject(node)) {
    out.push({ path, message: 'Must be a group of values.' });
    return;
  }
  for (const [gender, cells] of Object.entries(node)) {
    const gpath = [...path, gender];
    if (gender === 'type') {
      if (!isObject(cells) || !PICKLISTS.valueTypeType.includes(cells.type)) {
        out.push({ path: [...gpath, 'type'], message: `Weight type must be one of ${list(PICKLISTS.valueTypeType)}.` });
      }
      continue;
    }
    if (!PICKLISTS.gender.includes(gender)) {
      out.push({ path: gpath, message: `Unknown gender "${gender}". Use one of ${list(PICKLISTS.gender)}.` });
      continue;
    }
    if (!isObject(cells)) {
      out.push({ path: gpath, message: 'Must be a group of fitness level values.' });
      continue;
    }
    for (const [level, v] of Object.entries(cells)) {
      if (!PICKLISTS.trainingLevel.includes(level)) {
        out.push({ path: [...gpath, level], message: `Unknown fitness level "${level}". Use one of ${list(PICKLISTS.trainingLevel)}.` });
      } else if (typeof v !== 'string' && !isNumber(v)) {
        out.push({ path: [...gpath, level], message: CELL_MESSAGE });
      }
    }
  }
}

function validateValues(values, out) {
  if (values === null) return;
  if (!isObject(values)) {
    out.push({ path: ['values'], message: 'Values must be a group of training parameters or empty.' });
    return;
  }
  for (const [param, p] of Object.entries(values)) {
    const ppath = ['values', param];
    if (!PICKLISTS.trainingParameter.includes(param)) {
      out.push({ path: ppath, message: `Unknown training parameter "${param}". Use one of ${list(PICKLISTS.trainingParameter)}.` });
      continue;
    }
    if (!isObject(p)) {
      out.push({ path: ppath, message: 'Must hold a start value and a target value.' });
      continue;
    }
    for (const [part, label] of PARTS) {
      if (!Object.hasOwn(p, part)) out.push({ path: [...ppath, part], message: `${label} is missing.` });
      else validateValueType(p[part], [...ppath, part], out);
    }
  }
}

function stringOrNull(ex, key, out, optional = false) {
  if (optional && !Object.hasOwn(ex, key)) return;
  if (ex[key] !== null && typeof ex[key] !== 'string') out.push({ path: [key], message: 'Must be text or empty.' });
}

function validateTags(tags, out) {
  if (!Array.isArray(tags)) out.push({ path: ['tags'], message: 'Tags must be a list.' });
  else if (tags.some((t) => typeof t !== 'string')) out.push({ path: ['tags'], message: 'Every tag must be text.' });
}

/** @param {unknown} ex @returns {Violation[]} */
export function validateExercise(ex) {
  if (!isObject(ex)) return [{ path: [], message: 'An exercise must be a record.' }];
  /** @type {Violation[]} */
  const out = [];
  if (typeof ex.id !== 'string' || ex.id === '') out.push({ path: ['id'], message: 'The id must be text.' });
  if (!isObject(ex.level)) {
    out.push({ path: ['level'], message: 'Level m and w are missing.' });
  } else {
    for (const g of ['m', 'w']) {
      if (!isNumber(ex.level[g])) out.push({ path: ['level', g], message: `Level ${g} must be a number.` });
    }
  }
  if (typeof ex.name !== 'string') out.push({ path: ['name'], message: 'The name must be text.' });
  for (const key of ['displayName', 'description', 'picture', 'video']) stringOrNull(ex, key, out);
  if (!Object.hasOwn(ex, 'values')) out.push({ path: ['values'], message: 'Values are missing.' });
  else validateValues(ex.values, out);
  validateTags(ex.tags, out);
  for (const flag of ['isAdvanceByReps', 'isAdvanceByDuration', 'isJump']) {
    if (typeof ex[flag] !== 'boolean') out.push({ path: [flag], message: 'Must be ticked or unticked (true or false).' });
  }
  stringOrNull(ex, 'otherSideExerciseId', out, true);
  if (Object.hasOwn(ex, 'equivalentExercises') &&
      (!Array.isArray(ex.equivalentExercises) || ex.equivalentExercises.some((t) => typeof t !== 'string'))) {
    out.push({ path: ['equivalentExercises'], message: 'Equivalent exercises must be a list of ids.' });
  }
  if (Object.hasOwn(ex, 'conversionFactor') &&!isNumber(ex.conversionFactor)) {
    out.push({ path: ['conversionFactor'], message: 'The conversion factor must be a number.' });
  }
  return out;
}

/** @param {unknown} branch @returns {Violation[]} */
export function validateBranch(branch) {
  if (!isObject(branch)) return [{ path: [], message: 'A branch must be a record.' }];
  /** @type {Violation[]} */
  const out = [];
  validateTags(branch.tags, out);
  if (!isObject(branch.levels)) {
    out.push({ path: ['levels'], message: 'Levels must be a group of branch levels.' });
    return out;
  }
  for (const [key, l] of Object.entries(branch.levels)) {
    if (!/^[1-6]$/.test(key)) {
      out.push({ path: ['levels', key], message: `Branch level "${key}" is not allowed. Use 1 to 6.` });
    } else if (!isObject(l) || typeof l.exerciseId !== 'string') {
      out.push({ path: ['levels', key, 'exerciseId'], message: `Branch level ${key} must point to an exercise id.` });
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
  return { ok: false, message: CELL_MESSAGE };
}
