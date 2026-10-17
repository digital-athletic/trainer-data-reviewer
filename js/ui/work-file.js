// Work file and browser backup: save the work, open a work file, restore the backup.
import * as model from '../core/model.js';
import * as edits from '../core/edits.js';
import * as workfile from '../core/workfile.js';
import { confirmDialog, Dialog, download, h, messageDialog, toast } from './dom.js';
import { coreText, locale, t } from './i18n.js';

/**
 * @typedef {{ ctx: import('./registry.js').Ctx | null, fingerprint: string | null, workUnsaved: boolean,
 *   workSavedAt: Date | null, pendingWork: PendingWork | null, autosave: import('./autosave.js').AutoSave | null }} AppState
 *   The part of the app.js state these functions read and write.
 * @typedef {{ state: AppState, startSession: (editor: edits.Editor) => void, renderHeader: () => void,
 *   route: (force: boolean) => void, closeMenu: () => void, renderWelcome: () => void }} Shell
 *   The app.js functions these functions call.
 * @typedef {{ name: string, work: workfile.Work, warnings: string[] }} PendingWork
 */

const MAX_MB = workfile.MAX_FILE_BYTES / (1024 * 1024);

const p = (text) => h('p', null, text);
const rawOf = (ds) => Object.fromEntries(Object.entries(ds.files).map(([path, f]) => [path, f.raw]));

/** The work file text of the current session. @param {AppState} state @returns {string} */
const workText = (state) => workfile.serialize({
  commands: state.ctx.editor.commands(),
  review: state.ctx.review,
  fingerprint: state.fingerprint
});

/** The backup AutoSave writes, or null while the session has no commands. @param {AppState} state */
export function buildBackup(state) {
  const { ctx } = state;
  if (!ctx) return null;
  if (!ctx.editor.commands().length) return null;
  return { unsaved: state.workUnsaved, text: workText(state) };
}

/**
 * Replays commands on a fresh copy of the files ds was loaded from. The command list keeps every
 * applied step, so an edit and the edit that reverts it count twice. count is the net change count
 * the header badge shows.
 * @param {model.Dataset} ds @param {edits.Command[]} commands
 * @returns {{ editor: edits.Editor, result: ReturnType<edits.Editor['replay']>, count: number }}
 */
export function replayOnFreshCopy(ds, commands) {
  const editor = new edits.Editor(model.load(rawOf(ds)));
  const result = editor.replay(commands);
  return { editor, result, count: editor.changeCount() };
}

/**
 * Starts a session on the replayed editor, keeps the review part of the work as it is, and writes the backup.
 * @param {Shell} app @param {workfile.Work} work @param {edits.Editor} editor @param {boolean} unsaved
 */
function startWork(app, work, editor, unsaved) {
  const { state } = app;
  app.startSession(editor);
  state.ctx.review = structuredClone(work.review);
  state.workUnsaved = unsaved;
  state.autosave.flush();
  app.route(true);
}

/**
 * Applies the trainer's answer on a browser backup. Restore starts a session on the replayed editor and
 * rewrites the backup with the unsaved flag it had. Decline removes the backup.
 * @param {Shell} app @param {import('./autosave.js').SavedWork} saved @param {edits.Editor} editor @param {boolean} restore
 */
export function settleRestore(app, saved, editor, restore) {
  if (restore) startWork(app, saved.work, editor, saved.unsaved);
  else app.state.autosave.forget();
}

/**
 * Replaces the session and its backup with an opened work file.
 * @param {Shell} app @param {workfile.Work} work @param {edits.Editor} editor
 */
export function replaceWork(app, work, editor) {
  app.state.autosave.forget();
  startWork(app, work, editor, false);
}

/**
 * Loads the session's Exercises.json again with the picked skill tree files, replays the session's
 * commands and keeps the work file state. A delete fails on replay when a branch uses the exercise.
 * Throws when the files do not load, and the session stays as it was.
 * @param {Shell} app @param {model.RawFiles} trees
 * @returns {{ editor: edits.Editor, result: ReturnType<edits.Editor['replay']> }}
 */
export function swapTrees(app, trees) {
  const { state } = app;
  const { ctx } = state;
  const ds = model.load({ [model.EXERCISES]: ctx.ds.files[model.EXERCISES].raw, ...trees });
  const editor = new edits.Editor(ds);
  const result = editor.replay(ctx.editor.commands());
  editor.copyExportMark(ctx.editor);
  const { workSavedAt } = state;
  startWork(app, { review: ctx.review }, editor, state.workUnsaved || result.failed.length > 0);
  state.workSavedAt = workSavedAt;
  app.renderHeader();
  return { editor, result };
}

/** Tells the trainer that the skill trees loaded, and lists the changes that no longer fit. */
export function reportTrees(swapped) {
  reportWork(swapped, { done: t('load.treesLoaded', { trees: t('count.tree', { count: swapped.editor.ds.treeNames.length }) }) });
}

/** Tells the trainer that the work loaded, and lists warnings and failed commands. */
function reportWork({ result }, { done, warnings = [] }) {
  const notes = [
    ...warnings.map((w) => h('li', null, coreText(w))),
    ...result.failed.map((f) => h('li', null, h('span', { class: 'mono small' }, f.command.method), ' ',
      (f.errors ?? []).map(coreText).join(' ')))
  ];
  if (!notes.length) {
    toast(done);
    return;
  }
  messageDialog({
    title: t(result.failed.length ? 'work.failedTitle' : 'work.notesTitle'),
    wide: true,
    body: [
      result.failed.length
        ? p(t('work.failedBody', {
          applied: t('count.change', { count: result.applied }),
          failed: t('count.change', { count: result.failed.length })
        }))
        : null,
      h('ul', null, notes)
    ]
  });
}

// The dialog closes only through its two buttons. A dismissed dialog would leave the backup
// undecided, and the next edit would overwrite it.
async function askRestore(n, when, unsaved) {
  const changes = t('count.change', { count: n });
  let choice;
  do {
    choice = await new Dialog({
      title: t('work.restoreTitle'),
      closeOnBackdrop: false,
      cancelable: false,
      body: [
        p(t('work.restoreLast', { when, changes })),
        p(t(unsaved ? 'work.restoreUnsaved' : 'work.restoreSaved')),
        p(t('work.restoreHint', { fresh: t('work.fresh') }))
      ],
      actions: [
        { label: t('work.fresh'), value: false, ghost: true },
        { spacer: true },
        { label: t('work.restore', { changes }), value: true, primary: true, autofocus: true }
      ]
    }).result;
  } while (choice === undefined);
  return choice;
}

/** Asks whether to open a work file saved for other data files. @param {string} name @returns {Promise<boolean>} */
const confirmOtherData = (name) => confirmDialog({
  title: t('work.otherTitle'),
  body: h('div', { class: 'stack stack--tight' }, p(t('work.otherBody', { name })), p(t('work.otherTry'))),
  confirmLabel: t('work.openAnyway')
});

/** Offers the browser backup of the loaded Exercises.json, if it holds changes. @param {Shell} app */
export async function offerRestore(app) {
  const { state } = app;
  const saved = state.autosave.read();
  if (!saved) return;
  const { work, unsaved } = saved;
  const replayed = replayOnFreshCopy(state.ctx.ds, work.commands);
  const n = replayed.count;
  if (!n) {
    settleRestore(app, saved, replayed.editor, false);
    return;
  }
  const when = work.savedAt ? new Date(work.savedAt).toLocaleString(locale()) : t('work.earlier');
  const restore = await askRestore(n, when, unsaved);
  settleRestore(app, saved, replayed.editor, restore);
  if (restore) reportWork(replayed, { done: t('work.restored', { changes: t('count.change', { count: n }) }) });
}

/** @param {Shell} app */
export function saveWork(app) {
  const { state } = app;
  app.closeMenu();
  const name = workfile.fileName();
  download(name, workText(state), 'application/json');
  state.workUnsaved = false;
  state.workSavedAt = new Date();
  state.autosave.flush();
  app.renderHeader();
  toast(t('work.saved', { name }));
}

/** @param {string} message the text to show */
function workFileFailed(message) {
  messageDialog({
    title: t('work.notWorkTitle'),
    body: [p(message), p(t('work.notWorkHint'))]
  });
}

/**
 * Reads a picked work file. Before Exercises.json is loaded, the welcome screen keeps it for later.
 * @param {Shell} app @param {File | undefined} file
 */
export async function chooseWorkFile(app, file) {
  const { state } = app;
  if (!file) return;
  if (file.size > workfile.MAX_FILE_BYTES) {
    workFileFailed(t('work.tooLarge', { mb: MAX_MB }));
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch {
    workFileFailed(t('work.unreadable'));
    return;
  }
  const parsed = workfile.parse(text);
  if (!parsed.ok) {
    workFileFailed(coreText(parsed));
    return;
  }
  const pending = { name: file.name, work: parsed.value, warnings: parsed.warnings };
  if (!state.ctx) {
    state.pendingWork = pending;
    app.renderWelcome();
    return;
  }
  await openWork(app, pending);
}

/** Replaces the current work with an opened work file. @param {Shell} app @param {PendingWork} pending */
export async function openWork(app, { name, work, warnings }) {
  const { state } = app;
  const { ctx } = state;
  app.closeMenu();
  const changes = ctx.editor.changeCount();
  if (changes) {
    const ok = await confirmDialog({
      title: t('work.replaceTitle'),
      body: t(state.workUnsaved ? 'work.replaceBodyUnsaved' : 'work.replaceBody', { changes: t('count.change', { count: changes }), name }),
      confirmLabel: t('work.replaceConfirm'),
      danger: true
    });
    if (!ok) return;
  }
  if (work.fingerprint && work.fingerprint !== state.fingerprint) {
    if (!(await confirmOtherData(name))) return;
  }

  // The opened work replays on a fresh copy of the loaded files.
  const replayed = replayOnFreshCopy(ctx.ds, work.commands);
  replaceWork(app, work, replayed.editor);
  reportWork(replayed, { done: t('work.opened', { name }), warnings });
}
