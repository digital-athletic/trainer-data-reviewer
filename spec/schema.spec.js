import test from 'node:test';
import assert from 'node:assert/strict';
import * as edits from '../js/core/edits.js';
import * as schema from '../js/core/schema.js';
import { REAL, loadSample, loadReal } from './helpers.js';

const exercise = (overrides) => ({
  id: '1', name: 'Squat', displayName: null, level: { m: 1, w: 1 }, tags: [],
  isAdvanceByReps: false, isAdvanceByDuration: false, isJump: false,
  description: null, video: null, picture: null, otherSideExerciseId: null, values: null,
  ...overrides
});

const values = (part) => ({ weight: { startValue: part, targetValue: { default: {} } } });

test('schema: picklists mirror the athlete app schemas', () => {
  assert.deepEqual(schema.PICKLISTS.trainingLevel, ['default', 'beginner', 'intermediate', 'advanced', 'professional']);
  assert.deepEqual(schema.PICKLISTS.trainingParameter, ['duration', 'height', 'repetition', 'weight']);
  assert.deepEqual(schema.PICKLISTS.valueTypeType, ['weightFMax', 'weightAbsolute', 'Unknown', 'Single']);
  assert.deepEqual(schema.PICKLISTS.gender, ['default', 'm', 'w', 'k']);
});

test('schema: the sample dataset has exactly its one planted violation', () => {
  const found = schema.validateDataset(loadSample());
  assert.deepEqual(found, [{ recordKey: 'exercise:14', violations: [{ path: ['isJump'], message: 'Must be ticked or unticked (true or false).' }] }]);
});

test('schema (real data): the real dataset has no violations', REAL, () => {
  assert.deepEqual(schema.validateDataset(loadReal()), []);
});

test('schema: branch level keys must be 1 to 6', () => {
  const ok = { tags: [], levels: { 1: { exerciseId: '1' }, 6: { exerciseId: '2' } } };
  assert.deepEqual(schema.validateBranch(ok), []);
  assert.equal(schema.validateBranch({ tags: [], levels: { 7: { exerciseId: '1' } } }).length, 1);
  assert.equal(schema.validateBranch({ tags: [], levels: { a: { exerciseId: '1' } } }).length, 1);
  assert.equal(schema.validateBranch({ tags: [], levels: { 0: { exerciseId: '1' } } }).length, 1);
  assert.equal(schema.validateBranch({ tags: [], levels: { 1: { exerciseId: 1 } } }).length, 1);
  assert.deepEqual(schema.validateBranch({ tags: [] })[0].path, ['levels']);
  assert.deepEqual(schema.validateBranch(null)[0].path, []);
});

test('schema: tags must be a list, and setTags refuses PAUSE', () => {
  assert.equal(schema.validateExercise(exercise({ tags: 'REGION_CORE' }))[0].path[0], 'tags');
  assert.equal(schema.validateExercise(exercise({ tags: [1] }))[0].message, 'Every tag must be text.');
  assert.equal(schema.validateBranch({ tags: 'x', levels: {} })[0].path[0], 'tags');
  const editor = edits.create(loadSample());
  const r = editor.setTags({ kind: 'exercise', id: '1' }, ['PAUSE']);
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /PAUSE/);
});

test('schema: rejects unknown fitness level, parameter, gender and weight type', () => {
  assert.deepEqual(schema.validateExercise(exercise({ values: values({ default: { beginner: 1 } }) })), []);
  const level = schema.validateExercise(exercise({ values: values({ default: { expert: 1 } }) }));
  assert.deepEqual(level[0].path, ['values', 'weight', 'startValue', 'default', 'expert']);
  const param = schema.validateExercise(exercise({ values: { speed: { startValue: {}, targetValue: {} } } }));
  assert.deepEqual(param[0].path, ['values', 'speed']);
  const gender = schema.validateExercise(exercise({ values: values({ x: {} }) }));
  assert.deepEqual(gender[0].path, ['values', 'weight', 'startValue', 'x']);
  const type = schema.validateExercise(exercise({ values: values({ type: { type: 'Kilo' } }) }));
  assert.deepEqual(type[0].path, ['values', 'weight', 'startValue', 'type', 'type']);
  assert.deepEqual(schema.validateExercise(exercise({ values: values({ type: { type: 'Single' } }) })), []);
  const missing = schema.validateExercise(exercise({ values: { weight: { startValue: {} } } }));
  assert.equal(missing[0].message, 'Target value is missing.');
});

test('schema: rejects an empty name in the editor and non-boolean flags', () => {
  const editor = edits.create(loadSample());
  const r = editor.setField({ kind: 'exercise', id: '1' }, ['name'], '');
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /name must not be empty/);
  assert.equal(schema.validateExercise(exercise({ name: 5 }))[0].path[0], 'name');
  assert.equal(schema.validateExercise(exercise({ isJump: 'yes' }))[0].path[0], 'isJump');
  const flag = editor.setField({ kind: 'exercise', id: '1' }, ['isAdvanceByReps'], 'true');
  assert.equal(flag.ok, false);
  assert.equal(schema.validateExercise(exercise({ level: { m: '1', w: 1 } }))[0].path.join('.'), 'level.m');
  assert.equal(schema.validateExercise(exercise({ conversionFactor: 'x' }))[0].path[0], 'conversionFactor');
  assert.equal(schema.validateExercise(exercise({ equivalentExercises: [1] }))[0].path[0], 'equivalentExercises');
});

test('schema: parseCellInput accepts numbers and empty input only', () => {
  assert.deepEqual(schema.parseCellInput('12'), { ok: true, value: 12 });
  assert.deepEqual(schema.parseCellInput('2,5'), { ok: true, value: 2.5 });
  assert.deepEqual(schema.parseCellInput(' 2.5 '), { ok: true, value: 2.5 });
  assert.deepEqual(schema.parseCellInput('-3'), { ok: true, value: -3 });
  assert.deepEqual(schema.parseCellInput(''), { ok: true, value: '' });
  assert.deepEqual(schema.parseCellInput('   '), { ok: true, value: '' });
  assert.deepEqual(schema.parseCellInput(null), { ok: true, value: '' });
  for (const bad of ['abc', '2x 10 Sek.', '*0', '1,2,3', '1.2.3']) {
    const r = schema.parseCellInput(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(r.message, schema.CELL_MESSAGE);
    assert.equal(r.message, 'Enter a number such as 12 or 2.5, or leave the cell empty.');
  }
});
