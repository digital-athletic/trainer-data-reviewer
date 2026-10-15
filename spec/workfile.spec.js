import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../js/core/model.js';
import * as edits from '../js/core/edits.js';
import * as review from '../js/core/review.js';
import * as workfile from '../js/core/workfile.js';
import { loadSample } from './helpers.js';

// The marks stand for a work file saved by a newer version of the app.
function session() {
  const ds = loadSample();
  const editor = edits.create(ds);
  const status = review.create(ds);
  editor.setField({ kind: 'exercise', id: '1' }, ['name'], 'Renamed');
  editor.setField({ kind: 'exercise', id: '2' }, ['level', 'w'], 3);
  status.branches['SKKG/253'] = { status: 'reviewed', comment: 'ok', date: '' };
  status.issues['orphan:exercise:13'] = { status: 'accepted', comment: '', date: '' };
  return { ds, editor, status };
}

test('workfile: serialize writes one versioned JSON file', () => {
  const { ds, editor, status } = session();
  const text = workfile.serialize({ commands: editor.commands(), review: status, fingerprint: model.fingerprint(ds), savedAt: '2026-10-15T10:00:00.000Z' });
  assert.ok(text.endsWith('\n'));
  const data = JSON.parse(text);
  assert.equal(data.kind, 'coach-data-review-work');
  assert.equal(data.kind, workfile.KIND);
  assert.equal(data.version, 1);
  assert.equal(data.savedAt, '2026-10-15T10:00:00.000Z');
  assert.equal(data.fingerprint, model.fingerprint(ds));
  assert.equal(data.commands.length, 2);
  assert.equal(data.review.branches['SKKG/253'].status, 'reviewed');
});

test('workfile: parse restores commands and marks, and replay rebuilds the edits', () => {
  const { ds, editor, status } = session();
  const fingerprint = model.fingerprint(ds);
  const parsed = workfile.parse(workfile.serialize({ commands: editor.commands(), review: status, fingerprint }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.warnings, []);
  const { value } = parsed;
  assert.equal(value.fingerprint, fingerprint);
  assert.match(value.savedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(value.commands, editor.commands());
  assert.deepEqual(value.review.branches, status.branches);
  assert.deepEqual(value.review.issues, status.issues);

  const fresh = loadSample();
  const result = edits.create(fresh).replay(value.commands);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(model.changedFiles(fresh), model.changedFiles(ds));
});

test('workfile: serialize copies its input', () => {
  const { editor, status } = session();
  const commands = editor.commands();
  const text = workfile.serialize({ commands, review: status, fingerprint: null });
  status.branches['SKKG/253'].status = 'open';
  commands.length = 0;
  const { value } = workfile.parse(text);
  assert.equal(value.review.branches['SKKG/253'].status, 'reviewed');
  assert.equal(value.commands.length, 2);
  assert.equal(value.fingerprint, null);
});

test('workfile: parse refuses other files with a plain message', () => {
  const bad = [
    'not json',
    '[]',
    '{"kind":"something-else","version":1,"commands":[],"review":{}}',
    JSON.stringify({ kind: workfile.KIND, version: 1, commands: {}, review: {} }),
    JSON.stringify({ kind: workfile.KIND, version: 1, commands: [], review: { version: 1 } }),
    JSON.stringify({ kind: workfile.KIND, version: '1', commands: [], review: {} }),
    '{"version":2,"branches":{},"issues":{}}'
  ];
  for (const text of bad) {
    const r = workfile.parse(text);
    assert.equal(r.ok, false, text);
    assert.match(r.message, /not a work file/, text);
  }
});

test('workfile: parse refuses a newer version and skips unreadable commands', () => {
  const { status } = session();
  const newer = workfile.parse(JSON.stringify({ kind: workfile.KIND, version: 2, commands: [], review: status }));
  assert.equal(newer.ok, false);
  assert.match(newer.message, /newer version/);

  const text = JSON.stringify({
    kind: workfile.KIND,
    version: 1,
    savedAt: 5,
    commands: [{ method: 'setField', args: [] }, { method: 3 }, null],
    review: status
  });
  const parsed = workfile.parse(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.commands.length, 1);
  assert.equal(parsed.value.savedAt, '');
  assert.deepEqual(parsed.warnings, ['Skipped 2 unreadable change(s).']);
});

test('workfile: parse refuses too many commands and skips deeply nested arguments', () => {
  const { status } = session();
  const command = { method: 'setField', args: [{ kind: 'exercise', id: '1' }, ['name'], 'x'] };
  const many = JSON.stringify({
    kind: workfile.KIND, version: 1, review: status,
    commands: Array.from({ length: workfile.MAX_COMMANDS + 1 }, () => command)
  });
  const refused = workfile.parse(many);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /more than 50,000 changes/);

  let deep = 'x';
  for (let i = 0; i < 40; i++) deep = [deep];
  const parsed = workfile.parse(JSON.stringify({
    kind: workfile.KIND, version: 1, review: status,
    commands: [command, { method: 'setField', args: [{ kind: 'exercise', id: '1' }, ['name'], deep] }]
  }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.commands, [command]);
  assert.deepEqual(parsed.warnings, ['Skipped 1 unreadable change(s).']);
});

test('workfile: fileName matches the ignored work file pattern', () => {
  assert.equal(workfile.fileName(new Date('2026-10-15T12:00:00Z')), 'coach-review-work-2026-10-15.json');
  assert.match(workfile.fileName(), /^coach-review-work-\d{4}-\d{2}-\d{2}\.json$/);
});
