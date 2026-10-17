// Dialogs to choose an exercise and to edit a tag list.
import * as model from '../core/model.js';
import { haystack } from '../core/query.js';
import { confirmDialog, debounce, Dialog, fmt, h, notice, uid } from './dom.js';
import { t } from './i18n.js';
import { exerciseTagMeta, tagChipContent, tagGroupLabel, tagLabel } from './terms.js';

const MAX_MATCHES = 50;
const { PAUSE_TAG } = model;

const exerciseEntries = (ds) => ds.exercises
  .filter((ex) => String(ex.id) !== model.PAUSE_ID)
  .map((ex) => ({
    id: String(ex.id),
    label: model.exerciseLabel(ex),
    ex,
    haystack: haystack(ex)
  }));

function describeCurrent(ds, id) {
  if (id == null || id === '') return null;
  const ex = ds.index.exerciseById.get(String(id));
  return ex ? `${ex.id} · ${model.exerciseLabel(ex)}` : t('pick.missing', { id: String(id) });
}

function exerciseMeta(ex) {
  return [
    ex.level ? `m/w ${ex.level.m}/${ex.level.w}` : null,
    ...exerciseTagMeta(ex).map((m) => m.label)
  ].filter(Boolean).join(' · ');
}

const rank = (id, q) => (id === q ? 0 : id.startsWith(q) ? 1 : 2);

/**
 * Resolves to an exercise id, null to clear, or undefined when cancelled.
 * @param {{ ds: import('../core/model.js').Dataset }} ctx
 * @param {{ title?: string, currentId?: unknown, allowClear?: boolean, clearLabel?: string }} [opts]
 * @returns {Promise<string | null | undefined>}
 */
export function pickExercise(ctx, { title = t('pick.chooseExercise'), currentId, allowClear = false, clearLabel = t('pick.clear') } = {}) {
  const entries = exerciseEntries(ctx.ds);
  const listId = uid('pick-list');
  const statusId = uid('pick-status');
  const search = h('input', {
    type: 'search', class: 'search', placeholder: t('pick.searchPlaceholder'),
    'aria-label': t('pick.searchLabel'), 'aria-controls': listId, 'aria-describedby': statusId,
    role: 'combobox', 'aria-expanded': 'true', 'aria-autocomplete': 'list', autocomplete: 'off'
  });
  const status = h('p', { class: 'small muted', id: statusId, 'aria-live': 'polite' });
  const list = h('ul', { class: 'picker-list', id: listId, role: 'listbox', 'aria-label': t('pick.listLabel') });
  const current = describeCurrent(ctx.ds, currentId);
  let matches = [];
  let active = -1;
  let dlg;

  const options = () => [...list.querySelectorAll('li[role="option"]')];

  function setActive(i) {
    const items = options();
    if (!items.length) {
      active = -1;
      search.removeAttribute('aria-activedescendant');
      return;
    }
    active = Math.max(0, Math.min(i, items.length - 1));
    for (const [n, li] of items.entries()) li.setAttribute('aria-selected', String(n === active));
    search.setAttribute('aria-activedescendant', items[active].id);
    items[active].scrollIntoView({ block: 'nearest' });
  }

  function run() {
    const tokens = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const q = tokens.join(' ');
    matches = tokens.length
      ? entries.filter((e) => tokens.every((token) => e.haystack.includes(token))).sort((a, b) => rank(a.id, q) - rank(b.id, q))
      : entries;
    list.replaceChildren(...matches.slice(0, MAX_MATCHES).map((e, i) =>
      h('li', { id: `${listId}-${i}`, role: 'option', 'aria-selected': 'false', dataset: { index: String(i) } },
        h('span', { class: 'picker-list__id' }, e.id),
        h('span', null, e.label,
          e.ex.name && e.ex.name !== e.label ? h('span', { class: 'picker-list__name' }, e.ex.name) : null),
        h('span', { class: 'picker-list__meta' }, exerciseMeta(e.ex)))));
    if (matches.length > MAX_MATCHES) {
      list.append(h('li', { class: 'picker-list__more', role: 'presentation' },
        t('pick.more', { count: matches.length - MAX_MATCHES })));
    }
    if (!matches.length) {
      list.append(h('li', { class: 'picker-list__more', role: 'presentation' },
        t('pick.noMatch', { q: search.value.trim() })));
    }
    status.textContent = tokens.length
      ? `${t('count.match', { count: matches.length })}${matches.length > MAX_MATCHES ? t('pick.firstOnly', { max: MAX_MATCHES }) : ''}`
      : t('pick.all', { count: entries.length });
    setActive(tokens.length ? 0 : -1);
  }

  const optionIndex = (e) => {
    const li = e.target.closest('li[role="option"]');
    return li ? Number(li.dataset.index) : -1;
  };
  list.addEventListener('click', (e) => {
    const i = optionIndex(e);
    if (i !== -1) dlg.close(matches[i].id);
  });
  list.addEventListener('mousemove', (e) => {
    const i = optionIndex(e);
    if (i !== -1 && i !== active) setActive(i);
  });

  const runLater = debounce(run, 80);
  search.addEventListener('input', runLater);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run();
      if (active >= 0 && matches[active]) dlg.close(matches[active].id);
    }
  });

  dlg = new Dialog({
    title,
    wide: true,
    body: [
      current ? notice('info', t('pick.now', { current })) : null,
      h('div', { class: 'stack stack--tight' }, search, status),
      list,
      h('p', { class: 'small muted' }, t('pick.keysHelp'))
    ],
    actions: [
      allowClear ? { label: clearLabel, value: null } : null,
      { spacer: true },
      { label: t('common.cancel'), value: undefined }
    ].filter(Boolean),
    onOpen: () => {
      run();
      search.focus();
    }
  });
  return dlg.result;
}

const normaliseTag = (text) => text.trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/[^A-Z0-9_]/g, '');

// Every tag except PAUSE, with its count on the records of this kind.
function vocabulary(ds, kind) {
  const { exercise, branch } = ds.index.tagCounts;
  const own = kind === 'branch' ? branch : exercise;
  return new Map([...exercise.keys(), ...branch.keys()]
    .filter((tag) => tag !== PAUSE_TAG)
    .map((tag) => [tag, own.get(tag) ?? 0]));
}

/**
 * Resolves to { tags, newTags } or undefined when cancelled. Never offers PAUSE.
 * @param {{ ds: import('../core/model.js').Dataset }} ctx
 * @param {{ title?: string, kind?: 'exercise' | 'branch', current?: string[] }} [opts]
 * @returns {Promise<{ tags: string[], newTags: string[] } | undefined>}
 */
export function pickTags(ctx, { title = t('pick.editTags'), kind = 'exercise', current = [] } = {}) {
  const vocab = vocabulary(ctx.ds, kind);
  const selected = [...new Set(current)];

  /** @type {Map<string, string[]>} */
  const groups = Map.groupBy(vocab.keys(), (tag) => model.tagPrefix(tag));
  const prefixes = [...groups.keys()].sort();
  const labels = new Map([...vocab.keys()].map((tag) => [tag, tagLabel(tag)]));
  for (const tags of groups.values()) tags.sort((a, b) => labels.get(a).localeCompare(labels.get(b)));

  const selectedBox = h('div', { class: 'tag-selected chip-group', 'aria-live': 'polite' });
  const selectedTitle = h('h3', { class: 'section-title' });
  const search = h('input', {
    type: 'search', class: 'search', placeholder: t('pick.tagPlaceholder'),
    'aria-label': t('pick.tagLabel'), autocomplete: 'off'
  });
  const addNewRow = h('div', { class: 'row' });
  const groupsBox = h('div', { class: 'tag-groups' });

  const isNew = (tag) => !vocab.has(tag) && tag !== PAUSE_TAG;

  function renderSelected() {
    selectedTitle.textContent = t('pick.selected', { count: selected.length });
    selectedBox.replaceChildren(...(selected.length ? selected : [null]).map((tag) => {
      if (tag === null) return h('span', { class: 'muted small' }, t('pick.noneSelected'));
      return h('span', { class: ['chip', isNew(tag) ? 'chip--new' : 'chip--on'] },
        tagChipContent(tag),
        isNew(tag) ? h('span', null, t('pick.newMark')) : null,
        tag === PAUSE_TAG ? null : h('button', {
          type: 'button', class: 'chip__remove', 'aria-label': t('pick.remove', { tag: tagLabel(tag) }), onclick: () => toggle(tag)
        }, '×'));
    }));
  }

  function syncPressed() {
    for (const b of groupsBox.querySelectorAll('button[data-tag]')) {
      b.setAttribute('aria-pressed', String(selected.includes(b.dataset.tag)));
    }
  }

  function toggle(tag) {
    const i = selected.indexOf(tag);
    if (i === -1) selected.push(tag);
    else selected.splice(i, 1);
    renderSelected();
    syncPressed();
    renderAddNew();
  }

  function renderAddNew() {
    addNewRow.replaceChildren();
    const tag = normaliseTag(search.value);
    if (!tag || vocab.has(tag) || selected.includes(tag)) return;
    if (tag === PAUSE_TAG) {
      addNewRow.append(h('p', { class: 'small muted' }, t('pick.systemTag', { tag: PAUSE_TAG })));
      return;
    }
    addNewRow.append(
      h('button', { type: 'button', class: 'btn btn--small', onclick: () => addNew(tag) }, t('pick.addNew'), h('span', { class: 'tag' }, tag)),
      h('span', { class: 'small muted' }, t('pick.notInList')));
  }

  async function addNew(tag) {
    const ok = await confirmDialog({
      title: t('pick.addTitle'),
      body: h('div', { class: 'stack stack--tight' },
        h('p', null, h('span', { class: 'tag' }, tag), t('pick.unusedTag')),
        h('p', null, t('pick.addWarning'))),
      confirmLabel: t('pick.addConfirm')
    });
    if (!ok) return;
    if (!selected.includes(tag)) selected.push(tag);
    search.value = '';
    renderSelected();
    renderGroups();
    renderAddNew();
    search.focus();
  }

  function renderGroups() {
    const q = normaliseTag(search.value);
    const text = search.value.trim().toLocaleLowerCase();
    const matches = (tag) => tag.includes(q) || labels.get(tag).toLocaleLowerCase().includes(text);
    const sections = prefixes.flatMap((p) => {
      const tags = q ? groups.get(p).filter(matches) : groups.get(p);
      if (!tags.length) return [];
      return [h('section', null,
        h('h4', { class: 'tag-group__title' },
          tagGroupLabel(p) ?? p,
          ' ', h('span', { class: 'tag muted' }, p)),
        h('div', { class: 'chip-group' }, tags.map((tag) => h('button', {
          type: 'button', class: 'chip', dataset: { tag }, 'aria-pressed': String(selected.includes(tag))
        },
          tagChipContent(tag),
          h('span', { class: 'chip__count' }, fmt(vocab.get(tag)))))))];
    });
    groupsBox.replaceChildren(...(sections.length ? sections : [h('p', { class: 'muted small' }, t('pick.noTag', { q }))]));
  }

  groupsBox.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tag]');
    if (b) toggle(b.dataset.tag);
  });
  const refreshLater = debounce(() => {
    renderGroups();
    renderAddNew();
  }, 80);
  search.addEventListener('input', refreshLater);
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const tag = normaliseTag(search.value);
    if (!tag) return;
    if (vocab.has(tag)) {
      toggle(tag);
      search.select();
    } else if (tag !== PAUSE_TAG && !selected.includes(tag)) {
      addNew(tag);
    }
  });

  renderSelected();
  renderGroups();

  return new Dialog({
    title,
    wide: true,
    body: [
      h('div', { class: 'stack stack--tight' }, selectedTitle, selectedBox),
      h('div', { class: 'stack stack--tight' }, search, addNewRow),
      h('p', { class: 'small muted' }, t(kind === 'branch' ? 'pick.helpBranch' : 'pick.helpExercise')),
      groupsBox
    ],
    actions: [
      { label: t('common.cancel'), value: undefined },
      { label: t('pick.saveTags'), primary: true, onClick: (close) => close({ tags: [...selected], newTags: selected.filter(isNew) }) }
    ],
    onOpen: () => search.focus()
  }).result;
}
