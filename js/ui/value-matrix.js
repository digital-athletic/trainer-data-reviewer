// Value matrix editor: training parameter x start/target x gender x fitness level.
import * as model from '../core/model.js';
import { PICKLISTS } from '../core/schema.js';
import { emptyParameter } from '../core/edits.js';
import { h, notice, toast, uid } from './dom.js';
import { coreText, has, lang, t } from './i18n.js';
import { tagGroupLabel } from './terms.js';

const PARTS = ['startValue', 'targetValue'];

const GENDERS = PICKLISTS.gender;
const LEVELS = PICKLISTS.trainingLevel;
// The label of a picklist value under vm.<group>, or the value itself when the dictionary lacks it.
const label = (group, value) => (has(`vm.${group}.${value}`) ? t(`vm.${group}.${value}`) : value);
const paramName = (p) => label('param', p);
const partName = (part) => label('part', part);
const genderName = (g) => label('gender', g);
const levelName = (l) => label('level', l);

const { originalExercise, isChanged } = model;

/** @param {unknown} v @returns {string} */
const formatValue = (v) => (v == null ? '' : String(v));

const isResidue = (v) => typeof v === 'string' && v !== '';
const firstMessage = (r) => (r.errors?.[0] ? coreText(r.errors[0]) : t('vm.notAllowed'));

const presentParams = (rec) => (model.isObject(rec.values)
  ? Object.keys(rec.values).filter((p) => model.isObject(rec.values[p]))
  : []);

// The open tab and "show all cells" per exercise while the page is open.
const viewState = new Map();
function stateFor(id) {
  if (!viewState.has(id)) viewState.set(id, { param: null, showAll: false });
  return viewState.get(id);
}

function residueCount(rec, param) {
  const p = rec.values?.[param];
  if (!model.isObject(p)) return 0;
  return PARTS.flatMap((part) => {
    const vt = p[part];
    if (!model.isObject(vt)) return [];
    return Object.entries(vt)
      .filter(([g, byLevel]) => g !== 'type' && model.isObject(byLevel))
      .flatMap(([, byLevel]) => Object.values(byLevel).filter(isResidue));
  }).length;
}

// Rows and columns that hold at least one key in the start or target value.
function presentGrid(rec, param) {
  const p = rec.values[param];
  const rows = new Set();
  const cols = new Set();
  for (const part of PARTS) {
    const vt = p[part];
    if (!model.isObject(vt)) continue;
    for (const g of GENDERS) {
      if (!model.isObject(vt[g])) continue;
      const keys = Object.keys(vt[g]).filter((l) => LEVELS.includes(l));
      if (keys.length) cols.add(g);
      for (const l of keys) rows.add(l);
    }
  }
  return { rows, cols };
}

/**
 * @param {{ ds: model.Dataset, editor: import('../core/edits.js').Editor }} ctx @param {string} id
 * @returns {{ el: HTMLElement, sync: () => void }}
 */
export function build(ctx, id) {
  const st = stateFor(id);
  const root = h('div', { class: 'vm' });
  let cells = [];
  let tabs = [];
  let shown = null;
  let signature = null;
  let errorBox = null;
  let revertSlot = null;
  let residueSlot = null;
  let allRevertSlot = null;
  let pendingFocus = null;
  const errorId = uid('vm-error');

  const rec = () => ctx.ds.index.exerciseById.get(id);
  const target = () => ({ kind: 'exercise', id });

  function sigOf(r) {
    const types = st.param
      ? PARTS.map((part) => (model.hasAt(r, ['values', st.param, part, 'type', 'type']) ? 't' : '-')).join('')
      : '';
    return `${presentParams(r).join(',')}|${st.param}|${st.showAll}|${types}|${r.values === null ? 'null' : 'obj'}`;
  }

  function pickParam(r) {
    const ps = presentParams(r);
    if (!ps.includes(st.param)) st.param = ps[0] ?? null;
    return ps;
  }

  function computeShown(r) {
    const all = { rows: new Set(LEVELS), cols: new Set(GENDERS) };
    if (st.showAll) return all;
    const g = presentGrid(r, st.param);
    if (!g.rows.size || !g.cols.size) return all;
    if (shown) {
      for (const x of shown.rows) g.rows.add(x);
      for (const x of shown.cols) g.cols.add(x);
    }
    return g;
  }

  function setError(cell, message) {
    if (!errorBox) return;
    if (cell) {
      cell.input.setAttribute('aria-invalid', 'true');
      cell.input.setAttribute('aria-describedby', errorId);
    }
    errorBox.textContent = message;
    errorBox.dataset.cell = cell ? cell.key : '';
  }

  function clearError(cell) {
    if (cell) {
      cell.input.removeAttribute('aria-invalid');
      cell.input.removeAttribute('aria-describedby');
    }
    if (errorBox && (!cell || errorBox.dataset.cell === cell.key)) {
      errorBox.textContent = '';
      errorBox.dataset.cell = '';
    }
  }

  function commit(cell) {
    const r = ctx.editor.setField(target(), cell.path, cell.input.value);
    if (!r.ok) {
      setError(cell, t('vm.cellError', { cell: cell.label, message: firstMessage(r) }));
      return false;
    }
    clearError(cell);
    const current = rec();
    if (current) {
      cell.lastShown = formatValue(model.getAt(current, cell.path));
      cell.input.value = cell.lastShown;
      paintCell(cell, current);
    }
    return true;
  }

  function paintCell(cell, r) {
    const v = model.getAt(r, cell.path);
    const exists = model.hasAt(r, cell.path);
    const residue = isResidue(v);
    const changed = isChanged(ctx.ds, r, cell.path);
    cell.td.classList.toggle('is-residue', residue);
    cell.td.classList.toggle('is-absent', !exists);
    cell.td.classList.toggle('is-changed', changed);
    const hints = [];
    if (residue) hints.push(t('vm.residueHint'));
    if (!exists) hints.push(t('vm.absentHint'));
    if (changed) {
      const orig = originalExercise(ctx.ds, id);
      const was = orig && model.hasAt(orig, cell.path) ? `"${formatValue(model.getAt(orig, cell.path))}"` : t('vm.notSetLower');
      hints.push(t('vm.changedHint', { was }));
    }
    cell.input.title = hints.join(' ');
  }

  function focusCell(part, gi, li) {
    const c = cells.find((x) => x.part === part && x.gi === gi && x.li === li);
    if (!c) return false;
    c.input.focus();
    c.input.select();
    return true;
  }

  function onCellKey(cell, e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (cell.input.value !== cell.lastShown && !commit(cell)) return;
      focusCell(cell.part, cell.gi, cell.li + 1);
    } else if (e.key === 'Escape') {
      cell.input.value = cell.lastShown;
      clearError(cell);
    }
  }

  function typeRowFor(r, part) {
    const typePath = ['values', st.param, part, 'type', 'type'];
    const hasType = model.hasAt(r, typePath);
    if (st.param !== 'weight' && !hasType) return null;
    const partLabel = partName(part);
    const current = model.getAt(r, typePath);
    const select = h('select', { class: 'input vm-type', 'data-part': part, 'aria-label': t('vm.typeLabel', { part: partLabel }) },
      hasType ? null : h('option', { value: '' }, t('vm.notSet')),
      PICKLISTS.valueTypeType.map((v) => h('option', { value: v, selected: v === current }, label('type', v))));
    select.value = hasType ? current : '';
    select.addEventListener('change', () => {
      if (!select.value) return;
      const res = ctx.editor.setField(target(), typePath, select.value);
      if (!res.ok) setError(null, t('vm.typeError', { part: partLabel, message: firstMessage(res) }));
    });
    return h('label', { class: 'vm-type-row' },
      h('span', { class: 'small' }, tagGroupLabel('EQ_TYPE_')),
      select,
      isChanged(ctx.ds, r, typePath) ? h('span', { class: 'changed-dot', title: t('common.changed') }) : null);
  }

  function gridFor(r, part) {
    const rows = LEVELS.filter((l) => shown.rows.has(l));
    const cols = GENDERS.filter((g) => shown.cols.has(g));
    const partLabel = partName(part);
    const titleId = uid('vm-title');

    const tbody = h('tbody', null, rows.map((l, li) => h('tr', null,
      h('th', { scope: 'row' }, levelName(l)),
      cols.map((g, gi) => {
        const path = ['values', st.param, part, g, l];
        const cellLabel = `${partLabel}, ${genderName(g)}, ${levelName(l)}`;
        const input = h('input', {
          type: 'text', inputmode: 'decimal', class: 'vm-cell', autocomplete: 'off',
          'data-cell': `${part}.${g}.${l}`, 'aria-label': cellLabel
        });
        const td = h('td', null, input);
        const cell = { key: `${part}.${g}.${l}`, part, gi, li, path, input, td, label: cellLabel, lastShown: formatValue(model.getAt(r, path)) };
        input.value = cell.lastShown;
        input.addEventListener('change', () => commit(cell));
        input.addEventListener('keydown', (e) => onCellKey(cell, e));
        paintCell(cell, r);
        cells.push(cell);
        return td;
      }))));

    return h('section', { class: 'vm-grid', 'aria-labelledby': titleId },
      h('h4', { class: 'vm-grid__title', id: titleId }, partLabel),
      typeRowFor(r, part),
      h('div', { class: 'vm-table-wrap' },
        h('table', { class: 'vm-table', 'aria-labelledby': titleId },
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', class: 'vm-corner' }, h('span', { class: 'sr-only' }, t('vm.fitnessLevel'))),
            cols.map((g) => h('th', { scope: 'col' }, genderName(g))))),
          tbody)));
  }

  function paintSlots(r) {
    const ps = presentParams(r);
    for (const tab of tabs) {
      tab.dot.hidden = !isChanged(ctx.ds, r, ['values', tab.param]);
      tab.warn.hidden = residueCount(r, tab.param) === 0;
    }
    allRevertSlot?.replaceChildren(...(isChanged(ctx.ds, r, ['values'])
      ? [h('button', {
        type: 'button', class: 'link-btn small', 'data-fkey': 'vm-revert-all',
        onclick: () => ctx.editor.revertField(target(), ['values'])
      }, t('vm.revertAll'))]
      : []));
    if (revertSlot && st.param && ps.includes(st.param)) {
      const { param } = st;
      revertSlot.replaceChildren(...(isChanged(ctx.ds, r, ['values', param])
        ? [h('span', { class: 'changed-dot', 'aria-hidden': 'true' }),
          h('button', {
            type: 'button', class: 'link-btn small', 'data-fkey': 'vm-revert-param',
            onclick: () => ctx.editor.revertField(target(), ['values', param])
          }, t('vm.revertParam', { param: lang() === 'en' ? paramName(param).toLowerCase() : paramName(param) }))]
        : []));
    }
    if (residueSlot && st.param) {
      const n = residueCount(r, st.param);
      residueSlot.replaceChildren(...(n
        ? [notice('warning', t('vm.residueTitle', { count: n }), h('p', null, t('vm.residueBody')))]
        : []));
    }
  }

  function addParam(param) {
    const res = ctx.editor.setField(target(), ['values', param], emptyParameter());
    if (!res.ok) {
      toast(firstMessage(res), { tone: 'error' });
      return;
    }
    st.param = param;
    st.showAll = true;
    pendingFocus = `vm-tab-${param}`;
  }

  function selectTab(p) {
    st.param = p;
    shown = null;
    render();
    root.querySelector(`[data-fkey="vm-tab-${p}"]`)?.focus();
  }

  function render() {
    const r = rec();
    root.replaceChildren();
    cells = [];
    tabs = [];
    revertSlot = residueSlot = errorBox = null;
    if (!r) return;
    const ps = pickParam(r);
    shown = st.param ? computeShown(r) : null;
    signature = sigOf(r);

    const missing = PICKLISTS.trainingParameter.filter((p) => !ps.includes(p));
    const addBox = missing.length ? h('div', { class: 'vm-add' },
      h('span', { class: 'small muted' }, t('vm.addParam')),
      missing.map((p) => h('button', {
        type: 'button', class: 'btn btn--small', 'data-fkey': `vm-add-${p}`, onclick: () => addParam(p)
      }, '+ ', paramName(p)))) : null;

    allRevertSlot = h('span', { class: 'vm-revert-all' });

    if (!ps.length) {
      root.append(h('div', { class: 'vm-empty' },
        h('p', null, t(r.values === null ? 'vm.emptyNull' : 'vm.emptyNone')),
        addBox, allRevertSlot));
      paintSlots(r);
      return;
    }

    const tablist = h('div', { class: 'vm-tabs', role: 'tablist', 'aria-label': t('vm.paramsLabel') });
    for (const [i, p] of ps.entries()) {
      const dot = h('span', { class: 'changed-dot', title: t('common.changed'), hidden: true });
      const warn = h('span', { class: 'vm-tab__warn', title: t('vm.textCells'), hidden: true }, '!');
      const btn = h('button', {
        type: 'button', role: 'tab', class: 'vm-tab', 'data-fkey': `vm-tab-${p}`,
        'aria-selected': String(p === st.param), tabindex: p === st.param ? '0' : '-1',
        onclick: () => { if (st.param !== p) selectTab(p); }
      }, paramName(p), warn, dot);
      btn.addEventListener('keydown', (e) => {
        const next = { ArrowRight: ps[(i + 1) % ps.length], ArrowLeft: ps.at(i - 1) }[e.key];
        if (!next) return;
        e.preventDefault();
        selectTab(next);
      });
      tabs.push({ param: p, btn, dot, warn });
      tablist.append(btn);
    }

    const showAll = h('input', { type: 'checkbox', checked: st.showAll, 'data-fkey': 'vm-showall' });
    showAll.addEventListener('change', () => {
      st.showAll = showAll.checked;
      shown = null;
      render();
      root.querySelector('[data-fkey="vm-showall"]')?.focus();
    });

    revertSlot = h('span', { class: 'vm-revert' });
    residueSlot = h('div');
    errorBox = h('p', { class: 'field__error', id: errorId, role: 'alert', 'aria-live': 'assertive' });

    const panel = h('div', { class: 'vm-panel', role: 'tabpanel', 'aria-label': paramName(st.param) },
      h('div', { class: 'vm-panel__head' },
        h('h3', { class: 'vm-panel__title' }, paramName(st.param)),
        revertSlot,
        h('span', { class: 'spacer' }),
        h('label', { class: 'check' }, showAll, t('vm.showAll'))),
      residueSlot,
      h('div', { class: 'vm-grids' }, PARTS.map((part) => gridFor(r, part))),
      errorBox,
      h('p', { class: 'small muted' },
        t('vm.help'),
        h('kbd', null, t('keys.tab')), t('vm.helpTab'), h('kbd', null, t('keys.enter')), t('vm.helpEnter'),
        h('kbd', null, t('keys.esc')), t('vm.helpEsc')));

    root.append(h('div', { class: 'vm-toolbar' }, tablist, h('span', { class: 'spacer' }), allRevertSlot), panel);
    if (addBox) root.append(addBox);
    paintSlots(r);
  }

  function sync() {
    const r = rec();
    if (!r) return;
    pickParam(r);
    if (sigOf(r) !== signature) {
      const active = document.activeElement;
      let key = active instanceof HTMLElement && root.contains(active) ? (active.dataset.cell || active.dataset.fkey) : null;
      render();
      if (pendingFocus) {
        key = pendingFocus;
        pendingFocus = null;
      }
      if (key) (root.querySelector(`[data-cell="${CSS.escape(key)}"]`) ?? root.querySelector(`[data-fkey="${CSS.escape(key)}"]`))?.focus();
      return;
    }
    for (const cell of cells) {
      const v = formatValue(model.getAt(r, cell.path));
      if (document.activeElement !== cell.input || cell.input.value === cell.lastShown) {
        if (cell.input.value !== v) clearError(cell);
        cell.input.value = v;
      }
      cell.lastShown = v;
      paintCell(cell, r);
    }
    const active = document.activeElement;
    const fkey = active instanceof HTMLElement && root.contains(active) ? active.dataset.fkey : null;
    paintSlots(r);
    if (fkey && !root.contains(active)) root.querySelector(`[data-fkey="${CSS.escape(fkey)}"]`)?.focus();
    for (const s of root.querySelectorAll('.vm-type')) {
      const path = ['values', st.param, s.dataset.part, 'type', 'type'];
      if (document.activeElement !== s && model.hasAt(r, path)) s.value = model.getAt(r, path);
    }
  }

  render();
  return { el: root, sync };
}
