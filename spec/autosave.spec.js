import test from 'node:test';
import assert from 'node:assert/strict';
import * as review from '../js/core/review.js';
import * as workfile from '../js/core/workfile.js';
import { AutoSave, PREFIX } from '../js/ui/autosave.js';
import { loadSample, stubStorage } from './helpers.js';

const KEY = `${PREFIX}fp1`;

function workText({ name = 'A' } = {}) {
  const ds = loadSample();
  return workfile.serialize({
    commands: [{ method: 'setField', args: [{ kind: 'exercise', id: '1' }, ['name'], name] }],
    review: review.create(ds),
    fingerprint: 'fp1'
  });
}

test('autosave: read returns the stored work and its unsaved flag', (t) => {
  const storage = stubStorage(t);
  const save = new AutoSave('fp1', () => null);
  assert.equal(save.read(), null);

  storage.items.set(KEY, JSON.stringify({ unsaved: false, text: workText() }));
  const saved = save.read();
  assert.equal(saved.unsaved, false);
  assert.equal(saved.work.commands.length, 1);
  assert.equal(saved.work.commands[0].method, 'setField');

  storage.items.set(KEY, JSON.stringify({ text: workText() }));
  assert.equal(save.read().unsaved, true, 'a backup without the flag counts as unsaved');
});

test('autosave: read returns null for broken JSON and a text that is not a work file', (t) => {
  const storage = stubStorage(t);
  const save = new AutoSave('fp1', () => null);
  storage.items.set(KEY, '{broken');
  assert.equal(save.read(), null);
  storage.items.set(KEY, JSON.stringify({ unsaved: true, text: '{"kind":"other"}' }));
  assert.equal(save.read(), null);
  storage.items.set(KEY, JSON.stringify({ unsaved: true }));
  assert.equal(save.read(), null);
});

test('autosave: read ignores an entry whose text is larger than a work file may be', (t) => {
  const storage = stubStorage(t);
  const save = new AutoSave('fp1', () => null);
  const text = workText();
  storage.items.set(KEY, JSON.stringify({ unsaved: true, text: text + ' '.repeat(workfile.MAX_FILE_BYTES) }));
  assert.equal(save.read(), null);
});

test('autosave: read offers only the backup of its own fingerprint', (t) => {
  const storage = stubStorage(t);
  const save = new AutoSave('fp1', () => null);
  storage.items.set(`${PREFIX}fp2`, JSON.stringify({ unsaved: true, text: workText({ name: 'Other file' }) }));
  assert.equal(save.read(), null);

  storage.items.set(KEY, JSON.stringify({ unsaved: true, text: workText({ name: 'Own file' }) }));
  assert.equal(save.read().work.commands[0].args[2], 'Own file');
  save.forget();
  assert.equal(storage.items.has(KEY), false);
  assert.equal(storage.items.has(`${PREFIX}fp2`), true, 'forget removes only the own backup');
});

test('autosave: flush keeps the stored backup while the session has no commands', (t) => {
  const storage = stubStorage(t);
  const earlier = JSON.stringify({ unsaved: true, text: workText() });
  storage.items.set(KEY, earlier);
  const save = new AutoSave('fp1', () => null);
  save.flush();
  assert.equal(storage.items.get(KEY), earlier);
});

test('autosave: flush writes the backup, and removes it once the session has no commands again', (t) => {
  const storage = stubStorage(t);
  let backup = { unsaved: true, text: workText() };
  const save = new AutoSave('fp1', () => backup);
  save.flush();
  assert.deepEqual(JSON.parse(storage.items.get(KEY)), backup);

  backup = null;
  save.flush();
  assert.equal(storage.items.has(KEY), false);
});

test('autosave: forget removes the backup and drops a pending write', async (t) => {
  const storage = stubStorage(t);
  storage.items.set(KEY, 'x');
  const save = new AutoSave('fp1', () => ({ unsaved: true, text: 'y' }), { delay: 1 });
  save.schedule();
  save.forget();
  await new Promise((resolve) => { setTimeout(resolve, 10); });
  assert.equal(storage.items.has(KEY), false);
});

test('autosave: onFail runs once when the browser refuses to store', (t) => {
  stubStorage(t, { failSet: true });
  let calls = 0;
  const save = new AutoSave('fp1', () => ({ unsaved: true, text: 'x' }), { onFail: () => { calls++; } });
  save.flush();
  save.flush();
  assert.equal(calls, 1);
});
