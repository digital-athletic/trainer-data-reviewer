import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../js/core/model.js';
import { REAL, REAL_DIR, readRaw, loadSample, loadReal } from './helpers.js';

function assertRoundTrip(raw) {
  for (const [p, text] of Object.entries(raw)) {
    if (p === 'skillTrees/SUPPORT.json') continue;
    const nl = text.endsWith('\n');
    assert.equal(JSON.stringify(JSON.parse(text), null, 2) + (nl ? '\n' : ''), text, p);
  }
}

test('model: loads the sample catalog and skill trees', () => {
  const ds = loadSample();
  assert.deepEqual(model.stats(ds), { exercises: 17, trees: 3, branches: 9 });
  assert.equal(ds.exercises, ds.files['Exercises.json'].data);
  assert.deepEqual(ds.treeNames, ['BAS', 'SKKG', 'SUPPORT']);
  assert.equal(ds.files['Exercises.json'].repoPath, 'athlete-mobile/assets/data/generator/Exercises.json');
  assert.equal(ds.files['skillTrees/SKKG.json'].treeName, 'SKKG');
  assert.deepEqual(ds.loadMax, { exerciseId: 16, branchId: 551 });
  assert.deepEqual(model.changedFiles(ds), []);
});

test('model: every sample file except SUPPORT round trips through JSON.stringify', () => {
  const raw = readRaw();
  assertRoundTrip(raw);
  assert.equal(raw['Exercises.json'].endsWith('\n'), true);
  assert.equal(raw['skillTrees/BAS.json'].endsWith('\n'), true);
  assert.equal(raw['skillTrees/SKKG.json'].endsWith('\n'), false);
  assert.equal(raw['skillTrees/SUPPORT.json'], '{\n\n}');
});

test('model: fingerprint is stable and changes with the raw text', () => {
  const a = model.fingerprint(loadSample());
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(model.fingerprint(loadSample()), a);
  const raw = readRaw();
  raw['skillTrees/SUPPORT.json'] = '{}';
  assert.notEqual(model.fingerprint(model.load(raw)), a);
});

test('model: buildIndex maps references, other sides and tag counts', () => {
  const { index } = loadSample();
  assert.deepEqual(index.branchRefsByExerciseId.get('15'), [
    { tree: 'BAS', branchId: '548', level: '3' },
    { tree: 'BAS', branchId: '549', level: '1' }
  ]);
  assert.deepEqual(index.otherSideRefsByExerciseId.get('5'), ['4']);
  assert.equal(index.treeOfBranch.get('253'), 'SKKG');
  assert.equal(index.tagCounts.exercise.get('EQ_DUMBBELL'), 2);
  assert.equal(index.tagCounts.branch.get('REGION_UPPER_BODY'), 6);
  assert.equal(index.branchRefsByExerciseId.has('13'), false);
});

test('model: path helpers work in place and keep key order', () => {
  const obj = { a: 1, b: { c: 2 }, d: null };
  model.setAt(obj, ['a'], 5);
  model.setAt(obj, ['d', 'e', 'f'], 3);
  assert.deepEqual(Object.keys(obj), ['a', 'b', 'd']);
  assert.deepEqual(obj.d, { e: { f: 3 } });
  assert.equal(model.getAt(obj, ['b', 'c']), 2);
  assert.equal(model.getAt(obj, ['x', 'y']), undefined);
  assert.equal(model.hasAt(obj, ['b', 'c']), true);
  model.deleteAt(obj, ['b', 'c']);
  assert.deepEqual(obj.b, {});
  assert.equal(model.hasAt(obj, ['b', 'c']), false);
});

test('model: setAt, getAt and deleteAt refuse prototype keys', () => {
  const obj = {};
  assert.throws(() => model.setAt(obj, ['__proto__', 'x'], 1), /not allowed/);
  assert.throws(() => model.setAt(obj, ['a', 'constructor'], 1), /not allowed/);
  assert.throws(() => model.deleteAt(obj, ['prototype']), /not allowed/);
  assert.equal(model.getAt(obj, ['__proto__']), undefined);
  assert.equal(model.hasAt(obj, ['constructor']), false);
  assert.equal(({}).x, undefined);
});

test('model: originalExercise returns the loaded record and ignores later edits', () => {
  const ds = loadSample();
  const loaded = model.originalExercise(ds, '1');
  assert.equal(loaded.id, '1');
  assert.notEqual(loaded, ds.index.exerciseById.get('1'));
  const name = loaded.name;
  ds.index.exerciseById.get('1').name = 'Changed';
  assert.equal(model.originalExercise(ds, 1).name, name);
  assert.equal(model.originalExercise(ds, '1'), loaded);
  assert.equal(model.originalExercise(ds, '424242'), undefined);
});

test('model: isChanged compares a field with the loaded file', () => {
  const ds = loadSample();
  const rec = ds.index.exerciseById.get('1');
  assert.equal(model.isChanged(ds, rec, ['name']), false);
  rec.name = 'Changed';
  assert.equal(model.isChanged(ds, rec, ['name']), true);
  assert.equal(model.isChanged(ds, rec, ['level']), false);
  rec.extra = 1;
  assert.equal(model.isChanged(ds, rec, ['extra']), true);
  assert.equal(model.isChanged(ds, { id: '424242', name: 'New' }, ['name']), false);
});

test('model: localDate formats the local calendar date', () => {
  assert.equal(model.localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(model.localDate(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
  assert.match(model.localDate(), /^\d{4}-\d{2}-\d{2}$/);
});

test('model: TAG_GROUPS lists every prefix tagPrefix knows once', () => {
  const prefixes = model.TAG_GROUPS.map((g) => g.prefix);
  assert.equal(new Set(prefixes).size, prefixes.length);
  for (const p of prefixes) assert.equal(model.tagPrefix(`${p}X`), p);
});

test('model: deepEqual and clone', () => {
  assert.equal(model.deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(model.deepEqual({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(model.deepEqual([1], { 0: 1 }), false);
  const src = { a: { b: 1 } };
  const copy = model.clone(src);
  assert.deepEqual(copy, src);
  assert.notEqual(copy.a, src.a);
  assert.equal(model.clone(undefined), undefined);
});

test('model: tagPrefix picks the longest known prefix', () => {
  const p = model.tagPrefix;
  assert.equal(p('EQ_TYPE_WEIGHTS'), 'EQ_TYPE_');
  assert.equal(p('EQ_DUMBBELL'), 'EQ_');
  assert.equal(p('MUSCLE_SECONDARY_NECK'), 'MUSCLE_SECONDARY_');
  assert.equal(p('MUSCLE_INVOLVEMENT_COMPLEX'), 'MUSCLE_INVOLVEMENT_');
  assert.equal(p('MUSCLE_CHEST'), 'MUSCLE_');
  assert.equal(p('EXERCISE_DIRECTION_KNEE'), 'EXERCISE_DIRECTION_');
  assert.equal(p('SEASON_PHASE_PAUSE'), 'SEASON_PHASE_');
  assert.equal(p('BLOCK_KNEE'), 'BLOCK_');
  assert.equal(p('PAUSE'), 'PAUSE');
});

test('model: exerciseLabel prefers displayName', () => {
  assert.equal(model.exerciseLabel({ name: 'n', displayName: 'd' }), 'd');
  assert.equal(model.exerciseLabel({ name: 'n', displayName: null }), 'n');
});

test('model: load throws a plain message for broken input', () => {
  assert.throws(() => model.load({}), /Exercises\.json is missing/);
  assert.throws(() => model.load({ 'Exercises.json': '[', 'skillTrees/A.json': '{}' }), /not valid JSON/);
  assert.throws(() => model.load({ 'Exercises.json': '{}' }), /must hold a list/);
  assert.throws(() => model.load({ 'Exercises.json': '[]', 'other.json': '{}' }), /Unexpected file/);
});

test('model (real data): loads the real catalog and skill trees', REAL, () => {
  const ds = loadReal();
  assert.deepEqual(model.stats(ds), { exercises: 1210, trees: 27, branches: 852 });
  assert.equal(ds.treeNames.length, 27);
  assert.deepEqual(ds.treeNames, ds.treeNames.toSorted());
  assert.ok(ds.loadMax.exerciseId > 0 && ds.loadMax.exerciseId < 999999);
  assert.ok(ds.loadMax.branchId > 0);
  assert.deepEqual(model.changedFiles(ds), []);
});

test('model (real data): all 28 files round trip, SUPPORT through the raw shortcut', REAL, () => {
  const raw = readRaw(REAL_DIR);
  assert.equal(Object.keys(raw).length, 28);
  assertRoundTrip(raw);
  assert.equal(raw['Exercises.json'].endsWith('\n'), true);
  assert.equal(raw['skillTrees/SKKG.json'].endsWith('\n'), false);
  const ds = loadReal();
  assert.equal(model.serializeFile(ds, 'skillTrees/SUPPORT.json'), raw['skillTrees/SUPPORT.json']);
  assert.deepEqual(model.changedFiles(ds), []);
});
