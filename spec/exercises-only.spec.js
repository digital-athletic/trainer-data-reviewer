import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../js/core/model.js';
import * as edits from '../js/core/edits.js';
import * as review from '../js/core/review.js';
import * as changelog from '../js/core/changelog.js';
import * as workfile from '../js/core/workfile.js';
import { loadSample, readRaw } from './helpers.js';

// The app picks Exercises.json alone, so the dataset holds zero skill trees.
const exercisesRaw = () => ({ [model.EXERCISES]: readRaw()[model.EXERCISES] });
const loadExercisesOnly = () => model.load(exercisesRaw());
const ex = (id) => ({ kind: 'exercise', id });

function session() {
  const ds = loadExercisesOnly();
  const editor = new edits.Editor(ds);
  editor.setField(ex('1'), ['name'], 'Renamed');
  editor.setField(ex('2'), ['level', 'w'], 3);
  return { ds, editor };
}

test('exercises only: Exercises.json alone loads with zero skill trees', () => {
  const ds = loadExercisesOnly();
  assert.deepEqual(Object.keys(ds.files), [model.EXERCISES]);
  assert.deepEqual(model.stats(ds), { exercises: 17, trees: 0, branches: 0 });
  assert.deepEqual(ds.treeNames, []);
  assert.deepEqual(ds.trees, {});
  assert.equal(ds.loadMax.branchId, 0);
  assert.equal(ds.index.branchRefsByExerciseId.size, 0);
  assert.deepEqual(review.create(ds).datasetCounts, { exercises: 17, branches: 0 });
});

test('exercises only: an exercise that a branch uses in the full sample has no references', () => {
  const used = String(loadSample().trees.SKKG['253'].levels['1'].exerciseId);
  const ds = loadExercisesOnly();
  assert.equal(edits.referencesTo(ds, used).some((r) => r.kind === 'branchLevel'), false);
});

test('exercises only: export writes Exercises.json alone and the changelog names it', () => {
  const { ds, editor } = session();
  const files = model.changedFiles(ds);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, model.EXERCISES);
  assert.equal(files[0].fileName, 'Exercises.json');
  assert.equal(files[0].repoPath, model.REPO_BASE + model.EXERCISES);
  assert.equal(JSON.parse(files[0].text).find((x) => x.id === '1').name, 'Renamed');
  assert.equal(editor.changeCount(), 2);
  assert.deepEqual(changelog.pinnedTestNotes(editor, ds), []);
  const md = changelog.build(editor, ds, { date: '2026-10-16' });
  assert.match(md, /^# Data changes 2026-10-16/);
  assert.ok(md.includes(`- \`${model.REPO_BASE}${model.EXERCISES}\``));
});

test('exercises only: a branch edit fails with a plain message', () => {
  const { editor } = session();
  const r = editor.setField({ kind: 'branch', tree: 'SKKG', branchId: '253' }, ['name'], 'x');
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /does not exist/);
});

test('exercises only: a work file round trip replays on a fresh load', () => {
  const { ds, editor } = session();
  const fingerprint = model.fingerprint(ds);
  const text = workfile.serialize({ commands: editor.commands(), review: review.create(ds), fingerprint });
  const parsed = workfile.parse(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.fingerprint, fingerprint);

  const fresh = loadExercisesOnly();
  assert.equal(model.fingerprint(fresh), fingerprint);
  const result = new edits.Editor(fresh).replay(parsed.value.commands);
  assert.deepEqual(result, { applied: 2, failed: [] });
  assert.deepEqual(model.changedFiles(fresh), model.changedFiles(ds));
});

test('exercises only: a work file saved for the data folder gives a fingerprint mismatch, no crash', () => {
  const folder = loadSample();
  const old = new edits.Editor(folder);
  old.setField(ex('1'), ['name'], 'Renamed');
  const tagged = old.setTags({ kind: 'branch', tree: 'SKKG', branchId: '253' }, ['SKILL_A'], { confirmedNewTags: ['SKILL_A'] });
  assert.equal(tagged.ok, true);
  const text = workfile.serialize({ commands: old.commands(), review: review.create(folder), fingerprint: model.fingerprint(folder) });

  const parsed = workfile.parse(text);
  assert.equal(parsed.ok, true);
  const ds = loadExercisesOnly();
  assert.notEqual(parsed.value.fingerprint, model.fingerprint(ds));
  const result = new edits.Editor(ds).replay(parsed.value.commands);
  assert.equal(result.applied, old.commands().length - 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].command.method, 'setTags');
  assert.match(result.failed[0].errors[0].message, /does not exist/);
  assert.equal(ds.index.exerciseById.get('1').name, 'Renamed');
});
