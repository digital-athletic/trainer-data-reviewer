import test from 'node:test';
import assert from 'node:assert/strict';
import * as edits from '../js/core/edits.js';
import * as changelog from '../js/core/changelog.js';
import { PINNED_TESTS } from '../js/core/config.js';
import { REAL, loadSample, loadReal } from './helpers.js';

const ex = (id) => ({ kind: 'exercise', id });
const QUAD = PINNED_TESTS.exerciseRegistry.quadricepsTag;

function setup(load = loadSample) {
  const ds = load();
  return { ds, editor: edits.create(ds) };
}

test('changelog: lists repo path, record, field, old and new, and new tags', () => {
  const { ds, editor } = setup();
  editor.setField(ex('1'), ['values', 'weight', 'startValue', 'default', 'advanced'], 45);
  const tags = [...ds.index.exerciseById.get('1').tags, 'NEW_TAG_X'];
  editor.setTags(ex('1'), tags, { confirmedNewTags: ['NEW_TAG_X'] });
  const md = changelog.build(editor, ds, { date: '2026-10-15' });
  assert.match(md, /# Data changes 2026-10-15/);
  assert.match(md, /`athlete-mobile\/assets\/data\/generator\/Exercises\.json`/);
  assert.match(md, /\| athlete-mobile\/assets\/data\/generator\/Exercises\.json \| exercise:1 \| values\.weight\.startValue\.default\.advanced \| 40 \| 45 \|/);
  assert.match(md, /- `NEW_TAG_X` \(confirmed as a new tag\)/);
  assert.deepEqual(changelog.newTags(editor, ds), ['NEW_TAG_X']);
});

test('changelog: no edits give the empty sections', () => {
  const { ds, editor } = setup();
  const md = changelog.build(editor, ds, { date: '2026-10-15' });
  assert.match(md, /No changed files\./);
  assert.match(md, /No changes\./);
  assert.equal(md.match(/^None\.$/gm).length, 2);
  assert.ok(md.endsWith('\n'));
});

test('changelog: escapes pipes and prints an absent value as (none)', () => {
  const { ds, editor } = setup();
  editor.setField(ex('1'), ['name'], 'A | B');
  const { id } = editor.addExercise();
  const md = changelog.build(editor, ds, { date: '2026-10-15' });
  assert.match(md, /\| name \| "Dumbbell shoulder press level 1" \| "A \\\| B" \|/);
  assert.match(md, new RegExp(`exercise:${id} \\| \\(new record\\) \\| \\(none\\) \\|`));
});

test('changelog: a new tag with a backtick or a line break stays inside one code span', () => {
  const { ds, editor } = setup();
  const odd = ['A`B', '`LEAD', 'X\nY'];
  const tags = [...ds.index.exerciseById.get('1').tags, ...odd];
  assert.equal(editor.setTags(ex('1'), tags, { confirmedNewTags: odd }).ok, true);
  const md = changelog.build(editor, ds, { date: '2026-10-15' });
  assert.ok(md.includes('- ``A`B`` (confirmed as a new tag)'), md);
  assert.ok(md.includes('- `` `LEAD `` (confirmed as a new tag)'), md);
  assert.ok(md.includes('- `X Y` (confirmed as a new tag)'), md);
  assert.ok(!md.split('\n').includes('Y` (confirmed as a new tag)'));
});

test('changelog: escapes Markdown and HTML characters in a cell', () => {
  const { ds, editor } = setup();
  editor.setField(ex('1'), ['name'], '<b>`x`</b> [y](z) a\\b');
  const md = changelog.build(editor, ds, { date: '2026-10-15' });
  const row = md.split('\n').find((l) => l.includes('exercise:1 | name |'));
  assert.ok(row.endsWith('| "\\<b\\>\\`x\\`\\</b\\> \\[y\\](z) a\\\\\\\\b" |'), row);
});

test('changelog: a plain value edit produces no pinned-test note', () => {
  const { ds, editor } = setup();
  editor.setField(ex('1'), ['values', 'weight', 'startValue', 'default', 'advanced'], 45);
  assert.deepEqual(changelog.pinnedTestNotes(editor, ds), []);
});

test('changelog: add and delete carry the count note and the reserved id note', () => {
  const { ds, editor } = setup();
  const start = ds.exercises.length;
  assert.equal(editor.addExercise().ok, true);
  assert.ok(changelog.pinnedTestNotes(editor, ds).some((n) =>
    n.includes(PINNED_TESTS.exerciseRegistry.file) && n.includes(`${start + 1} exercises`) &&
    n.includes(`(${PINNED_TESTS.exerciseRegistry.exerciseCount})`)));
  editor.undo();
  const victim = ds.exercises.find((e) => e.id !== '999999' && edits.referencesTo(ds, e.id).length === 0);
  editor.deleteExercise(victim.id);
  const notes = changelog.pinnedTestNotes(editor, ds);
  assert.ok(notes.some((n) => n.includes(`${start - 1} exercises`)));
  assert.ok(notes.some((n) => n.includes(`athlete data in user_exercises (exercise_id) may reference id ${victim.id}`)));
});

test('changelog: a MUSCLE_QUADRICEPS tag change gets a note', () => {
  const { ds, editor } = setup();
  const carriers = ds.exercises.filter((e) => e.tags.includes(QUAD));
  const [quad] = carriers;
  editor.setTags(ex(quad.id), quad.tags.filter((t) => t !== QUAD));
  const notes = changelog.pinnedTestNotes(editor, ds);
  assert.ok(notes.some((n) => n.includes(QUAD) && n.includes(`${carriers.length - 1} exercises carry it`) &&
    n.endsWith(`${PINNED_TESTS.exerciseRegistry.file}:${PINNED_TESTS.exerciseRegistry.quadricepsLine}.`)));
});

test('changelog: a change to the Pause exercise gets a note', () => {
  const { ds, editor } = setup();
  editor.setField(ex('999999'), ['description'], 'Rest');
  assert.ok(changelog.pinnedTestNotes(editor, ds).some((n) => /Pause exercise/.test(n)));
});

test('changelog (real data): the pinned counts in config.js match the data', REAL, () => {
  const { ds } = setup(loadReal);
  const { exerciseRegistry: exReg, skillTreeRegistry: treeReg } = PINNED_TESTS;
  assert.equal(ds.exercises.length, exReg.exerciseCount);
  assert.equal(ds.exercises.filter((e) => e.tags.includes(exReg.quadricepsTag)).length, exReg.quadricepsCount);
  assert.equal(ds.exercises.filter((e) => e.tags.includes('PAUSE')).length, 1);
  assert.equal(Object.keys(ds.trees[treeReg.countedTree]).length, treeReg.countedTreeBranches);
  assert.ok(ds.trees[treeReg.countedTree][treeReg.pinnedBranchId]);
});

test('changelog (real data): an added exercise names the new count', REAL, () => {
  const { ds, editor } = setup(loadReal);
  editor.addExercise();
  assert.ok(changelog.pinnedTestNotes(editor, ds).some((n) => /1211 exercises/.test(n)));
});
