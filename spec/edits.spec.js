import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../js/core/model.js';
import * as edits from '../js/core/edits.js';
import * as review from '../js/core/review.js';
import * as workfile from '../js/core/workfile.js';
import { REAL, loadSample, loadReal, differingLines } from './helpers.js';

const EX = 'Exercises.json';
const ex = (id) => ({ kind: 'exercise', id });

function setup(load = loadSample) {
  const ds = load();
  return { ds, editor: edits.create(ds) };
}

const changedText = (ds, path) => model.changedFiles(ds).find((c) => c.path === path)?.text;

const deletableExercise = (ds) =>
  ds.exercises.find((e) => e.id !== '999999' && edits.referencesTo(ds, e.id).length === 0);

test('edits: create returns an Editor instance', () => {
  const { ds, editor } = setup();
  assert.ok(editor instanceof edits.Editor);
  assert.equal(editor.ds, ds);
  assert.deepEqual(editor.highWater, ds.loadMax);
});

function oneValueEditChangesOneLine(load) {
  const { ds, editor } = setup(load);
  const r = editor.setField(ex('1'), ['values', 'weight', 'startValue', 'default', 'advanced'], 45);
  assert.deepEqual(r, { ok: true });
  const files = model.changedFiles(ds);
  assert.deepEqual(files.map((f) => f.path), [EX]);
  const d = differingLines(ds.files[EX].raw, files[0].text);
  assert.equal(d.countA, d.countB);
  assert.equal(d.diff.length, 1);
  assert.match(files[0].text.split('\n')[d.diff[0]], /"advanced": 45,/);
}

function replayReproducesChangedFiles(load) {
  const { ds, editor } = setup(load);
  editor.setField(ex('1'), ['values', 'weight', 'startValue', 'default', 'advanced'], 45);
  const added = editor.addExercise();
  editor.deleteExercise(added.id);
  const again = editor.addExercise();
  editor.setField(ex(again.id), ['name'], 'Replayed');
  editor.setTags(ex('1'), ['BRAND_NEW'], { confirmedNewTags: ['BRAND_NEW'] });
  editor.setField(ex('2'), ['name'], 'temp');
  editor.undo();
  const expected = model.changedFiles(ds);
  // A round trip through JSON, as the work file stores the commands.
  const json = JSON.parse(JSON.stringify(editor.commands()));

  const fresh = load();
  const result = edits.create(fresh).replay(json);
  assert.deepEqual(result.failed, []);
  assert.equal(result.applied, json.length);
  assert.deepEqual(model.changedFiles(fresh), expected);
}

test('edits: one value edit in Exercises.json changes exactly one line', () => oneValueEditChangesOneLine(loadSample));

test('edits (real data): one value edit changes one line', REAL, () => {
  oneValueEditChangesOneLine(loadReal);
});

test('edits: an edit on a conversionFactor-second exercise keeps its key order', () => {
  const { ds, editor } = setup();
  const target = ds.exercises.find((e) => Object.keys(e)[1] === 'conversionFactor');
  assert.ok(target, 'fixture exercise with conversionFactor second');
  const before = Object.keys(target);
  assert.equal(editor.setField(ex(target.id), ['name'], `${target.name} x`).ok, true);
  assert.equal(editor.setField(ex(target.id), ['conversionFactor'], 0.5).ok, true);
  assert.deepEqual(Object.keys(target), before);
  const d = differingLines(ds.files[EX].raw, changedText(ds, EX));
  assert.equal(d.diff.length, 2);
});

test('edits: undo returns changedFiles to empty for created keys and deleted exercises', () => {
  const { ds, editor } = setup();
  const e1 = ds.exercises.find((e) => e.values?.weight?.startValue?.k && !('beginner' in e.values.weight.startValue.k));
  assert.ok(e1);
  editor.setField(ex(e1.id), ['values', 'weight', 'startValue', 'k', 'beginner'], 3);
  const created = editor.journal().at(-1);
  assert.equal(created.oldExisted, false);
  assert.equal(editor.undo().length, 1);
  assert.deepEqual(model.changedFiles(ds), []);

  const victim = deletableExercise(ds);
  const pos = ds.exercises.indexOf(victim);
  assert.equal(editor.deleteExercise(victim.id).ok, true);
  assert.equal(ds.index.exerciseById.has(victim.id), false);
  const undone = editor.undo();
  assert.equal(undone[0].op, 'removeRecord');
  assert.equal(undone[0].index, pos);
  assert.equal(ds.exercises[pos], victim);
  assert.deepEqual(model.changedFiles(ds), []);
  assert.equal(editor.undo(), null);
});

test('edits: setOtherSide with linkBack undoes both sides in one step', () => {
  const { ds, editor } = setup();
  const [a, b] = ds.exercises.filter((e) => e.id !== '999999' && e.otherSideExerciseId == null &&
    !ds.index.otherSideRefsByExerciseId.has(e.id));
  assert.equal(editor.setOtherSide(a.id, b.id, { linkBack: true }).ok, true);
  assert.equal(a.otherSideExerciseId, b.id);
  assert.equal(b.otherSideExerciseId, a.id);
  const groups = new Set(editor.journal().map((e) => e.group));
  assert.equal(groups.size, 1);
  assert.equal(editor.undo().length, 2);
  assert.equal(a.otherSideExerciseId, null);
  assert.equal(b.otherSideExerciseId, null);
  assert.deepEqual(model.changedFiles(ds), []);
  assert.equal(editor.setOtherSide(a.id, a.id).ok, false);
});

test('edits: revertField restores the loaded value', () => {
  const { ds, editor } = setup();
  const original = ds.index.exerciseById.get('1').name;
  editor.setField(ex('1'), ['name'], 'Changed');
  editor.setField(ex('1'), ['level', 'm'], 4);
  assert.equal(editor.revertField(ex('1'), ['name']).ok, true);
  assert.equal(ds.index.exerciseById.get('1').name, original);
  assert.equal(editor.netChanges().length, 1);
  editor.revertField(ex('1'), ['level', 'm']);
  assert.deepEqual(model.changedFiles(ds), []);
});

test('edits: exercise ids are never reused', () => {
  const { ds, editor } = setup();
  const a = editor.addExercise();
  assert.equal(a.ok, true);
  assert.ok(Number(a.id) > ds.loadMax.exerciseId);
  assert.equal(editor.deleteExercise(a.id).ok, true);
  const b = editor.addExercise();
  assert.notEqual(a.id, b.id);
  assert.ok(Number(b.id) > ds.loadMax.exerciseId);
  const added = ds.index.exerciseById.get(b.id);
  assert.equal(added.name, 'New exercise');
  assert.deepEqual(added.tags, []);
  assert.equal(added.values, null);
  assert.equal(ds.exercises.at(-1), added);
  const template = ds.exercises.find((e) => e.id !== '999999');
  assert.deepEqual(Object.keys(added), Object.keys(template).filter((k) => k in added));
});

test('edits: deleteExercise refuses Pause and referenced exercises', () => {
  const { ds, editor } = setup();
  const pause = editor.deleteExercise('999999');
  assert.equal(pause.ok, false);
  assert.match(pause.reason, /Pause is a system exercise/);
  const used = ds.trees.SKKG['253'].levels['1'].exerciseId;
  const r = editor.deleteExercise(used);
  assert.equal(r.ok, false);
  assert.ok(r.references.some((x) => x.kind === 'branchLevel' && x.tree === 'SKKG' && x.branchId === '253' && x.level === '1'));
  const paired = ds.exercises.find((e) => e.otherSideExerciseId != null);
  const refs = edits.referencesTo(ds, paired.otherSideExerciseId);
  assert.ok(refs.some((x) => x.kind === 'otherSide' && x.exerciseId === paired.id));
  assert.equal(editor.journal().length, 0);
});

test('edits: a cell on values null creates the parents and Add parameter writes four genders', () => {
  const { ds, editor } = setup();
  // A new exercise starts with values null.
  const { id } = editor.addExercise();
  const target = ds.index.exerciseById.get(id);
  assert.equal(target.values, null);
  assert.equal(editor.setField(ex(target.id), ['values', 'repetition', 'startValue', 'm', 'beginner'], '2,5').ok, true);
  assert.equal(target.values.repetition.startValue.m.beginner, 2.5);
  assert.deepEqual(Object.keys(target.values.repetition.targetValue), ['default', 'm', 'w', 'k']);
  assert.equal(editor.setField(ex(target.id), ['values', 'height'], edits.emptyParameter()).ok, true);
  assert.deepEqual(target.values.height, {
    startValue: { default: {}, m: {}, w: {}, k: {} },
    targetValue: { default: {}, m: {}, w: {}, k: {} }
  });
  editor.undo();
  editor.undo();
  assert.equal(target.values, null);
  editor.undo();
  assert.deepEqual(model.changedFiles(ds), []);
});

test('edits: cell and text field rules', () => {
  const { ds, editor } = setup();
  const r = editor.setField(ex('1'), ['values', 'weight', 'startValue', 'default', 'advanced'], 'abc');
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /Enter a number/);
  editor.setField(ex('1'), ['values', 'weight', 'startValue', 'k', 'beginner'], '');
  assert.equal(editor.journal().length, 0);
  editor.setField(ex('1'), ['values', 'weight', 'startValue', 'default', 'advanced'], '');
  assert.equal(ds.index.exerciseById.get('1').values.weight.startValue.default.advanced, '');
  editor.setField(ex('1'), ['displayName'], '');
  assert.equal(ds.index.exerciseById.get('1').displayName, null);
  assert.equal(editor.setField(ex('1'), ['name'], '  ').ok, false);
  assert.equal(editor.setField(ex('1'), ['id'], '5').ok, false);
  assert.equal(editor.setField(ex('1'), ['tags'], []).ok, false);
});

test('edits: setTags dedupes, refuses PAUSE and asks for new tags', () => {
  const { ds, editor } = setup();
  const t = ex('1');
  const tags = [...ds.index.exerciseById.get('1').tags];
  assert.equal(editor.setTags(t, [...tags, tags[0]]).ok, true);
  assert.deepEqual(ds.index.exerciseById.get('1').tags, tags);
  assert.equal(editor.setTags(t, [...tags, 'PAUSE']).ok, false);
  assert.equal(editor.setTags(t, [...tags, 'NEW_TAG_X']).ok, false);
  assert.equal(editor.setTags(t, [...tags, 'NEW_TAG_X'], { confirmedNewTags: ['NEW_TAG_X'] }).ok, true);
  assert.deepEqual(editor.journal().at(-1).newTags, ['NEW_TAG_X']);
});

test('edits: replay of commands on a fresh load reproduces changedFiles', () => replayReproducesChangedFiles(loadSample));

test('edits (real data): replay of commands on a fresh load reproduces changedFiles', REAL, () => replayReproducesChangedFiles(loadReal));

test('edits: replay reports unknown and failing commands', () => {
  const { editor } = setup();
  const result = editor.replay([
    { method: 'setField', args: [ex('1'), ['name'], 'Ok'] },
    { method: 'constructor', args: [] },
    { method: 'setField', args: [ex('1'), ['name'], ''] }
  ]);
  assert.equal(result.applied, 1);
  assert.equal(result.failed.length, 2);
  assert.match(result.failed[0].errors[0].message, /Unknown change "constructor"/);
});

test('edits: subscribe, changeCount and unexportedCount', () => {
  const { editor } = setup();
  const seen = [];
  const off = editor.subscribe((applied) => seen.push(applied.length));
  editor.setField(ex('1'), ['name'], 'A');
  editor.setField(ex('1'), ['level', 'w'], 3);
  assert.deepEqual(seen, [1, 1]);
  assert.equal(editor.changeCount(), 2);
  assert.equal(editor.unexportedCount(), 2);
  editor.markExported();
  assert.equal(editor.unexportedCount(), 0);
  editor.undo();
  assert.equal(editor.unexportedCount(), 1);
  off();
  editor.setField(ex('1'), ['name'], 'B');
  assert.equal(seen.length, 3);
  const change = editor.netChanges().find((c) => c.field === 'name');
  assert.equal(change.repoPath, 'athlete-mobile/assets/data/generator/Exercises.json');
  assert.equal(change.recordKey, 'exercise:1');
  assert.equal(change.newValue, 'B');
});

test('edits: unexportedCount counts net changes, not editing steps', async (t) => {
  await t.test('the same cell edited twice counts once', () => {
    const { editor } = setup();
    editor.setField(ex('1'), ['name'], 'A');
    editor.setField(ex('1'), ['name'], 'B');
    assert.equal(editor.unexportedCount(), 1);
  });
  await t.test('an edit and its revert count nothing', () => {
    const { editor } = setup();
    editor.setField(ex('1'), ['name'], 'A');
    editor.revertField(ex('1'), ['name']);
    assert.equal(editor.commands().length, 2);
    assert.equal(editor.unexportedCount(), 0);
  });
  await t.test('one more edit after an export counts one', () => {
    const { editor } = setup();
    editor.setField(ex('1'), ['name'], 'A');
    editor.setField(ex('1'), ['level', 'w'], 3);
    editor.markExported();
    assert.equal(editor.unexportedCount(), 0);
    editor.setField(ex('2'), ['name'], 'C');
    assert.equal(editor.unexportedCount(), 1);
    assert.equal(editor.changeCount(), 3);
  });
  await t.test('reverting an exported change counts one', () => {
    const { editor } = setup();
    editor.setField(ex('1'), ['name'], 'A');
    editor.setField(ex('1'), ['level', 'w'], 3);
    editor.markExported();
    editor.revertField(ex('1'), ['name']);
    assert.equal(editor.changeCount(), 1);
    assert.equal(editor.unexportedCount(), 1);
  });
  await t.test('a replay with N net changes counts N', () => {
    const { editor } = setup();
    editor.setField(ex('1'), ['name'], 'A');
    editor.setField(ex('1'), ['name'], 'B');
    editor.setField(ex('2'), ['name'], 'C');
    editor.revertField(ex('2'), ['name']);
    editor.setField(ex('3'), ['name'], 'D');
    editor.setField(ex('1'), ['level', 'w'], 3);
    const probe = edits.create(loadSample());
    probe.replay(JSON.parse(JSON.stringify(editor.commands())));
    assert.equal(editor.changeCount(), 3);
    assert.equal(probe.changeCount(), 3);
    assert.equal(probe.unexportedCount(), 3);
  });
  await t.test('setOtherSide with linkBack counts two', () => {
    const { ds, editor } = setup();
    const [a, b] = ds.exercises.filter((e) => e.id !== model.PAUSE_ID && e.otherSideExerciseId == null &&
      !ds.index.otherSideRefsByExerciseId.has(e.id));
    assert.equal(editor.setOtherSide(a.id, b.id, { linkBack: true }).ok, true);
    assert.equal(editor.unexportedCount(), 2);
  });
});

test('edits: a work file with a __proto__ path pollutes nothing and reports the command as failed', () => {
  const { editor } = setup();
  const text = workfile.serialize({
    commands: [
      { method: 'setField', args: [ex('1'), ['__proto__', 'x'], 'polluted'] },
      { method: 'setField', args: [ex('1'), ['values', 'constructor', 'prototype', 'x'], 'polluted'] },
      { method: 'revertField', args: [ex('1'), ['__proto__', 'x']] }
    ],
    review: review.create(editor.ds),
    fingerprint: null
  });
  const parsed = workfile.parse(text);
  assert.equal(parsed.ok, true);
  const result = editor.replay(parsed.value.commands);
  assert.equal(({}).x, undefined);
  assert.equal(result.applied, 0);
  assert.equal(result.failed.length, 3);
  assert.match(result.failed[0].errors[0].message, /"__proto__" is not allowed/);
  assert.equal(editor.journal().length, 0);
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
