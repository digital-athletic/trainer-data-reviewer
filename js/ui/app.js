// App shell: welcome screen, session, work file, export, undo, header and router.
import { DATA_TARGET_PATH } from '../core/config.js';
import * as model from '../core/model.js';
import * as edits from '../core/edits.js';
import * as review from '../core/review.js';
import * as changelog from '../core/changelog.js';
import * as loader from '../core/loader.js';
import * as workfile from '../core/workfile.js';
import { AutoSave } from './autosave.js';
import {
  confirmDialog, copyText, download, emptyState, h, isoDate, isTyping, messageDialog, notice, openDialog,
  plural, sleep, toast
} from './dom.js';
import { getView } from './registry.js';

const APP_NAME = 'Coach data reviewer';
const TABS = [
  { name: 'exercises', label: 'Exercises', hash: '#/exercises' }
];
const EXPECTED = `The app expects the folder ${DATA_TARGET_PATH}, which holds Exercises.json and a skillTrees folder.`;

/**
 * App state. The browser specs read it through a dynamic import of this module.
 * workUnsaved is true when the work changed since the trainer last saved or opened a work file.
 */
export const state = {
  ctx: null,
  fingerprint: null,
  workUnsaved: false,
  workSavedAt: null,
  pendingWork: null,
  initialHash: '',
  current: null,
  lastHash: new Map(),
  notifyPending: false,
  replaying: false,
  unsubscribe: null,
  /** @type {AutoSave | null} */
  autosave: null,
  loading: false,
  welcomeError: null
};
const els = {};
let routeAbort = null;

const byId = (id) => document.getElementById(id);
const p = (text) => h('p', null, text);
const errorText = (err) => err?.message ?? String(err);
const rawOf = (ds) => Object.fromEntries(Object.entries(ds.files).map(([path, f]) => [path, f.raw]));

/* ---------- Welcome and loading ---------- */

function renderWelcome() {
  const copyBtn = h('button', {
    type: 'button', class: 'btn btn--small',
    onclick: async () => toast(await copyText(DATA_TARGET_PATH) ? 'Folder path copied' : 'Select the path and copy it with Ctrl+C')
  }, 'Copy');

  const chooseArea = state.loading
    ? h('p', { class: 'loading', role: 'status' }, 'Reading the files. This takes a few seconds.')
    : h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn--primary btn--large', onclick: pickFolder }, 'Choose data folder'));

  const pending = state.pendingWork;
  const workArea = pending
    ? notice('success', `Ready: ${pending.name}`, 'The app adds this work as soon as the data folder is loaded.')
    : h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: pickWorkFile }, 'Open work file'));

  els.viewRoot.replaceChildren(h('div', { class: 'welcome' },
    h('div', { class: 'stack' },
      h('h1', { class: 'welcome__title' }, 'Review the exercise catalog and the skill trees'),
      h('p', { class: 'welcome__lead' },
        'This app lets you correct the exercises of the training data and gives you the changed files to send back. The app runs in this browser window. Your files stay on this computer.')),
    state.welcomeError,
    h('ol', { class: 'steps' },
      h('li', { class: 'step step--main' }, h('div', { class: 'step__body' },
        h('h2', { class: 'step__title' }, 'Choose the data folder'),
        p('The app does not contain the training data. Choose the data folder on your computer. In the project download it is this folder:'),
        h('div', { class: 'copy-box' }, h('code', null, DATA_TARGET_PATH), copyBtn),
        chooseArea,
        h('p', { class: 'small muted' },
          'The browser may ask whether to upload all files in the folder (about 110). Confirm it: nothing leaves your computer. The app only reads the files inside this browser window.'))),
      h('li', { class: ['step', pending ? 'step--done' : ''] }, h('div', { class: 'step__body' },
        h('h2', { class: 'step__title' }, 'Optional: open your work file'),
        p('Did you work on the data before? Open the work file you saved last time (coach-review-work-DATE.json). Pick the newest one.'),
        workArea)),
      h('li', { class: 'step' }, h('div', { class: 'step__body' },
        h('h2', { class: 'step__title' }, 'Start with the Exercises list'),
        p('The app opens the Exercises list first. Find an exercise, correct it, then click "Export changes" at the top right. Save the work file from the "Work file" menu before you stop.')))),
    h('p', { class: 'small muted' },
      'Shortcuts: ', h('kbd', null, '/'), ' jumps to the search box, ',
      h('kbd', null, 'Ctrl'), ' + ', h('kbd', null, 'Z'), ' undoes the last change.')));
}

function setWelcomeError(title, lines) {
  state.welcomeError = notice('error', title, h('div', { class: 'stack stack--tight' }, lines.map(p)));
}

function pickFolder() {
  els.folderInput.value = '';
  els.folderInput.click();
}

function pickWorkFile() {
  els.workInput.value = '';
  els.workInput.click();
}

function foundSummary(entries) {
  const names = new Set(entries.map((e) => {
    const parts = String(e.relativePath).split('/');
    return parts.length > 1 ? parts[1] : parts[0];
  }).filter(Boolean));
  const root = entries.length ? String(entries[0].relativePath).split('/')[0] : '';
  const list = [...names].slice(0, 6);
  return `You chose "${root}" with ${plural(entries.length, 'file')}${list.length ? `, for example: ${list.join(', ')}.` : '.'}`;
}

function loadFailed(title, lines) {
  state.loading = false;
  if (state.ctx) {
    messageDialog({ title, body: h('div', { class: 'stack stack--tight' }, lines.map(p)) });
    return;
  }
  setWelcomeError(title, lines);
  renderWelcome();
}

async function onFolderChosen() {
  const { files } = els.folderInput;
  if (!files?.length) return;
  const entries = Array.from(files, (f) => ({ relativePath: f.webkitRelativePath || f.name }));
  const pick = loader.pickDataFiles(entries);
  if (pick.error || !pick.exercises || !pick.trees.length) {
    loadFailed('This is not the data folder', [pick.error ?? EXPECTED, foundSummary(entries)]);
    return;
  }

  state.loading = true;
  state.welcomeError = null;
  if (state.ctx) toast('Reading the files');
  else renderWelcome();
  let res;
  try {
    res = await loader.readFileList(files);
  } catch (err) {
    loadFailed('The files could not be read', [errorText(err), EXPECTED]);
    return;
  }
  if (res.errors.length) {
    loadFailed('Some files could not be read', [...res.errors, EXPECTED]);
    return;
  }
  let ds;
  try {
    ds = model.load(res.raw);
    startSession(ds);
  } catch (err) {
    loadFailed('The data could not be loaded', [errorText(err)]);
    return;
  }
  state.loading = false;
  toast(`Loaded ${datasetLine(model.stats(ds))}`);
  const start = parseRoute(state.initialHash) ? state.initialHash : '#/exercises';
  state.initialHash = '';
  navigate(start);

  await offerRestore();
  const work = state.pendingWork;
  state.pendingWork = null;
  if (work) await openWork(work);
}

/* ---------- Session ---------- */

function startSession(ds) {
  const editor = edits.create(ds);
  /** @type {import('./registry.js').Ctx} */
  const ctx = {
    ds,
    editor,
    review: review.create(ds),
    navigate
  };
  state.unsubscribe?.();
  state.autosave?.cancel();
  state.ctx = ctx;
  state.fingerprint = model.fingerprint(ds);
  state.workUnsaved = false;
  state.workSavedAt = null;
  state.lastHash = new Map();
  state.current = null;
  state.unsubscribe = editor.subscribe(onEdits);
  state.autosave = new AutoSave(state.fingerprint, buildBackup, {
    onFail: () => toast('This browser does not keep a backup of your work. Export changes and save the work file often.', { tone: 'error', ms: 7000 })
  });

  els.header.hidden = false;
  renderTabs();
  renderHeader();
}

const datasetLine = ({ exercises, branches, trees }) =>
  `${plural(exercises, 'exercise')} · ${plural(branches, 'branch', 'branches')} · ${plural(trees, 'skill tree')}`;

function workChanged() {
  if (state.replaying) return;
  state.workUnsaved = true;
  state.autosave?.schedule();
}

function onEdits() {
  workChanged();
  renderHeader();
  scheduleViewNotify();
}

/* ---------- Work file ---------- */

const currentWorkText = () => workfile.serialize({
  commands: state.ctx.editor.commands(),
  review: state.ctx.review,
  fingerprint: state.fingerprint
});

function buildBackup() {
  const { ctx } = state;
  if (!ctx) return null;
  const commands = ctx.editor.commands();
  if (!commands.length) return null;
  return { unsaved: state.workUnsaved, text: currentWorkText() };
}

// The command list keeps every applied step, so an edit and the edit that reverts it
// count twice. A dry run on a fresh copy gives the net change count the header badge shows.
function countChanges(commands) {
  try {
    const probe = edits.create(model.load(rawOf(state.ctx.ds)));
    probe.replay(commands);
    return probe.changeCount();
  } catch {
    return commands.length;
  }
}

async function offerRestore() {
  const saved = state.autosave.read();
  if (!saved) return;
  const { work, unsaved } = saved;
  const n = work.commands.length ? countChanges(work.commands) : 0;
  if (!n) {
    state.autosave.forget();
    return;
  }
  const when = work.savedAt ? new Date(work.savedAt).toLocaleString() : 'earlier';
  const ok = await openDialog({
    title: 'Restore your work?',
    body: [
      p(`Last time (${when}) you worked on these same files. This browser kept ${plural(n, 'change')}.`),
      p(unsaved ? 'You had not saved this work as a work file yet.' : 'You also saved this work as a work file.'),
      p('Restore it to continue where you stopped. "Start fresh" deletes this backup.')
    ],
    actions: [
      { label: 'Start fresh', value: false, ghost: true },
      { spacer: true },
      { label: `Restore ${plural(n, 'change')}`, value: true, primary: true, autofocus: true }
    ]
  }).result;
  if (ok === false) state.autosave.forget();
  if (ok === true) applyWork(work, { unsaved, done: `${plural(n, 'change')} restored` });
}

/** Keeps the review part of the work as it is, then replays the changes on the current session. */
function applyWork(work, { unsaved, done, warnings = [] }) {
  const { ctx } = state;
  ctx.review = structuredClone(work.review);
  state.replaying = true;
  let result = { applied: 0, failed: [] };
  try {
    if (work.commands.length) result = ctx.editor.replay(work.commands);
  } finally {
    state.replaying = false;
  }
  state.workUnsaved = unsaved;
  state.autosave.flush();
  renderHeader();
  rerenderView();
  const notes = [
    ...warnings.map((w) => h('li', null, w)),
    ...result.failed.map((f) => h('li', null, h('span', { class: 'mono small' }, f.command.method), ' ',
      (f.errors ?? []).map((e) => e.message).join(' ')))
  ];
  if (!notes.length) {
    toast(done);
    return;
  }
  messageDialog({
    title: result.failed.length ? 'Some changes could not be applied' : 'Work loaded, with notes',
    wide: true,
    body: [
      p(result.failed.length
        ? `${plural(result.applied, 'change')} applied. These ${plural(result.failed.length, 'change')} did not fit the data any more, or the app noted a problem:`
        : 'Please note:'),
      h('ul', null, notes)
    ]
  });
}

function saveWork() {
  closeMenu();
  const name = workfile.fileName();
  download(name, currentWorkText(), 'application/json');
  state.workUnsaved = false;
  state.workSavedAt = new Date();
  state.autosave.flush();
  renderHeader();
  toast(`Work saved as ${name} in your downloads folder`);
}

function workFileFailed(message) {
  messageDialog({
    title: 'This file is not a work file',
    body: [p(message), p('Pick a file named coach-review-work-DATE.json that this app saved.')]
  });
}

async function onWorkChosen() {
  const file = els.workInput.files?.[0];
  if (!file) return;
  if (file.size > workfile.MAX_FILE_BYTES) {
    workFileFailed('This file is larger than 5 MB. A work file of this app is much smaller.');
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch {
    workFileFailed('The file could not be read.');
    return;
  }
  const parsed = workfile.parse(text);
  if (!parsed.ok) {
    workFileFailed(parsed.message);
    return;
  }
  const pending = { name: file.name, work: parsed.value, warnings: parsed.warnings };
  if (!state.ctx) {
    state.pendingWork = pending;
    renderWelcome();
    return;
  }
  await openWork(pending);
}

/** Replaces the current work with an opened work file. */
async function openWork({ name, work, warnings }) {
  const { ctx } = state;
  closeMenu();
  const changes = ctx.editor.changeCount();
  if (changes) {
    const ok = await confirmDialog({
      title: 'Replace your current work?',
      body: `You have ${plural(changes, 'change')} in this session${state.workUnsaved ? ' that are not saved as a work file' : ''}. Opening ${name} replaces them.`,
      confirmLabel: 'Open and replace',
      danger: true
    });
    if (!ok) return;
  }
  if (work.fingerprint && work.fingerprint !== state.fingerprint) {
    const ok = await confirmDialog({
      title: 'This work file belongs to other data files',
      body: h('div', { class: 'stack stack--tight' },
        p(`${name} was saved for data files that differ from the folder you chose. This happens when the data changed after you saved the work file.`),
        p('The app can still try. It lists the changes that do not fit the data any more.')),
      confirmLabel: 'Open anyway'
    });
    if (!ok) return;
  }

  // A fresh session from the loaded files, so the work file replays on unchanged data.
  startSession(model.load(rawOf(ctx.ds)));
  route(true);
  applyWork(work, { unsaved: false, done: `Work opened from ${name}`, warnings });
}

/* ---------- Export ---------- */

function openExport() {
  const { ctx } = state;
  closeMenu();
  const files = model.changedFiles(ctx.ds);
  if (!files.length) {
    messageDialog({
      title: 'No changes to export',
      body: [
        p('You have not changed any data since you loaded the folder, so there is nothing to download.'),
        state.workUnsaved ? p('Your work is not saved as a file yet. Use "Work file" and then "Save work file".') : null
      ]
    });
    return;
  }

  const done = new Set();
  // Marks the export once, when the last missing file of this dialog is downloaded.
  let complete = false;
  const downloadOne = (f, li) => {
    download(f.fileName, f.text, 'application/json');
    li.classList.add('is-done');
    done.add(f.path);
    if (complete || done.size < files.length) return;
    complete = true;
    ctx.editor.markExported();
    state.autosave.schedule();
    renderHeader();
  };
  const rows = files.map((f) => {
    const li = h('li', null,
      h('div', { class: 'file-list__names' },
        h('strong', null, 'Save as ', h('code', null, f.fileName)),
        h('span', { class: 'file-list__path' }, 'Goes to ', h('code', null, f.repoPath))),
      h('button', { type: 'button', class: 'btn btn--small', onclick: () => downloadOne(f, li) }, 'Download'));
    return li;
  });

  const allBtn = h('button', {
    type: 'button', class: 'btn btn--primary',
    onclick: async () => {
      allBtn.disabled = true;
      for (const [i, f] of files.entries()) {
        allBtn.textContent = `Downloading ${i + 1} of ${files.length}`;
        downloadOne(f, rows[i]);
        await sleep(300);
      }
      allBtn.disabled = false;
      allBtn.textContent = 'Download all again';
      toast('All files downloaded');
    }
  }, files.length === 1 ? 'Download the file' : `Download all ${plural(files.length, 'file')}`);

  const logBtn = h('button', {
    type: 'button', class: 'btn',
    onclick: () => download('changelog.md', changelog.build(ctx.editor, ctx.ds, { date: isoDate() }), 'text/markdown')
  }, 'Download changelog.md');

  const notes = changelog.pinnedTestNotes(ctx.editor, ctx.ds);
  openDialog({
    title: 'Export changes',
    wide: true,
    body: [
      p(`${plural(ctx.editor.changeCount(), 'change')} in ${plural(files.length, 'file')}. Each export contains all your changes since you loaded the folder.`),
      h('ul', { class: 'file-list' }, rows),
      h('div', { class: 'row' }, allBtn, logBtn,
        state.workUnsaved ? h('button', { type: 'button', class: 'btn', onclick: saveWork }, 'Save work file') : null),
      h('p', { class: 'small muted' },
        'Chrome may ask whether this page may download several files. Click "Allow". Send changelog.md together with the files: it lists every change for the developer.'),
      notes?.length ? notice('warning', 'Notes for the developer (also in changelog.md)', h('ul', null, notes.map((n) => h('li', null, n)))) : null,
      notice('info', 'What next', h('ol', null,
        h('li', null, 'Replace the files in your data folder with the downloaded ones, or get the data folder again after the developer merges your changes.'),
        h('li', null, 'If the browser saved a file as ', h('code', null, 'Exercises (1).json'), ', rename it to ', h('code', null, 'Exercises.json'), ' before uploading on GitHub.'),
        h('li', null, 'Send the files and changelog.md to the developer, or upload them on GitHub ("Add file", then "Upload files") into the folder shown under each file.'),
        h('li', null, 'Save the work file. Next time, open the newest work file to continue your work.')))
    ],
    actions: [{ label: 'Close', value: true, autofocus: true }]
  });
}

/* ---------- Undo ---------- */

function describeEdit({ target: t = {}, op }) {
  let record = `branch ${t.tree}/${t.branchId}`;
  if (t.kind === 'exercise') {
    const ex = state.ctx.ds.index.exerciseById.get(String(t.id));
    record = `exercise ${t.id}${ex ? ` (${model.exerciseLabel(ex)})` : ''}`;
  }
  if (op === 'addRecord') return `adding ${record}`;
  if (op === 'removeRecord') return `deleting ${record}`;
  return `change on ${record}`;
}

function doUndo() {
  const { ctx } = state;
  if (!ctx) return;
  const undone = ctx.editor.undo();
  if (!undone?.length) {
    toast('Nothing to undo');
    return;
  }
  toast(`Undone: ${describeEdit(undone[0])}${undone.length > 1 ? ` and ${plural(undone.length - 1, 'linked change')}` : ''}`);
}

/* ---------- Header ---------- */

function renderTabs() {
  els.tabs.replaceChildren(...TABS.map((t) => h('li', null, h('a', { href: t.hash, 'data-tab': t.name }, t.label))));
}

function updateTabs(active) {
  for (const a of els.tabs.querySelectorAll('a[data-tab]')) {
    const name = a.dataset.tab;
    if (name === active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    a.setAttribute('href', state.lastHash.get(name) ?? TABS.find((t) => t.name === name).hash);
  }
}

const syncHeaderHeight = () => document.documentElement.style.setProperty('--header-h', `${els.header.offsetHeight}px`);

function renderHeader() {
  const { ctx } = state;
  if (!ctx) return;
  els.datasetLine.textContent = datasetLine(model.stats(ctx.ds));

  const changes = ctx.editor.netChanges();
  const pending = ctx.editor.unexportedCount(changes);
  const total = changes.length;
  const badge = els.changeBadge;
  badge.classList.toggle('is-pending', pending > 0);
  badge.classList.toggle('badge--success', pending === 0 && total > 0);
  badge.textContent = pending > 0 ? `${plural(pending, 'change')} not yet exported` : (total > 0 ? 'All changes exported' : 'No changes yet');

  els.undoBtn.disabled = ctx.editor.journal().length === 0;

  els.workSummary.replaceChildren('Work file', ...(state.workUnsaved
    ? [h('span', { class: 'changed-dot', 'aria-hidden': 'true' }), h('span', { class: 'sr-only' }, ' (not saved)')]
    : []));
  let note = 'Save your work as a file to continue next time.';
  if (state.workUnsaved) note = 'This browser keeps a backup. Save the work file to keep your work safe and to continue on another computer.';
  else if (state.workSavedAt) note = `Saved at ${state.workSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
  els.workNote.textContent = note;

  const tab = TABS.find((t) => t.name === state.current?.name);
  document.title = `${pending > 0 ? '* ' : ''}${tab ? `${tab.label} · ` : ''}${APP_NAME}`;
  syncHeaderHeight();
}

function closeMenu() {
  els.workMenu.open = false;
}

/* ---------- Router ---------- */

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function parseRoute(hash) {
  const [name, a] = String(hash ?? '').replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode);
  switch (name) {
    case 'exercises': return { name, params: { id: a } };
    default: return null;
  }
}

/** Opens a screen by its hash, for example "#/exercises/429". @param {string} hash */
export function navigate(hash) {
  if (location.hash === hash) route(true);
  else location.hash = hash;
}

function route(force) {
  if (!state.ctx) return;
  const r = parseRoute(location.hash);
  if (!r) {
    location.replace('#/exercises');
    return;
  }
  const key = location.hash;
  const changed = state.current?.key !== key;
  if (!changed && !force) return;
  state.lastHash.set(r.name, key);
  renderRoute(r, key, changed);
}

function renderRoute(r, key, scrollTop) {
  routeAbort?.abort();
  routeAbort = new AbortController();
  const spec = getView(r.name) ?? null;
  const container = h('div', { class: 'view', 'data-view': r.name });
  els.viewRoot.replaceChildren(container);
  state.current = { name: r.name, key, params: r.params, spec, root: container };
  updateTabs(r.name);
  renderHeader();
  if (scrollTop) window.scrollTo(0, 0);

  if (!spec) {
    container.append(h('div', { class: 'placeholder-view' }, emptyState({
      title: 'This screen is not ready yet',
      body: `The ${r.name} screen is not part of this version of the app.`
    })));
  } else {
    try {
      spec.render(container, state.ctx, r.params, routeAbort.signal);
    } catch (err) {
      console.error(err);
      container.append(notice('error', 'This screen ran into a problem',
        p(`${errorText(err)} Your changes are safe. Try another tab or reload the folder.`)));
    }
  }
  if (document.activeElement === document.body) els.main.focus({ preventScroll: true });
}

function rerenderView() {
  const cur = state.current;
  if (cur) renderRoute({ name: cur.name, params: cur.params }, cur.key, false);
}

function scheduleViewNotify() {
  if (state.notifyPending) return;
  state.notifyPending = true;
  queueMicrotask(() => {
    state.notifyPending = false;
    const cur = state.current;
    if (!cur || !state.ctx) return;
    if (cur.spec?.onDataChange) cur.spec.onDataChange(state.ctx);
    else rerenderView();
  });
}

/* ---------- Global events ---------- */

async function confirmNewFolder() {
  closeMenu();
  const pending = state.ctx?.editor.unexportedCount() ?? 0;
  if (!pending && !state.workUnsaved) {
    pickFolder();
    return;
  }
  const risks = [
    pending ? `${plural(pending, 'change')} not yet exported` : null,
    state.workUnsaved ? 'work not yet saved as a work file' : null
  ].filter(Boolean);
  const ok = await confirmDialog({
    title: 'Choose another data folder?',
    body: `You have ${risks.join(' and ')}. Export your changes and save the work file first to be safe. This browser keeps a backup only for the same files.`,
    confirmLabel: 'Choose another folder',
    danger: true
  });
  if (ok) pickFolder();
}

function onKeyDown(e) {
  if (e.key === 'Escape' && els.workMenu.open) {
    closeMenu();
    els.workSummary.focus();
    return;
  }
  if (!state.ctx || document.querySelector('dialog[open]')) return;
  const typing = isTyping(e.target);
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
    if (typing) return;
    e.preventDefault();
    doUndo();
    return;
  }
  if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const search = els.viewRoot.querySelector('[data-search]') ?? els.viewRoot.querySelector('input[type="search"]');
    if (!search) return;
    e.preventDefault();
    search.focus();
    search.select?.();
  }
}

function onBeforeUnload(e) {
  const { ctx } = state;
  if (!ctx) return;
  state.autosave.flush();
  if (ctx.editor.unexportedCount() > 0 || state.workUnsaved) {
    e.preventDefault();
    e.returnValue = '';
  }
}

/** Wires the page. main.js calls it once the modules have loaded. */
export function boot() {
  Object.assign(els, {
    header: byId('app-header'),
    main: byId('main'),
    viewRoot: byId('view-root'),
    tabs: byId('tabs'),
    datasetLine: byId('dataset-line'),
    changeBadge: byId('change-badge'),
    undoBtn: byId('undo-btn'),
    workMenu: byId('work-menu'),
    workNote: byId('work-menu-note'),
    folderInput: byId('folder-input'),
    workInput: byId('work-input')
  });
  els.workSummary = els.workMenu.querySelector('summary');
  state.initialHash = location.hash;

  els.folderInput.addEventListener('change', onFolderChosen);
  els.workInput.addEventListener('change', onWorkChosen);
  byId('export-btn').addEventListener('click', openExport);
  els.undoBtn.addEventListener('click', doUndo);
  byId('work-save-btn').addEventListener('click', saveWork);
  byId('work-open-btn').addEventListener('click', () => {
    closeMenu();
    pickWorkFile();
  });
  byId('folder-again-btn').addEventListener('click', confirmNewFolder);
  document.addEventListener('click', (e) => {
    if (els.workMenu.open && !els.workMenu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') state.autosave?.flush();
  });
  window.addEventListener('hashchange', () => route(false));
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pagehide', () => state.autosave?.flush());
  window.addEventListener('resize', syncHeaderHeight);

  renderWelcome();
}
