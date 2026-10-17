import test from 'node:test';
import assert from 'node:assert/strict';
import * as edits from '../js/core/edits.js';
import * as model from '../js/core/model.js';
import * as review from '../js/core/review.js';
import * as workfile from '../js/core/workfile.js';
import { AutoSave, PREFIX } from '../js/ui/autosave.js';
import { buildBackup, replaceWork, replayOnFreshCopy, settleRestore, swapTrees } from '../js/ui/work-file.js';
import { loadSample, readRaw, stubStorage } from './helpers.js';

const ex = (id) => ({ kind: 'exercise', id });

test('work file: replayOnFreshCopy counts net changes and leaves the session data untouched', () => {
  const ds = loadSample();
  const editor = new edits.Editor(ds);
  editor.setField(ex('1'), ['name'], 'A');
  editor.setField(ex('1'), ['name'], 'B');
  editor.setField(ex('2'), ['level', 'w'], 3);

  const replayed = replayOnFreshCopy(ds, editor.commands());
  assert.equal(replayed.count, 2, 'two edits of one field count once');
  assert.deepEqual(replayed.result, { applied: 3, failed: [] });
  assert.notEqual(replayed.editor.ds, ds);
  assert.equal(replayed.editor.ds.index.exerciseById.get('1').name, 'B');
  assert.deepEqual(replayed.editor.commands(), editor.commands());
});

test('work file: replayOnFreshCopy counts an edit and its revert as nothing', () => {
  const ds = loadSample();
  const editor = new edits.Editor(ds);
  editor.setField(ex('1'), ['name'], 'A');
  editor.revertField(ex('1'), ['name']);
  assert.equal(replayOnFreshCopy(ds, editor.commands()).count, 0);
  assert.equal(replayOnFreshCopy(ds, []).count, 0);
});

test('work file: replayOnFreshCopy reports the commands that do not fit', () => {
  const ds = loadSample();
  const { result, count } = replayOnFreshCopy(ds, [
    { method: 'setField', args: [ex('1'), ['name'], 'Ok'] },
    { method: 'setField', args: [ex('does-not-exist'), ['name'], 'X'] }
  ]);
  assert.equal(count, 1);
  assert.equal(result.applied, 1);
  assert.equal(result.failed.length, 1);
});

test('work file: buildBackup is null without a session or commands and holds the work file otherwise', () => {
  assert.equal(buildBackup({ ctx: null }), null);
  const ds = loadSample();
  const editor = new edits.Editor(ds);
  const state = { ctx: { ds, editor, review: review.create(ds) }, fingerprint: 'fp1', workUnsaved: true };
  assert.equal(buildBackup(state), null);

  editor.setField(ex('1'), ['name'], 'A');
  const backup = buildBackup(state);
  assert.equal(backup.unsaved, true);
  const parsed = workfile.parse(backup.text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.fingerprint, 'fp1');
  assert.deepEqual(parsed.value.commands, editor.commands());
});

// The part of app.js that the backup decisions call: startSession makes a fresh AutoSave, like app.js.
function stubShell() {
  const state = { ctx: null, fingerprint: null, workUnsaved: false, workSavedAt: null, pendingWork: null, autosave: null };
  let routes = 0;
  const app = {
    state,
    startSession(editor) {
      state.autosave?.cancel();
      state.ctx = { ds: editor.ds, editor, review: review.create(editor.ds) };
      state.fingerprint = model.fingerprint(editor.ds);
      state.workUnsaved = false;
      state.autosave = new AutoSave(state.fingerprint, () => buildBackup(state));
    },
    route: () => { routes++; },
    renderHeader: () => {},
    closeMenu: () => {},
    renderWelcome: () => {},
    get routes() {
      return routes;
    }
  };
  app.startSession(new edits.Editor(loadSample()));
  return app;
}

// Stores a backup under key with one rename and a review mark, and returns what AutoSave.read returns.
function storeBackup(storage, app, key, { unsaved }) {
  const marks = review.create(app.state.ctx.ds);
  marks.branches['SKKG/253'] = { status: 'reviewed', comment: '', date: '' };
  const text = workfile.serialize({
    commands: [{ method: 'setField', args: [ex('1'), ['name'], 'Restored'] }],
    review: marks,
    fingerprint: app.state.fingerprint
  });
  storage.items.set(key, JSON.stringify({ unsaved, text }));
  return app.state.autosave.read();
}

const stored = (storage, key) => {
  const entry = JSON.parse(storage.items.get(key));
  return { unsaved: entry.unsaved, work: workfile.parse(entry.text).value };
};

test('work file: declining the backup removes it and keeps the session', (t) => {
  const storage = stubStorage(t);
  const app = stubShell();
  const key = PREFIX + app.state.fingerprint;
  const saved = storeBackup(storage, app, key, { unsaved: true });
  const session = app.state.ctx;
  settleRestore(app, saved, replayOnFreshCopy(session.ds, saved.work.commands).editor, false);
  assert.equal(storage.items.has(key), false);
  assert.equal(app.state.ctx, session);
  assert.equal(app.routes, 0);
});

test('work file: restoring the backup starts a session and rewrites the backup with its unsaved flag', (t) => {
  for (const unsaved of [true, false]) {
    const storage = stubStorage(t);
    const app = stubShell();
    const key = PREFIX + app.state.fingerprint;
    const saved = storeBackup(storage, app, key, { unsaved });
    const { editor } = replayOnFreshCopy(app.state.ctx.ds, saved.work.commands);
    settleRestore(app, saved, editor, true);
    assert.equal(app.state.ctx.editor, editor);
    assert.equal(app.state.ctx.ds.index.exerciseById.get('1').name, 'Restored');
    assert.equal(app.state.ctx.review.branches['SKKG/253'].status, 'reviewed');
    assert.equal(app.state.workUnsaved, unsaved);
    assert.equal(app.routes, 1);
    const backup = stored(storage, key);
    assert.equal(backup.unsaved, unsaved);
    assert.deepEqual(backup.work.commands, editor.commands());
  }
});

test('work file: loading file B leaves the backup of file A in storage untouched', (t) => {
  for (const restore of [true, false]) {
    const storage = stubStorage(t);
    const app = stubShell();
    const keyA = PREFIX + app.state.fingerprint;
    storeBackup(storage, app, keyA, { unsaved: true });
    const backupA = storage.items.get(keyA);

    const rawB = readRaw();
    rawB['Exercises.json'] = rawB['Exercises.json'].replace('\n', '\n ');
    app.startSession(new edits.Editor(model.load(rawB)));
    assert.notEqual(app.state.fingerprint, model.fingerprint(loadSample()));
    assert.equal(app.state.autosave.read(), null, 'file B offers no backup');

    app.state.ctx.editor.setField(ex('1'), ['name'], 'On file B');
    const saved = { work: workfile.parse(buildBackup(app.state).text).value, unsaved: true };
    settleRestore(app, saved, replayOnFreshCopy(app.state.ctx.ds, saved.work.commands).editor, restore);
    app.state.autosave.flush();
    assert.equal(storage.items.get(keyA), backupA);
  }
});

test('work file: opening a work file replaces the old backup', (t) => {
  const storage = stubStorage(t);
  const app = stubShell();
  const key = PREFIX + app.state.fingerprint;
  app.state.ctx.editor.setField(ex('2'), ['name'], 'Session edit');
  app.state.workUnsaved = true;
  app.state.autosave.flush();
  assert.equal(stored(storage, key).work.commands.length, 1);

  const work = workfile.parse(workfile.serialize({
    commands: [{ method: 'setField', args: [ex('1'), ['name'], 'From file'] }, { method: 'setField', args: [ex('3'), ['name'], 'Also'] }],
    review: review.create(app.state.ctx.ds),
    fingerprint: app.state.fingerprint
  })).value;
  const { editor } = replayOnFreshCopy(app.state.ctx.ds, work.commands);
  replaceWork(app, work, editor);
  assert.equal(app.state.ctx.editor, editor);
  assert.equal(app.state.workUnsaved, false);
  const backup = stored(storage, key);
  assert.equal(backup.unsaved, false);
  assert.deepEqual(backup.work.commands, work.commands);
  assert.notEqual(app.state.ctx.ds.index.exerciseById.get('2').name, 'Session edit');
});

// Starts the stub session on Exercises.json alone, as the app does before the trainer picks skill trees.
function exercisesOnlyShell() {
  const app = stubShell();
  const raw = readRaw();
  app.startSession(new edits.Editor(model.load({ 'Exercises.json': raw['Exercises.json'] })));
  const { 'Exercises.json': _, ...trees } = raw;
  return { app, trees };
}

test('work file: swapTrees loads the skill trees, keeps the edits and the backup key', (t) => {
  const storage = stubStorage(t);
  const { app, trees } = exercisesOnlyShell();
  const key = PREFIX + app.state.fingerprint;
  const before = app.state.ctx;
  before.editor.setField(ex('1'), ['name'], 'Kept');
  before.editor.markExported();
  before.review.issues.note = { text: 'kept' };
  app.state.workSavedAt = new Date(0);

  const { editor, result } = swapTrees(app, trees);
  assert.deepEqual(result, { applied: 1, failed: [] });
  assert.equal(app.state.ctx.editor, editor);
  assert.deepEqual(app.state.ctx.ds.treeNames, ['BAS', 'SKKG', 'SUPPORT']);
  assert.equal(app.state.ctx.ds.index.exerciseById.get('1').name, 'Kept');
  assert.equal(app.state.ctx.review.issues.note.text, 'kept');
  assert.equal(app.state.fingerprint, key.slice(PREFIX.length));
  assert.equal(editor.unexportedCount(), 0, 'the export mark carries over');
  assert.equal(app.state.workUnsaved, false);
  assert.deepEqual(app.state.workSavedAt, new Date(0));
  assert.equal(app.routes, 1);
  assert.deepEqual(stored(storage, key).work.commands, editor.commands());
});

test('work file: swapTrees drops a delete of an exercise that a branch uses', (t) => {
  stubStorage(t);
  const { app, trees } = exercisesOnlyShell();
  assert.equal(app.state.ctx.editor.deleteExercise('15').ok, true, 'without skill trees nothing refers to 15');

  const { editor, result } = swapTrees(app, trees);
  assert.equal(result.applied, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].command.method, 'deleteExercise');
  assert.equal(result.failed[0].errors[0].code, 'inUse');
  assert.ok(editor.ds.index.exerciseById.has('15'));
  assert.equal(app.state.workUnsaved, true, 'the dropped delete changes the work');
});

test('work file: swapTrees keeps the session when a skill tree file does not load', (t) => {
  stubStorage(t);
  const { app } = exercisesOnlyShell();
  const before = app.state.ctx;
  assert.throws(() => swapTrees(app, { 'skillTrees/BAD.json': '[]' }), { code: 'treeNotObject' });
  assert.equal(app.state.ctx, before);
});
