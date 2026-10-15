// Exercises tab: filterable table (#/exercises) and the detail page (#/exercises/<id>).
import * as model from '../core/model.js';
import * as query from '../core/query.js';
import { debounce, emptyState, fmt, h, highlight, Pager, plural, term, toast, uid } from './dom.js';
import * as exerciseDetail from './exercise-detail.js';
import { registerView } from './registry.js';
import { exerciseHash } from './routes.js';

const PAGE_SIZE = 50;

const FACETS = [
  { key: 'tree', label: 'Skill tree', de: null, any: 'Any skill tree' },
  { key: 'skill', label: 'Skill', de: null, any: 'Any skill', prefix: 'SKILL_' },
  { key: 'region', label: 'Region', de: null, any: 'Any region', prefix: 'REGION_' },
  { key: 'eq', label: 'Equipment', de: 'Ausrüstung', any: 'Any equipment', prefix: 'EQ_' },
  { key: 'place', label: 'Training place', de: 'Trainingsort', any: 'Any place', prefix: 'PLACE_' }
];
const TRI = [
  { key: 'hasVideo', label: 'Video', yes: 'With video', no: 'Without video' },
  { key: 'hasDescription', label: 'Description', de: 'Beschreibung', yes: 'With description', no: 'Without description' }
];
const USAGE = [
  { value: 'all', label: 'All' },
  { value: 'used', label: 'Used in a branch' },
  { value: 'orphan', label: 'Not used' }
];

const defaultCriteria = () => ({
  text: '', tree: '', skill: '', region: '', eq: '', place: '', usage: 'all',
  hasVideo: null, hasDescription: null
});

// Survives navigation between the table and a detail page; reset when a new folder loads.
const state = { ds: null, criteria: defaultCriteria(), page: 0, lastId: null, returning: false, pendingFocus: null, current: null };

function resetFor(ds) {
  if (state.ds === ds) return;
  Object.assign(state, { ds, criteria: defaultCriteria(), page: 0, lastId: null, returning: false, pendingFocus: null });
}

function humanTag(tag, prefix) {
  const s = (prefix && tag.startsWith(prefix) ? tag.slice(prefix.length) : tag).replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const facetLabel = (f, value) => (f.prefix ? humanTag(value, f.prefix) : value);
const without = (c, key) => ({ ...c, [key]: defaultCriteria()[key] });

/** Adds an exercise and opens it with the name field focused. @param {import('./registry.js').Ctx} ctx */
export function addExercise(ctx) {
  const r = ctx.editor.addExercise();
  if (!r.ok) {
    toast(r.errors?.[0]?.message ?? 'The exercise could not be added.', { tone: 'error' });
    return;
  }
  state.pendingFocus = r.id;
  toast(`Exercise ${r.id} added. Give it a name and values.`);
  ctx.navigate(exerciseHash(r.id));
}

const fmtLevel = (v) => (v == null ? '-' : String(v));

function mediaMark(on, text, what) {
  const label = on ? `Has a ${what}` : `No ${what}`;
  return h('span', { class: ['exl-mark', on ? 'is-on' : ''], title: label },
    h('span', { 'aria-hidden': 'true' }, text),
    h('span', { class: 'sr-only' }, label));
}

/* ---------- Table ---------- */

function renderTable(root, ctx, signal) {
  let rows = query.buildRows(ctx.ds);
  let facetValues = query.facetValues(ctx.ds);
  let c = state.criteria;
  let filtered = [];
  let pager = null;

  const search = h('input', {
    type: 'search', class: 'search', 'data-search': '', autocomplete: 'off', value: c.text,
    placeholder: 'Search by id or name, for example 429 or Kniebeuge',
    'aria-label': 'Search exercises by id, name or display name'
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
  const selectField = (key, label, de, onChange) => {
    const id = uid('exl-facet');
    const sel = /** @type {HTMLSelectElement} */ (h('select', { class: 'input', id }));
    sel.addEventListener('change', () => onChange(sel.value));
    selects.set(key, sel);
    return h('div', { class: 'field' }, h('label', { class: 'field__label', for: id }, term(label, de)), sel);
  };
  const facetBox = h('div', { class: 'exl-facets' },
    FACETS.map((f) => selectField(f.key, f.label, f.de, (v) => {
      c[f.key] = v;
      apply();
    })),
    TRI.map((t) => selectField(t.key, t.label, t.de, (v) => {
      c[t.key] = { yes: true, no: false }[v] ?? null;
      apply();
    })));

  const usageName = uid('exl-usage');
  const usageInputs = new Map();
  const usageCounts = new Map();
  const usageBox = h('div', { class: 'segmented exl-usage', role: 'radiogroup', 'aria-label': 'Usage in branches' },
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
      return h('label', null, input, h('span', null, u.label, count));
    }));

  const chips = h('div', { class: 'chip-group exl-active', 'aria-label': 'Active filters' });
  const resultLine = h('p', { class: 'exl-result num', role: 'status', 'aria-live': 'polite' });
  const clearBtn = h('button', { type: 'button', class: 'btn btn--small', onclick: clearAll }, 'Clear all filters');

  const tbody = h('tbody');
  const table = h('table', { class: 'table exl-table' },
    h('caption', { class: 'sr-only' }, 'Exercises. Press Enter on a row to open it.'),
    h('thead', null, h('tr', null,
      h('th', { scope: 'col', class: 'num' }, 'Id'),
      h('th', { scope: 'col' }, 'Exercise'),
      h('th', { scope: 'col', class: 'num', title: 'Exercise level for men / women' }, 'Level m/w'),
      h('th', { scope: 'col' }, 'Skill trees'),
      h('th', { scope: 'col' }, 'Used in'),
      h('th', { scope: 'col' }, 'Video / text'))),
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

  // One listener set on the table body serves every row.
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
    let usedIn = h('span', { class: 'badge badge--advisory' }, 'Not used');
    if (isPause) usedIn = h('span', { class: 'muted small' }, 'System');
    else if (row.branchCount) usedIn = h('span', { class: 'num' }, plural(row.branchCount, 'branch', 'branches'));
    return h('tr', { class: 'is-clickable', tabindex: '0', 'data-id': row.id },
      h('td', { class: 'num mono exl-id' }, row.id),
      h('td', { class: 'exl-label' },
        h('a', { href: exerciseHash(row.id), tabindex: '-1' }, row.label || '(no name)'),
        name ? h('span', { class: 'exl-name' }, name) : null),
      h('td', { class: 'num' }, `${fmtLevel(row.levelM)} / ${fmtLevel(row.levelW)}`),
      h('td', null, trees.length
        ? h('span', { class: 'exl-trees' }, trees.map((t) => h('span', { class: 'exl-tree' }, t)),
          row.trees.length > 3 ? h('span', { class: 'muted small' }, `+${row.trees.length - 3}`) : null)
        : h('span', { class: 'muted' }, '-')),
      h('td', null, usedIn),
      h('td', { class: 'exl-media' },
        mediaMark(row.hasVideo, 'Video', 'video'),
        mediaMark(row.hasDescription, 'Text', 'description')));
  }

  function fillSelect(sel, options, current) {
    const focused = document.activeElement === sel;
    sel.replaceChildren(...options.map((opt) => h('option', { value: opt.value, disabled: opt.disabled }, opt.label)));
    sel.value = current;
    if (focused) sel.focus();
  }

  function refreshFacets() {
    for (const f of FACETS) {
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
        { value: '', label: `${f.any} (${fmt(base.length)})` },
        ...opts.map((o) => ({ value: o.value, label: `${o.label} (${fmt(o.count)})`, disabled: o.count === 0 && o.value !== c[f.key] }))
      ], c[f.key]);
    }
    for (const t of TRI) {
      const base = query.filter(rows, without(c, t.key));
      const yes = query.filter(base, { hasVideo: null, hasDescription: null, [t.key]: true }).length;
      const cur = { true: 'yes', false: 'no' }[String(c[t.key])] ?? '';
      fillSelect(selects.get(t.key), [
        { value: '', label: `Any (${fmt(base.length)})` },
        { value: 'yes', label: `${t.yes} (${fmt(yes)})` },
        { value: 'no', label: `${t.no} (${fmt(base.length - yes)})` }
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
    if (c.text.trim()) parts.push({ key: 'text', text: `Search: "${c.text.trim()}"` });
    for (const f of FACETS) {
      if (c[f.key]) parts.push({ key: f.key, text: `${f.label}: ${facetLabel(f, c[f.key])}`, title: c[f.key] });
    }
    if (c.usage !== 'all') parts.push({ key: 'usage', text: c.usage === 'used' ? 'Used in a branch' : 'Not used in any branch' });
    for (const t of TRI) {
      if (c[t.key] !== null) parts.push({ key: t.key, text: c[t.key] ? t.yes : t.no });
    }
    chips.replaceChildren(...parts.map((p) => h('span', { class: 'chip chip--on', title: p.title ?? null },
      p.text,
      h('button', {
        type: 'button', class: 'chip__remove', 'aria-label': `Remove filter ${p.text}`,
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
    resultLine.replaceChildren(h('strong', null, fmt(filtered.length)), ` of ${plural(rows.length, 'exercise')}`);
    refreshFacets();
    renderChips();
    const none = filtered.length === 0;
    tableWrap.hidden = none;
    emptySlot.replaceChildren(...(none ? [emptyState({
      title: 'No exercise matches',
      body: 'No exercise fits the search and all filters together. Remove a filter or clear them all.',
      action: h('button', { type: 'button', class: 'btn btn--primary', onclick: clearAll }, 'Clear filters')
    })] : []));
    pager?.update(filtered, keepPage);
    if (!keepPage) state.page = 0;
  }

  root.append(
    h('div', { class: 'page-head exl-head' },
      h('div', { class: 'row row--between' },
        h('h1', { class: 'page-title' }, term('Exercises', 'Übungen')),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: () => addExercise(ctx) }, '+ Add exercise')),
      h('p', { class: 'page-lead' },
        'Find an exercise by id or name, narrow the list with the filters, then open it to correct its data.')),
    h('section', { class: 'card card--flat exl-filters', 'aria-label': 'Search and filters' },
      search,
      facetBox,
      h('div', { class: 'row exl-usage-row' },
        h('span', { class: 'field__label' }, term('Usage', 'Verwendung')),
        usageBox)),
    h('div', { class: 'row exl-resultbar' }, resultLine, chips),
    tableWrap,
    emptySlot);

  apply(true);
  pager = new Pager(tbody, filtered, renderRow, { pageSize: PAGE_SIZE, label: 'Exercise pages' });
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
  label: 'Exercises',
  render,
  onDataChange: () => state.current?.update()
});
