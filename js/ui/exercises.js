// Exercises tab: filterable table (#/exercises) and the detail page (#/exercises/<id>).
import * as model from '../core/model.js';
import * as query from '../core/query.js';
import { debounce, emptyState, fmt, h, highlight, Pager, toast, uid } from './dom.js';
import * as exerciseDetail from './exercise-detail.js';
import { coreText, t } from './i18n.js';
import { registerView } from './registry.js';
import { exerciseHash } from './routes.js';
import { tagGroupLabel, tagLabel } from './terms.js';

const PAGE_SIZE = 50;

const { FACET_PREFIX } = query;
// label and any are dictionary keys. A facet with a prefix takes the label of its tag group.
const FACETS = [
  { key: 'tree', label: 'exl.tree', any: 'exl.anyTree' },
  { key: 'skill', any: 'exl.anySkill', prefix: FACET_PREFIX.skill },
  { key: 'region', any: 'exl.anyRegion', prefix: FACET_PREFIX.region },
  { key: 'eq', any: 'exl.anyEquipment', prefix: FACET_PREFIX.eq },
  { key: 'place', any: 'exl.anyPlace', prefix: FACET_PREFIX.place }
];
const TRI = [
  { key: 'hasVideo', label: 'exl.video', yes: 'exl.withVideo', no: 'exl.withoutVideo' },
  { key: 'hasDescription', label: 'exl.description', yes: 'exl.withDescription', no: 'exl.withoutDescription' }
];
const USAGE = [
  { value: 'all', label: 'exl.usageAll' },
  { value: 'used', label: 'exl.usageUsed' },
  { value: 'orphan', label: 'exl.usageOrphan' }
];
const facetName = (f) => (f.prefix ? tagGroupLabel(f.prefix) : t(f.label));

const defaultCriteria = () => ({
  text: '', tree: '', skill: '', region: '', eq: '', place: '', usage: 'all',
  hasVideo: null, hasDescription: null
});

// The list keeps this state between the table and a detail page and resets it when a new Exercises.json loads.
const state = { ds: null, criteria: defaultCriteria(), page: 0, lastId: null, returning: false, pendingFocus: null, current: null };

function resetFor(ds) {
  if (state.ds === ds) return;
  Object.assign(state, { ds, criteria: defaultCriteria(), page: 0, lastId: null, returning: false, pendingFocus: null });
}

const facetLabel = (f, value) => (f.prefix ? tagLabel(value) : value);
const without = (c, key) => ({ ...c, [key]: defaultCriteria()[key] });

/** Adds an exercise and opens it with the name field focused. @param {import('./registry.js').Ctx} ctx */
function addExercise(ctx) {
  const r = ctx.editor.addExercise();
  if (!r.ok) {
    toast(r.errors?.[0] ? coreText(r.errors[0]) : t('exl.addFailed'), { tone: 'error' });
    return;
  }
  state.pendingFocus = r.id;
  toast(t('exl.added', { id: r.id }));
  ctx.navigate(exerciseHash(r.id));
}

const fmtLevel = (v) => (v == null ? '-' : String(v));

/** @param {boolean} on @param {string} textKey @param {string} onKey @param {string} offKey */
function mediaMark(on, textKey, onKey, offKey) {
  const label = t(on ? onKey : offKey);
  return h('span', { class: ['exl-mark', on ? 'is-on' : ''], title: label },
    h('span', { 'aria-hidden': 'true' }, t(textKey)),
    h('span', { class: 'sr-only' }, label));
}

/* ---------- Table ---------- */

function renderTable(root, ctx, signal) {
  // The skill tree column and filter show only for a dataset with skill trees.
  const hasTrees = ctx.ds.treeNames.length > 0;
  const facets = hasTrees ? FACETS : FACETS.filter((f) => f.key !== 'tree');
  let rows = query.buildRows(ctx.ds);
  let facetValues = query.facetValues(ctx.ds);
  let c = state.criteria;
  let filtered = [];
  let pager = null;

  const search = h('input', {
    type: 'search', class: 'search', 'data-search': '', autocomplete: 'off', value: c.text,
    placeholder: t('exl.searchPlaceholder'),
    'aria-label': t('exl.searchLabel')
  });
  const searchLater = debounce(() => {
    c.text = search.value;
    apply();
  }, 100, signal);
  search.addEventListener('input', searchLater);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      search.value = '';
      c.text = '';
      apply();
    }
  });

  /** @type {Map<string, HTMLSelectElement>} */
  const selects = new Map();
  const selectField = (key, label, onChange) => {
    const id = uid('exl-facet');
    const sel = /** @type {HTMLSelectElement} */ (h('select', { class: 'input', id }));
    sel.addEventListener('change', () => onChange(sel.value));
    selects.set(key, sel);
    return h('div', { class: 'field' }, h('label', { class: 'field__label', for: id }, label), sel);
  };
  const facetBox = h('div', { class: 'exl-facets' },
    facets.map((f) => selectField(f.key, facetName(f), (v) => {
      c[f.key] = v;
      apply();
    })),
    TRI.map((tri) => selectField(tri.key, t(tri.label), (v) => {
      c[tri.key] = { yes: true, no: false }[v] ?? null;
      apply();
    })));

  const usageName = uid('exl-usage');
  const usageInputs = new Map();
  const usageCounts = new Map();
  const usageBox = h('div', { class: 'segmented exl-usage', role: 'radiogroup', 'aria-label': t('exl.usageLabel') },
    USAGE.map((u) => {
      const input = h('input', { type: 'radio', name: usageName, value: u.value, checked: c.usage === u.value });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        c.usage = u.value;
        apply();
      });
      usageInputs.set(u.value, input);
      // A nested span would pick up the .segmented span styles.
      const count = h('small', { class: 'exl-usage__count num' });
      usageCounts.set(u.value, count);
      return h('label', null, input, h('span', null, t(u.label), count));
    }));

  const chips = h('div', { class: 'chip-group exl-active', 'aria-label': t('exl.activeFilters') });
  const resultLine = h('p', { class: 'exl-result num', role: 'status', 'aria-live': 'polite' });
  const clearBtn = h('button', { type: 'button', class: 'btn btn--small', onclick: clearAll }, t('exl.clearAll'));

  const tbody = h('tbody');
  const table = h('table', { class: 'table exl-table' },
    h('caption', { class: 'sr-only' }, t('exl.caption')),
    h('thead', null, h('tr', null,
      h('th', { scope: 'col', class: 'num' }, t('exl.colId')),
      h('th', { scope: 'col' }, t('exl.colExercise')),
      h('th', { scope: 'col', class: 'num', title: t('exl.colLevelTitle') }, t('exl.colLevel')),
      hasTrees ? h('th', { scope: 'col' }, t('exl.colTrees')) : null,
      h('th', { scope: 'col' }, t('exl.colUsedIn')),
      h('th', { scope: 'col' }, t('exl.colMedia')))),
    tbody);
  const tableWrap = h('div', { class: 'table-wrap exl-wrap' }, table);
  const emptySlot = h('div');

  function clearAll() {
    state.criteria = c = defaultCriteria();
    search.value = '';
    for (const [value, input] of usageInputs) input.checked = value === 'all';
    apply();
    search.focus();
  }

  const rememberPage = () => { state.page = pager?.page ?? 0; };

  function openRow(id) {
    rememberPage();
    ctx.navigate(exerciseHash(id));
  }

  // One click and one keydown listener on `tbody` open any row.
  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    if (e.target.closest('a')) rememberPage();
    else openRow(tr.dataset.id);
  });
  tbody.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (e.key === 'Enter' && tr && e.target === tr) {
      e.preventDefault();
      openRow(tr.dataset.id);
    }
  });

  function renderRow(row) {
    const ex = ctx.ds.index.exerciseById.get(row.id);
    const name = ex?.name && ex.name !== row.label ? ex.name : null;
    const isPause = row.id === model.PAUSE_ID;
    const trees = row.trees.slice(0, 3);
    let usedIn = h('span', { class: 'badge badge--advisory' }, t('exl.usageOrphan'));
    if (isPause) usedIn = h('span', { class: 'muted small' }, t('exl.system'));
    else if (row.branchCount) usedIn = h('span', { class: 'num' }, t('count.branch', { count: row.branchCount }));
    return h('tr', { class: 'is-clickable', tabindex: '0', 'data-id': row.id },
      h('td', { class: 'num mono exl-id' }, row.id),
      h('td', { class: 'exl-label' },
        h('a', { href: exerciseHash(row.id), tabindex: '-1' }, row.label || t('common.noName')),
        name ? h('span', { class: 'exl-name' }, name) : null),
      h('td', { class: 'num' }, `${fmtLevel(row.levelM)} / ${fmtLevel(row.levelW)}`),
      hasTrees ? h('td', null, trees.length
        ? h('span', { class: 'exl-trees' }, trees.map((t) => h('span', { class: 'exl-tree' }, t)),
          row.trees.length > 3 ? h('span', { class: 'muted small' }, `+${row.trees.length - 3}`) : null)
        : h('span', { class: 'muted' }, '-')) : null,
      h('td', null, usedIn),
      h('td', { class: 'exl-media' },
        mediaMark(row.hasVideo, 'exl.markVideo', 'exl.hasVideo', 'exl.noVideo'),
        mediaMark(row.hasDescription, 'exl.markText', 'exl.hasDescription', 'exl.noDescription')));
  }

  function fillSelect(sel, options, current) {
    const focused = document.activeElement === sel;
    sel.replaceChildren(...options.map((opt) => h('option', { value: opt.value, disabled: opt.disabled }, opt.label)));
    sel.value = current;
    if (focused) sel.focus();
  }

  function refreshFacets() {
    for (const f of facets) {
      const base = query.filter(rows, without(c, f.key));
      const values = facetValues[f.key] ?? [];
      const counts = new Map(values.map((v) => [v, 0]));
      for (const row of base) {
        for (const t of f.key === 'tree' ? row.trees : row.tagSet) {
          if (counts.has(t)) counts.set(t, counts.get(t) + 1);
        }
      }
      const opts = values.map((v) => ({ value: v, label: facetLabel(f, v), count: counts.get(v) }));
      if (f.prefix) opts.sort((a, b) => a.label.localeCompare(b.label));
      fillSelect(selects.get(f.key), [
        { value: '', label: t('exl.option', { label: t(f.any), count: base.length }) },
        ...opts.map((o) => ({ value: o.value, label: t('exl.option', { label: o.label, count: o.count }), disabled: o.count === 0 && o.value !== c[f.key] }))
      ], c[f.key]);
    }
    for (const tri of TRI) {
      const base = query.filter(rows, without(c, tri.key));
      const yes = query.filter(base, { hasVideo: null, hasDescription: null, [tri.key]: true }).length;
      const cur = { true: 'yes', false: 'no' }[String(c[tri.key])] ?? '';
      fillSelect(selects.get(tri.key), [
        { value: '', label: t('exl.option', { label: t('exl.any'), count: base.length }) },
        { value: 'yes', label: t('exl.option', { label: t(tri.yes), count: yes }) },
        { value: 'no', label: t('exl.option', { label: t(tri.no), count: base.length - yes }) }
      ], cur);
    }
    const baseU = query.filter(rows, without(c, 'usage'));
    for (const u of USAGE) {
      const n = u.value === 'all' ? baseU.length : query.filter(baseU, { usage: u.value }).length;
      usageCounts.get(u.value).textContent = ` ${fmt(n)}`;
    }
  }

  function renderChips() {
    const parts = [];
    if (c.text.trim()) parts.push({ key: 'text', text: t('exl.chipSearch', { text: c.text.trim() }) });
    for (const f of facets) {
      if (c[f.key]) parts.push({ key: f.key, text: t('exl.chip', { label: facetName(f), value: facetLabel(f, c[f.key]) }), title: c[f.key] });
    }
    if (c.usage !== 'all') parts.push({ key: 'usage', text: t(c.usage === 'used' ? 'exl.usageUsed' : 'exl.usageOrphanChip') });
    for (const tri of TRI) {
      if (c[tri.key] !== null) parts.push({ key: tri.key, text: t(c[tri.key] ? tri.yes : tri.no) });
    }
    chips.replaceChildren(...parts.map((p) => h('span', { class: 'chip chip--on', title: p.title ?? null },
      p.text,
      h('button', {
        type: 'button', class: 'chip__remove', 'aria-label': t('exl.removeFilter', { text: p.text }),
        onclick: () => {
          c[p.key] = defaultCriteria()[p.key];
          if (p.key === 'text') search.value = '';
          if (p.key === 'usage') usageInputs.get('all').checked = true;
          apply();
          (chips.querySelector('.chip__remove') ?? search).focus();
        }
      }, '×'))));
    if (parts.length) chips.append(clearBtn);
    chips.hidden = !parts.length;
  }

  function apply(keepPage = false) {
    filtered = query.filter(rows, c);
    resultLine.replaceChildren(h('strong', null, fmt(filtered.length)), t('exl.resultOf', { total: t('count.exercise', { count: rows.length }) }));
    refreshFacets();
    renderChips();
    const none = filtered.length === 0;
    tableWrap.hidden = none;
    emptySlot.replaceChildren(...(none ? [emptyState({
      title: t('exl.emptyTitle'),
      body: t('exl.emptyBody'),
      action: h('button', { type: 'button', class: 'btn btn--primary', onclick: clearAll }, t('exl.clearFilters'))
    })] : []));
    pager?.update(filtered, keepPage);
    if (!keepPage) state.page = 0;
  }

  root.append(
    h('div', { class: 'page-head exl-head' },
      h('div', { class: 'row row--between' },
        h('h1', { class: 'page-title' }, t('exl.title')),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: () => addExercise(ctx) }, t('exl.add'))),
      h('p', { class: 'page-lead' }, t('exl.lead'))),
    h('section', { class: 'card card--flat exl-filters', 'aria-label': t('exl.filtersLabel') },
      search,
      facetBox,
      h('div', { class: 'row exl-usage-row' },
        h('span', { class: 'field__label' }, t('exl.usage')),
        usageBox)),
    h('div', { class: 'row exl-resultbar' }, resultLine, chips),
    tableWrap,
    emptySlot);

  apply(true);
  pager = new Pager(tbody, filtered, renderRow, { pageSize: PAGE_SIZE, label: t('exl.pagesLabel') });
  pager.goTo(state.page);

  if (state.returning && state.lastId) {
    state.returning = false;
    const idx = filtered.findIndex((r) => r.id === state.lastId);
    if (idx !== -1) {
      pager.goToItem(idx);
      const tr = tbody.querySelector(`tr[data-id="${CSS.escape(state.lastId)}"]`);
      if (tr) {
        tr.focus({ preventScroll: true });
        highlight(tr);
      }
    }
  }

  return {
    update() {
      rows = query.buildRows(ctx.ds);
      facetValues = query.facetValues(ctx.ds);
      apply(true);
    }
  };
}

/* ---------- View ---------- */

function navFor(ctx, id) {
  const list = query.filter(query.buildRows(ctx.ds), state.criteria);
  const i = list.findIndex((r) => r.id === id);
  if (i === -1) return null;
  return {
    position: i + 1,
    total: list.length,
    prev: list[i - 1]?.id ?? null,
    next: list[i + 1]?.id ?? null
  };
}

function render(root, ctx, params, signal) {
  resetFor(ctx.ds);
  if (params?.id) {
    const id = String(params.id);
    const focus = state.pendingFocus === id ? 'name' : null;
    state.pendingFocus = null;
    state.lastId = id;
    state.returning = true;
    state.current = exerciseDetail.render(root, ctx, id, { focus, nav: navFor(ctx, id) });
    return;
  }
  state.current = renderTable(root, ctx, signal);
}

registerView('exercises', {
  render,
  onDataChange: () => state.current?.update()
});
