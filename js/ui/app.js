// App shell: welcome screen, session, undo, header, language switch and router.
import { DATA_TARGET_PATH } from '../core/config.js';
import * as model from '../core/model.js';
import * as edits from '../core/edits.js';
import * as review from '../core/review.js';
import * as loader from '../core/loader.js';
import { AutoSave } from './autosave.js';
import { confirmDialog, copyText, h, isTyping, messageDialog, notice, toast } from './dom.js';
import { openExport } from './export-dialog.js';
import { applyStatic, coreText, lang, LANGS, locale, onLangChange, setLang, t } from './i18n.js';
import { getView } from './registry.js';
import { parseRoute } from './routes.js';
import * as workFile from './work-file.js';

const TABS = [
  { name: 'exercises', label: 'tabs.exercises', hash: '#/exercises' }
];
const EXERCISES_PATH = model.REPO_BASE + model.EXERCISES;
/** The closing line of every load error. */
const EXPECTED = { key: 'app.expected', params: { path: DATA_TARGET_PATH } };
/** The closing line of every skill tree load error. */
const TREES_EXPECTED = { key: 'load.treesExpected', params: { path: loader.TREES_PATH } };

/**
 * @typedef {{ key: string, params?: Record<string, unknown> } | import('../core/messages.js').Message | Error | string} Line
 *   A line of an error notice: a dictionary key, a core message, or an error from the browser.
 */

/** App state. workUnsaved is true when the work changed since the trainer last saved or opened a work file. */
const state = {
  ctx: null,
  fingerprint: null,
  workUnsaved: false,
  workSavedAt: null,
  pendingWork: null,
  /** @type {model.RawFiles} the picked skill tree files; every Exercises.json loads with them */
  trees: {},
  initialHash: '',
  current: null,
  lastHash: new Map(),
  notifyPending: false,
  unsubscribe: null,
  /** @type {AutoSave | null} */
  autosave: null,
  loading: false,
  /** @type {{ title: string, lines: Line[] } | null} title is a dictionary key */
  welcomeError: null
};
const els = {};
let routeAbort = null;

/** @type {import('./work-file.js').Shell} */
const shell = { state, startSession, renderHeader, route, closeMenu, renderWelcome };

const byId = (id) => document.getElementById(id);
const p = (text) => h('p', null, text);
/** @param {Line} line @returns {string} */
const lineText = (line) => (typeof line === 'object' && line !== null && 'key' in line ? t(line.key, line.params) : coreText(line));
const lineBlock = (lines) => h('div', { class: 'stack stack--tight' }, lines.map((line) => p(lineText(line))));

/* ---------- Language ---------- */

/** The DE / EN buttons. The pressed button names the current language. */
function langSwitch() {
  return h('div', { class: 'lang-switch', role: 'group', 'aria-label': t('lang.label') },
    LANGS.map((code) => h('button', {
      type: 'button', class: 'btn btn--small btn--ghost', lang: code, 'data-lang': code,
      title: t(`lang.${code}Name`), 'aria-pressed': String(code === lang()),
      onclick: () => setLang(code)
    }, t(`lang.${code}`))));
}

// Renders every visible text again in the new language and keeps focus on the pressed button.
function onLangSwitch() {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.lang : undefined;
  const inHeader = focused !== undefined && els.langSlot.contains(document.activeElement);
  applyStatic();
  els.langSlot.replaceChildren(langSwitch());
  if (state.ctx) {
    renderTabs();
    renderHeader();
    rerenderView();
  } else {
    renderWelcome();
  }
  if (focused === undefined) return;
  const host = inHeader ? els.langSlot : els.viewRoot;
  /** @type {HTMLElement | null} */ (host.querySelector(`[data-lang="${focused}"]`))?.focus();
}

/* ---------- Welcome and loading ---------- */

/** A path with its copy button. @param {string} path */
const copyBox = (path) => h('div', { class: 'copy-box' }, h('code', null, path), h('button', {
  type: 'button', class: 'btn btn--small',
  onclick: async () => toast(t(await copyText(path) ? 'welcome.copied' : 'welcome.copyFailed'))
}, t('welcome.copy')));

function renderWelcome() {
  const chooseArea = state.loading
    ? h('p', { class: 'loading', role: 'status' }, t('welcome.reading'))
    : h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn--primary btn--large', onclick: pickExercisesFile }, t('welcome.choose')));

  const pending = state.pendingWork;
  const workArea = pending
    ? notice('success', t('welcome.ready', { name: pending.name }), t('welcome.readyBody'))
    : h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: pickWorkFile }, t('header.workOpen')));

  const treeCount = Object.keys(state.trees).length;
  const treesArea = treeCount
    ? notice('success', t('welcome.ready', { name: t('count.tree', { count: treeCount }) }), t('welcome.treesReady'))
    : h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: pickTreeFiles }, t('header.trees')));

  const error = state.welcomeError;
  els.viewRoot.replaceChildren(h('div', { class: 'welcome' },
    h('div', { class: 'welcome__lang' }, langSwitch()),
    h('div', { class: 'stack' },
      h('h1', { class: 'welcome__title' }, t('welcome.title')),
      h('p', { class: 'welcome__lead' }, t('welcome.lead'))),
    error ? notice('error', t(error.title), lineBlock(error.lines)) : null,
    h('ol', { class: 'steps' },
      h('li', { class: 'step step--main' }, h('div', { class: 'step__body' },
        h('h2', { class: 'step__title' }, t('welcome.choose')),
        p(t('welcome.step1Body')),
        copyBox(EXERCISES_PATH),
        p(t('welcome.step1Rename')),
        chooseArea)),
      h('li', { class: ['step', treeCount ? 'step--done' : ''] }, h('div', { class: 'step__body' },
        h('h2', { class: 'step__title' }, t('welcome.treesTitle')),
        p(t('welcome.treesBody')),
        copyBox(loader.TREES_PATH),
        p(t('welcome.treesSelect')),
        treesArea)),
      h('li', { class: ['step', pending ? 'step--done' : ''] }, h('div', { class: 'step__body' },
        h('h2', { class: 'step__title' }, t('welcome.step2Title')),
        p(t('welcome.step2Body')),
        workArea)),
      h('li', { class: 'step' }, h('div', { class: 'step__body' },
        h('h2', { class: 'step__title' }, t('welcome.step3Title')),
        p(t('welcome.step3Body', { export: t('header.export'), work: t('header.workFile') }))))),
    h('p', { class: 'small muted' },
      t('welcome.shortcuts'), h('kbd', null, '/'), t('welcome.shortcutSearch'),
      h('kbd', null, t('keys.ctrl')), ' + ', h('kbd', null, 'Z'), t('welcome.shortcutUndo'))));
}

function pickExercisesFile() {
  els.exercisesInput.value = '';
  els.exercisesInput.click();
}

function pickWorkFile() {
  els.workInput.value = '';
  els.workInput.click();
}

function pickTreeFiles() {
  closeMenu();
  els.treesInput.value = '';
  els.treesInput.click();
}

/** @param {string} title dictionary key @param {Line[]} lines */
function loadFailed(title, lines) {
  state.loading = false;
  if (state.ctx) {
    messageDialog({ title: t(title), body: lineBlock(lines) });
    return;
  }
  state.welcomeError = { title, lines };
  renderWelcome();
}

async function onExercisesChosen() {
  const { files } = els.exercisesInput;
  if (!files?.length) return;
  const entries = Array.from(files, (f) => ({ relativePath: f.webkitRelativePath || f.name }));
  const pick = loader.pickDataFiles(entries);
  if (pick.error) {
    loadFailed('load.notExercises', [pick.error, { key: 'load.youChose', params: { name: files[0].name } }]);
    return;
  }

  state.loading = true;
  state.welcomeError = null;
  if (state.ctx) toast(t('load.reading'));
  else renderWelcome();
  let res;
  try {
    res = await loader.readFileList(files);
  } catch (err) {
    loadFailed('load.readFailed', [err, EXPECTED]);
    return;
  }
  if (res.errors.length) {
    loadFailed('load.readFailed', [...res.errors, EXPECTED]);
    return;
  }
  let ds;
  try {
    ds = model.load({ ...state.trees, ...res.raw });
    startSession(new edits.Editor(ds));
  } catch (err) {
    loadFailed('load.loadFailed', [err, EXPECTED]);
    return;
  }
  state.loading = false;
  toast(t('load.loaded', { dataset: datasetLine(model.stats(ds)) }));
  const start = parseRoute(state.initialHash) ? state.initialHash : '#/exercises';
  state.initialHash = '';
  navigate(start);

  await workFile.offerRestore(shell);
  const work = state.pendingWork;
  state.pendingWork = null;
  if (work) await workFile.openWork(shell, work);
}

/** @param {Line[]} lines */
const treesFailed = (lines) => loadFailed('load.treesFailed', [...lines, TREES_EXPECTED]);

/** Reads the picked skill tree files. In a session, they replace the loaded skill trees. */
async function onTreesChosen() {
  const { files } = els.treesInput;
  if (!files?.length) return;
  let res;
  try {
    res = await loader.readTreeFiles(files);
  } catch (err) {
    treesFailed([err]);
    return;
  }
  if (res.errors.length) {
    treesFailed(res.errors);
    return;
  }
  let swapped = null;
  try {
    if (state.ctx) swapped = workFile.swapTrees(shell, res.raw);
    else model.load({ [model.EXERCISES]: '[]', ...res.raw });
  } catch (err) {
    treesFailed([err]);
    return;
  }
  state.trees = res.raw;
  if (swapped) {
    workFile.reportTrees(swapped);
    return;
  }
  state.welcomeError = null;
  renderWelcome();
}

/* ---------- Session ---------- */

/** Starts a session on the editor. The editor may carry replayed commands. @param {edits.Editor} editor */
function startSession(editor) {
  const { ds } = editor;
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
  state.autosave = new AutoSave(state.fingerprint, () => workFile.buildBackup(state), {
    onFail: () => toast(t('load.backupFailed'), { tone: 'error', ms: 7000 })
  });

  els.header.hidden = false;
  renderTabs();
  renderHeader();
}

// The branch and skill tree counts show only for a dataset with skill trees.
const datasetLine = ({ exercises, branches, trees }) => [
  t('count.exercise', { count: exercises }),
  ...(trees ? [t('count.branch', { count: branches }), t('count.tree', { count: trees })] : [])
].join(' · ');

// A replayed editor starts its session after the replay, so replay fires no onEdits call.
function onEdits() {
  state.workUnsaved = true;
  state.autosave?.schedule();
  renderHeader();
  scheduleViewNotify();
}

/* ---------- Work file and export ---------- */

const saveWork = () => workFile.saveWork(shell);

function startExport() {
  closeMenu();
  openExport(state.ctx, {
    workUnsaved: state.workUnsaved,
    saveWork,
    onExported: () => {
      state.autosave.schedule();
      renderHeader();
    }
  });
}

/* ---------- Undo ---------- */

function describeEdit({ target: tg = {}, op }) {
  let record = t('undo.branch', { tree: tg.tree, id: tg.branchId });
  if (tg.kind === 'exercise') {
    const ex = state.ctx.ds.index.exerciseById.get(String(tg.id));
    record = ex
      ? t('undo.exerciseNamed', { id: String(tg.id), name: model.exerciseLabel(ex) })
      : t('undo.exercise', { id: String(tg.id) });
  }
  if (op === 'addRecord') return t('undo.adding', { record });
  if (op === 'removeRecord') return t('undo.deleting', { record });
  return t('undo.change', { record });
}

function doUndo() {
  const { ctx } = state;
  if (!ctx) return;
  const undone = ctx.editor.undo();
  if (!undone?.length) {
    toast(t('undo.nothing'));
    return;
  }
  const what = describeEdit(undone[0]);
  toast(undone.length > 1
    ? t('undo.doneLinked', { what, linked: t('count.linkedChange', { count: undone.length - 1 }) })
    : t('undo.done', { what }));
}

/* ---------- Header ---------- */

function renderTabs() {
  els.tabs.replaceChildren(...TABS.map((tab) => h('li', null, h('a', { href: tab.hash, 'data-tab': tab.name }, t(tab.label)))));
  updateTabs(state.current?.name);
}

function updateTabs(active) {
  for (const a of els.tabs.querySelectorAll('a[data-tab]')) {
    const name = a.dataset.tab;
    if (name === active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    a.setAttribute('href', state.lastHash.get(name) ?? TABS.find((tab) => tab.name === name).hash);
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
  if (pending > 0) badge.textContent = t('header.pending', { count: pending });
  else badge.textContent = t(total > 0 ? 'header.allExported' : 'header.noChanges');

  els.undoBtn.disabled = ctx.editor.journalLength === 0;

  els.workSummary.replaceChildren(t('header.workFile'), ...(state.workUnsaved
    ? [h('span', { class: 'changed-dot', 'aria-hidden': 'true' }), h('span', { class: 'sr-only' }, t('header.notSaved'))]
    : []));
  let note = t('header.noteDefault');
  if (state.workUnsaved) note = t('header.noteUnsaved');
  else if (state.workSavedAt) note = t('header.noteSaved', { time: state.workSavedAt.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) });
  els.workNote.textContent = note;

  const tab = TABS.find((x) => x.name === state.current?.name);
  document.title = `${pending > 0 ? '* ' : ''}${tab ? `${t(tab.label)} · ` : ''}${t('app.name')}`;
  syncHeaderHeight();
}

function closeMenu() {
  els.workMenu.open = false;
}

/* ---------- Router ---------- */

/** Opens a screen by its hash, for example "#/exercises/429". @param {string} hash */
function navigate(hash) {
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
  // parseRoute returns only names that a screen module registers.
  const spec = getView(r.name);
  const container = h('div', { class: 'view', 'data-view': r.name });
  els.viewRoot.replaceChildren(container);
  state.current = { name: r.name, key, params: r.params, spec, root: container };
  updateTabs(r.name);
  renderHeader();
  if (scrollTop) window.scrollTo(0, 0);

  try {
    spec.render(container, state.ctx, r.params, routeAbort.signal);
  } catch (err) {
    console.error(err);
    container.append(notice('error', t('app.screenError'), p(t('app.screenErrorBody', { error: coreText(err) }))));
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

async function confirmNewExercisesFile() {
  closeMenu();
  const pending = state.ctx?.editor.unexportedCount() ?? 0;
  if (!pending && !state.workUnsaved) {
    pickExercisesFile();
    return;
  }
  const risks = [
    pending ? t('newFile.pending', { count: pending }) : null,
    state.workUnsaved ? t('newFile.unsaved') : null
  ].filter(Boolean);
  const ok = await confirmDialog({
    title: t('newFile.title'),
    body: t('newFile.body', { risks: risks.join(t('common.and')) }),
    confirmLabel: t('newFile.confirm'),
    danger: true
  });
  if (ok) pickExercisesFile();
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
    langSlot: byId('lang-slot'),
    exercisesInput: byId('exercises-input'),
    workInput: byId('work-input'),
    treesInput: byId('trees-input')
  });
  els.workSummary = els.workMenu.querySelector('summary');
  state.initialHash = location.hash;
  applyStatic();
  els.langSlot.replaceChildren(langSwitch());
  onLangChange(onLangSwitch);

  els.exercisesInput.addEventListener('change', onExercisesChosen);
  els.workInput.addEventListener('change', () => workFile.chooseWorkFile(shell, els.workInput.files?.[0]));
  byId('export-btn').addEventListener('click', startExport);
  els.undoBtn.addEventListener('click', doUndo);
  byId('work-save-btn').addEventListener('click', saveWork);
  byId('work-open-btn').addEventListener('click', () => {
    closeMenu();
    pickWorkFile();
  });
  byId('exercises-again-btn').addEventListener('click', confirmNewExercisesFile);
  els.treesInput.addEventListener('change', onTreesChosen);
  byId('trees-btn').addEventListener('click', pickTreeFiles);
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
