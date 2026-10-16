import { ATHLETE_DATA_TABLE, PINNED_TESTS } from './config.js';
import { PAUSE_TAG, changedFiles, localDate, originalExercise, parseRecordKey } from './model.js';

/**
 * @typedef {import('./model.js').Dataset} Dataset
 * @typedef {import('./edits.js').Editor} Editor
 * @typedef {import('./edits.js').Change} Change
 */

const { exerciseRegistry: EX_TEST, skillTreeRegistry: TREE_TEST } = PINNED_TESTS;
const RECORD_FIELDS = ['(new record)', '(deleted)'];

const json = (value) => (value === undefined ? '(none)' : JSON.stringify(value));
// CRLF, CR, LF, and U+2028 (Zl) and U+2029 (Zp), the Unicode line and paragraph separators.
const LINE_BREAK = /\r\n|[\r\n\p{Zl}\p{Zp}]/gu;
// Escapes the characters that start Markdown or HTML syntax inside a table cell, on one line.
const esc = (s) => String(s).replace(/[\\`|<>[\]&*_~!]/g, '\\$&').replace(LINE_BREAK, ' ');
// A code span whose fence is longer than any backtick run in the text, on one line.
function code(s) {
  const text = String(s).replace(LINE_BREAK, ' ');
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}
const hasTag = (record, tag) => Array.isArray(record?.tags) && record.tags.includes(tag);

/**
 * Notes for the developer when the edits change a value that a test of the target
 * repository pins, plus a reserved-id note for every deleted record.
 * @param {Editor} editor @param {Dataset} ds
 * @param {Change[]} [changes] the current editor.netChanges(), to skip computing them again
 * @returns {string[]}
 */
export function pinnedTestNotes(editor, ds, changes = editor.netChanges()) {
  const quadTag = EX_TEST.quadricepsTag;
  const notes = [];
  let exAddDel = false;
  let quad = false;
  let pause = false;
  let countedTreeAddDel = false;
  let pinnedBranch = false;
  const deleted = [];
  const treesWithRecords = new Set();
  for (const c of changes) {
    const k = parseRecordKey(c.recordKey).target;
    const isRecord = RECORD_FIELDS.includes(c.field);
    if (c.field === '(deleted)') deleted.push(k);
    if (k.kind === 'exercise') {
      if (isRecord) exAddDel = true;
      if (isRecord && (hasTag(c.oldValue, quadTag) || hasTag(c.newValue, quadTag))) quad = true;
      if (c.field === 'tags' && hasTag({ tags: c.oldValue }, quadTag) !== hasTag({ tags: c.newValue }, quadTag)) quad = true;
      const cur = ds.index.exerciseById.get(k.id);
      if (hasTag(cur, PAUSE_TAG) || hasTag(isRecord ? c.oldValue : originalExercise(ds, k.id), PAUSE_TAG)) pause = true;
    } else {
      if (isRecord) treesWithRecords.add(k.tree);
      if (isRecord && k.tree === TREE_TEST.countedTree) countedTreeAddDel = true;
      if (k.branchId === TREE_TEST.pinnedBranchId && (isRecord || /^(levels|tags)(\.|$)/.test(c.field))) pinnedBranch = true;
    }
  }
  if (exAddDel) {
    notes.push(`Exercises were added or deleted: the catalog now holds ${ds.exercises.length} exercises. Update the count tests (${EX_TEST.exerciseCount}) in ${EX_TEST.file}.`);
  }
  for (const tree of [...treesWithRecords].sort()) {
    notes.push(`Branches were added or deleted in skill tree ${tree}: check the branch counts in ${TREE_TEST.file}.`);
  }
  if (quad) {
    const n = ds.exercises.filter((x) => hasTag(x, quadTag)).length;
    notes.push(`The ${quadTag} tag changed on exercises: ${n} exercises carry it now. Update the count (${EX_TEST.quadricepsCount}) in ${EX_TEST.file}:${EX_TEST.quadricepsLine}.`);
  }
  if (pause) notes.push(`The Pause exercise (PAUSE tag) changed. Check ${EX_TEST.file}:${EX_TEST.pauseLine} and the Pause test.`);
  if (countedTreeAddDel) {
    const tree = TREE_TEST.countedTree;
    const n = Object.keys(ds.trees[tree] ?? {}).length;
    notes.push(`A ${tree} branch was added or deleted: ${tree} now has ${n} branches. Update the count (${TREE_TEST.countedTreeBranches}) in ${TREE_TEST.file}:${TREE_TEST.countedTreeLine}.`);
  }
  if (pinnedBranch) {
    const bid = TREE_TEST.pinnedBranchId;
    notes.push(`Branch ${bid} changed. Check the branch ${bid} test in ${TREE_TEST.file}:${TREE_TEST.pinnedBranchLines}.`);
  }
  for (const k of deleted) {
    const isExercise = k.kind === 'exercise';
    const id = code(isExercise ? k.id : k.branchId);
    const table = `${ATHLETE_DATA_TABLE} (${isExercise ? 'exercise_id' : 'branch_id'})`;
    notes.push(`Deleted ${isExercise ? 'exercise' : 'branch'} ${id}: athlete data in ${table} may reference id ${id}. The id stays reserved.`);
  }
  return notes;
}

/** Confirmed new tags that are still in use. @param {Editor} editor @param {Dataset} ds @returns {string[]} */
export function newTags(editor, ds) {
  const { exercise, branch } = ds.index.tagCounts;
  const tags = new Set(editor.journal().flatMap((e) => e.newTags ?? []).filter((t) => exercise.has(t) || branch.has(t)));
  return [...tags].sort();
}

/**
 * @param {Editor} editor @param {Dataset} ds
 * @param {{ date?: string, changes?: Change[] }} [opts] changes: the current editor.netChanges()
 * @returns {string} markdown
 */
export function build(editor, ds, opts) {
  const date = opts?.date || localDate();
  const files = changedFiles(ds);
  const changes = opts?.changes ?? editor.netChanges();
  const lines = [`# Data changes ${date}`, '', '## Files', ''];
  if (!files.length) lines.push('No changed files.');
  for (const f of files) lines.push(`- ${code(f.repoPath)}`);
  lines.push('', '## Changes', '');
  if (changes.length) {
    lines.push('| File | Record | Field | Old | New |', '|---|---|---|---|---|');
    for (const c of changes) {
      const cells = [c.repoPath, c.recordKey, c.field, json(c.oldValue), json(c.newValue)].map(esc);
      lines.push(`| ${cells.join(' | ')} |`);
    }
  } else {
    lines.push('No changes.');
  }
  const tags = newTags(editor, ds);
  lines.push('', '## New tags', '');
  lines.push(...(tags.length ? tags.map((t) => `- ${code(t)} (confirmed as a new tag)`) : ['None.']));
  const notes = pinnedTestNotes(editor, ds, changes);
  lines.push('', '## Notes for the developer', '');
  lines.push(...(notes.length ? notes.map((n) => `- ${n}`) : ['None.']), '');
  return lines.join('\n');
}
