// Exercise detail form (#/exercises/<id>).
import * as model from '../core/model.js';
import { parseCellInput } from '../core/schema.js';
import { referencesTo } from '../core/edits.js';
import { confirmDialog, Dialog, emptyState, fmt, h, messageDialog, notice, toast, uid } from './dom.js';
import { coreText, lang, t } from './i18n.js';
import { pickExercise, pickTags } from './pickers.js';
import * as valueMatrix from './value-matrix.js';
import { exerciseHash } from './routes.js';
import { tagChipContent, tagGroupLabel, tagLabel } from './terms.js';

const { TAG_GROUPS } = model;

// label and hint are dictionary keys.
const FLAGS = [
  { key: 'isAdvanceByReps', label: 'detail.advanceByReps', hint: 'detail.advanceByRepsHint' },
  { key: 'isAdvanceByDuration', label: 'detail.advanceByDuration', hint: 'detail.advanceByDurationHint' },
  { key: 'isJump', label: 'detail.jump', hint: 'detail.jumpHint' }
];

const record = (ctx, id) => ctx.ds.index.exerciseById.get(id);
const changed = (ctx, rec, path) => model.isChanged(ctx.ds, rec, path);
const firstError = (r) => {
  const m = r?.errors?.[0] ?? r?.reason;
  return m ? coreText(m) : t('detail.notAllowed');
};
// English writes a field name inside a sentence in lower case, German keeps the noun capitalised.
const inSentence = (label) => (lang() === 'en' ? label.toLowerCase() : label);

// Rebuilds a section and puts focus back on the same control (matched by data-fkey).
function rebuild(el, build) {
  const active = document.activeElement;
  const key = active instanceof HTMLElement && el.contains(active) ? active.dataset.fkey : null;
  el.replaceChildren(...[build()].flat().filter(Boolean));
  if (key) el.querySelector(`[data-fkey="${CSS.escape(key)}"]`)?.focus();
}

function card(title, body, { cls = '', lead, aside } = {}) {
  const titleId = uid('exd-sec');
  return h('section', { class: ['card', 'card--flat', 'exd-card', cls], 'aria-labelledby': titleId },
    h('div', { class: 'exd-card__head' },
      h('h2', { class: 'exd-card__title', id: titleId }, title),
      aside ?? null),
    lead ? h('p', { class: 'small muted exd-card__lead' }, lead) : null,
    body);
}

/* ---------- Form fields ---------- */

/**
 * @typedef {{ key: string, label: string, path: string[], kind: 'text' | 'textarea' | 'number' | 'checkbox',
 *   hint?: string, placeholder?: string, show: (rec: Exercise) => string | boolean,
 *   parse?: (text: string, rec: Exercise) => { value?: unknown, error?: string }, warn?: (rec: Exercise) => string }} FieldSpec
 *   label and hint hold the shown text.
 * @typedef {import('../core/model.js').Exercise} Exercise
 */

/** @param {import('./registry.js').Ctx} ctx @param {string} id @param {FieldSpec} spec */
function field(ctx, id, spec) {
  const inputId = uid('exd-f');
  const hintId = `${inputId}-hint`;
  const warnId = `${inputId}-warn`;
  const errId = `${inputId}-err`;
  const isCheck = spec.kind === 'checkbox';
  const fkey = `f-${spec.key}`;
  let input;
  if (spec.kind === 'textarea') {
    input = h('textarea', { class: 'input', id: inputId, rows: '5', 'data-fkey': fkey });
  } else if (isCheck) {
    input = h('input', { type: 'checkbox', id: inputId, 'data-fkey': fkey });
  } else {
    input = h('input', {
      type: 'text', class: ['input', spec.kind === 'number' ? 'input--number' : ''], id: inputId,
      inputmode: spec.kind === 'number' ? 'decimal' : null, autocomplete: 'off',
      placeholder: spec.placeholder ?? null, 'data-fkey': fkey
    });
  }
  const dot = h('span', { class: 'changed-dot', hidden: true, title: t('detail.changedTitle') });
  const dotText = h('span', { class: 'sr-only', hidden: true }, t('detail.changedText'));
  const revert = h('button', {
    type: 'button', class: 'link-btn small exd-revert', hidden: true, 'data-fkey': `r-${spec.key}`,
    'aria-label': t('detail.revertField', { field: inSentence(spec.label) })
  }, t('detail.revert'));
  const hint = spec.hint ? h('p', { class: 'field__hint', id: hintId }, spec.hint) : null;
  const warn = h('p', { class: 'field__warn', id: warnId });
  const error = h('p', { class: 'field__error', id: errId, role: 'alert' });
  let lastShown = null;

  function describedBy() {
    const ids = [hint ? hintId : null, warn.textContent ? warnId : null, error.textContent ? errId : null].filter(Boolean);
    if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
    else input.removeAttribute('aria-describedby');
  }

  function setError(msg) {
    error.textContent = msg ?? '';
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    describedBy();
  }

  function commit() {
    const rec = record(ctx, id);
    if (!rec) return;
    let value = input.value;
    if (isCheck) {
      value = input.checked;
    } else if (spec.parse) {
      const p = spec.parse(input.value, rec);
      if (p.error) {
        setError(p.error);
        return;
      }
      ({ value } = p);
    }
    const r = ctx.editor.setField({ kind: 'exercise', id }, spec.path, value);
    if (!r.ok) {
      setError(firstError(r));
      if (isCheck) input.checked = !value;
      return;
    }
    setError('');
    sync(true);
  }

  function sync(force = false) {
    const rec = record(ctx, id);
    if (!rec) return;
    const v = spec.show(rec);
    if (isCheck) {
      input.checked = v === true;
    } else if (force || document.activeElement !== input || input.value === lastShown) {
      if (input.value !== v && !force) setError('');
      input.value = v;
    }
    lastShown = v;
    const isChanged = changed(ctx, rec, spec.path);
    dot.hidden = !isChanged;
    dotText.hidden = !isChanged;
    revert.hidden = !isChanged;
    warn.textContent = spec.warn?.(rec) ?? '';
    describedBy();
  }

  input.addEventListener('change', commit);
  if (!isCheck && spec.kind !== 'textarea') {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (input.value !== lastShown) commit();
      } else if (e.key === 'Escape' && input.value !== lastShown) {
        input.value = lastShown;
        setError('');
      }
    });
  }
  revert.addEventListener('click', () => {
    const r = ctx.editor.revertField({ kind: 'exercise', id }, spec.path);
    if (!r.ok) {
      toast(firstError(r), { tone: 'error' });
      return;
    }
    setError('');
    sync(true);
    input.focus();
  });

  const el = isCheck
    ? h('div', { class: 'field exd-flag' },
      h('div', { class: 'exd-flag__row' },
        h('label', { class: 'check', for: inputId }, input, spec.label),
        dot, dotText, h('span', { class: 'spacer' }), revert),
      hint, warn, error)
    : h('div', { class: ['field', 'exd-field', spec.kind === 'number' ? 'exd-field--number' : ''] },
      h('div', { class: 'exd-field__label' },
        h('label', { class: 'field__label', for: inputId }, spec.label),
        dot, dotText, h('span', { class: 'spacer' }), revert),
      input, hint, warn, error);
  sync(true);
  return { el, sync, input };
}

/** @param {'m' | 'w'} g @returns {FieldSpec} */
const levelSpec = (g) => ({
  key: `level-${g}`, label: t(g === 'm' ? 'detail.levelM' : 'detail.levelW'), path: ['level', g], kind: 'number',
  hint: t(g === 'm' ? 'detail.levelMHint' : 'detail.levelWHint'),
  show: (rec) => (rec.level?.[g] != null ? String(rec.level[g]) : ''),
  parse: (text) => {
    const p = parseCellInput(text);
    if (!p.ok || p.value === '') return { error: t('detail.levelEmpty') };
    return { value: p.value };
  },
  warn: (rec) => {
    const v = rec.level?.[g];
    return typeof v === 'number' && (v < 1 || v > 6) ? t('detail.levelRange') : '';
  }
});

/** @returns {FieldSpec[]} */
const basicSpecs = () => [
  {
    key: 'name', label: t('detail.name'), path: ['name'], kind: 'text',
    hint: t('detail.nameHint'),
    show: (rec) => (rec.name == null ? '' : String(rec.name)),
    parse: (text) => (text.trim() === '' ? { error: t('core.nameEmpty') } : { value: text }),
    warn: (rec) => (typeof rec.name === 'string' && rec.name.trim() === '' ? t('detail.nameMissing') : '')
  },
  {
    key: 'displayName', label: t('detail.displayName'), path: ['displayName'], kind: 'text',
    hint: t('detail.displayNameHint'),
    show: (rec) => (rec.displayName == null ? '' : String(rec.displayName))
  },
  {
    key: 'description', label: t('detail.description'), path: ['description'], kind: 'textarea',
    hint: t('detail.descriptionHint'),
    show: (rec) => (rec.description == null ? '' : String(rec.description).replace(/\r\n/g, '\n')),
    // Keeps the Windows line breaks the catalog uses, so an edit changes only the text.
    parse: (text, rec) => {
      const crlf = typeof rec.description === 'string' && rec.description.includes('\r\n');
      return { value: crlf ? text.replace(/\r?\n/g, '\r\n') : text };
    }
  }
];

/* ---------- Sections ---------- */

function exLink(ctx, otherId, fkey) {
  const ex = record(ctx, String(otherId));
  return h('a', { href: exerciseHash(otherId), 'data-fkey': fkey ?? null },
    h('span', { class: 'mono' }, String(otherId)), ex ? ` ${model.exerciseLabel(ex)}` : t('detail.missing'));
}

const joinLinks = (ctx, ids) => ids.map((x, i) => [i ? ', ' : '', exLink(ctx, x)]);

function otherSideSection(ctx, id, page) {
  const el = h('div', { class: 'stack stack--tight' });
  const error = h('p', { class: 'field__error', role: 'alert' });

  function apply(otherId, linkBack) {
    const r = ctx.editor.setOtherSide(id, otherId, { linkBack });
    if (!r.ok) {
      error.textContent = firstError(r);
      return;
    }
    error.textContent = '';
    if (otherId == null) toast(t('detail.otherRemoved'));
    else toast(t(linkBack ? 'detail.otherSetBack' : 'detail.otherSet', { id: String(otherId) }));
  }

  async function choose() {
    const rec = record(ctx, id);
    const picked = await pickExercise(ctx, {
      title: t('detail.otherChooseTitle', { id }), currentId: rec.otherSideExerciseId,
      allowClear: rec.otherSideExerciseId != null, clearLabel: t('detail.otherRemove')
    });
    if (picked !== undefined) apply(picked, page.linkBack);
  }

  function build() {
    const rec = record(ctx, id);
    const other = rec.otherSideExerciseId;
    const partner = other == null ? undefined : record(ctx, String(other));
    let status = null;
    if (other != null) {
      if (!partner) {
        status = h('span', { class: 'badge badge--blocking' }, t('detail.otherMissing', { id: String(other) }));
      } else if (String(partner.otherSideExerciseId) === id) {
        status = h('span', { class: 'badge badge--success' }, t('detail.otherPointsBack'));
      } else {
        status = h('span', { class: 'badge badge--blocking' },
          t('detail.otherNoBack', { id: String(other), other: partner.otherSideExerciseId ?? t('detail.nothing') }));
      }
    }
    const isChanged = changed(ctx, rec, ['otherSideExerciseId']);

    const linkBack = h('input', { type: 'checkbox', checked: page.linkBack, 'data-fkey': 'os-linkback' });
    linkBack.addEventListener('change', () => { page.linkBack = linkBack.checked; });

    const pointing = (ctx.ds.index.otherSideRefsByExerciseId.get(id) ?? []).filter((x) => x !== id && String(x) !== String(other));
    return [
      h('div', { class: 'exd-other' },
        other == null
          ? h('p', { class: 'muted' }, t('detail.otherNone'))
          : h('p', { class: 'exd-other__now' }, exLink(ctx, other, 'os-link')),
        status,
        isChanged ? h('span', { class: 'changed-dot', title: t('detail.changedTitle') }) : null),
      h('label', { class: 'check' }, linkBack, t('detail.linkBack')),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn--small', 'data-fkey': 'os-choose', onclick: choose },
          t(other == null ? 'detail.otherChoose' : 'detail.otherChange')),
        other != null ? h('button', {
          type: 'button', class: 'btn btn--small btn--ghost', 'data-fkey': 'os-clear', onclick: () => apply(null, page.linkBack)
        }, t('detail.otherRemove')) : null,
        partner && String(partner.otherSideExerciseId) !== id
          ? h('button', {
            type: 'button', class: 'btn btn--small', 'data-fkey': 'os-fix', onclick: () => apply(String(other), true)
          }, t('detail.otherFix', { id: String(other) })) : null,
        isChanged ? h('button', {
          type: 'button', class: 'link-btn small', 'data-fkey': 'os-revert',
          onclick: () => {
            const r = ctx.editor.revertField({ kind: 'exercise', id }, ['otherSideExerciseId']);
            if (!r.ok) error.textContent = firstError(r);
          }
        }, t('detail.revert')) : null),
      pointing.length ? h('p', { class: 'small' }, t('detail.otherNamedBy'), joinLinks(ctx, pointing)) : null,
      error
    ];
  }

  return { el, sync: () => rebuild(el, build) };
}

function groupTags(tags) {
  const groups = new Map(TAG_GROUPS.map(({ prefix }) => [prefix, []]));
  const other = [];
  for (const tag of tags) {
    const p = model.tagPrefix(tag);
    if (groups.has(p)) groups.get(p).push(tag);
    else other.push(tag);
  }
  return { groups, other };
}

function tagsSection(ctx, id) {
  const el = h('div', { class: 'stack stack--tight' });
  const error = h('p', { class: 'field__error', role: 'alert' });
  const isPause = id === model.PAUSE_ID;

  async function edit() {
    const rec = record(ctx, id);
    const res = await pickTags(ctx, { title: t('detail.tagsTitle', { id, name: model.exerciseLabel(rec) }), kind: 'exercise', current: rec.tags ?? [] });
    if (!res) return;
    const r = ctx.editor.setTags({ kind: 'exercise', id }, res.tags, { confirmedNewTags: res.newTags });
    error.textContent = r.ok ? '' : firstError(r);
  }

  const chip = (tag, n) => h('span', { class: ['chip', n > 1 ? 'chip--new' : ''] },
    tagChipContent(tag), n > 1 ? h('span', null, t('detail.times', { count: n })) : null);

  function build() {
    const rec = record(ctx, id);
    const tags = Array.isArray(rec.tags) ? rec.tags : [];
    const counts = new Map();
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const unique = [...counts.keys()];
    const { groups, other } = groupTags(unique);
    const isChanged = changed(ctx, rec, ['tags']);
    const dup = unique.filter((tag) => counts.get(tag) > 1);

    const list = h('dl', { class: 'exd-tags' },
      TAG_GROUPS.flatMap(({ prefix }) => {
        const items = groups.get(prefix);
        if (!items.length) return [];
        return [h('dt', null, tagGroupLabel(prefix)), h('dd', null, h('div', { class: 'chip-group' }, items.map((tag) => chip(tag, counts.get(tag)))))];
      }),
      other.length ? [h('dt', null, t('tagGroup.other')), h('dd', null, h('div', { class: 'chip-group' }, other.map((tag) => chip(tag, 1))))] : null);

    return [
      dup.length ? notice('warning', t('detail.dupTitle'), h('p', null,
        t('detail.dup', { count: dup.length, tags: dup.map(tagLabel).join(', ') }))) : null,
      unique.length ? list : h('p', { class: 'muted' }, t('detail.noTags')),
      isPause
        ? h('p', { class: 'small muted' }, t('detail.pauseTags'))
        : h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn--small', 'data-fkey': 'tags-edit', onclick: edit }, t('detail.editTags')),
          isChanged ? h('span', { class: 'changed-dot', title: t('detail.changedTitle') }) : null,
          isChanged ? h('button', {
            type: 'button', class: 'link-btn small', 'data-fkey': 'tags-revert',
            onclick: () => {
              const r = ctx.editor.revertField({ kind: 'exercise', id }, ['tags']);
              if (!r.ok) error.textContent = firstError(r);
            }
          }, t('detail.revertTags')) : null),
      error
    ];
  }

  return { el, sync: () => rebuild(el, build) };
}

function usedInSection(ctx, id) {
  const el = h('div');
  function build() {
    const refs = ctx.ds.index.branchRefsByExerciseId.get(id) ?? [];
    if (!refs.length) {
      return h('p', { class: 'muted' }, t(id === model.PAUSE_ID ? 'detail.pauseUsedIn' : 'detail.unused'));
    }
    const byBranch = new Map();
    for (const { tree, branchId, level } of refs) {
      const key = `${tree}/${branchId}`;
      if (!byBranch.has(key)) byBranch.set(key, { tree, branchId, levels: [] });
      byBranch.get(key).levels.push(level);
    }
    const items = [...byBranch.values()].sort((a, b) =>
      (a.tree === b.tree ? Number(a.branchId) - Number(b.branchId) : (a.tree < b.tree ? -1 : 1)));
    return h('ul', { class: 'exd-links' }, items.map(({ tree, branchId, levels }) => h('li', null,
      h('span', { class: 'exd-links__item' },
        h('span', { class: 'exd-links__main' }, tree, h('span', { class: 'muted' }, t('detail.branchSep')), h('span', { class: 'mono' }, branchId)),
        h('span', { class: 'exd-links__meta' }, t('detail.levels', { count: levels.length, levels: levels.toSorted().join(', ') }))))));
  }
  return { el, sync: () => rebuild(el, build) };
}

function factsSection(ctx, id) {
  const el = h('div');
  const none = () => h('span', { class: 'muted' }, t('common.none'));
  const path = (v) => (v ? h('span', { class: 'mono small exd-path' }, v) : none());
  function build() {
    const rec = record(ctx, id);
    const rows = [
      ['detail.picture', path(rec.picture)],
      ['detail.video', path(rec.video)]
    ];
    if (Object.hasOwn(rec, 'conversionFactor')) rows.push(['detail.conversionFactor', h('span', { class: 'mono' }, String(rec.conversionFactor))]);
    if (Object.hasOwn(rec, 'equivalentExercises')) {
      const eq = Array.isArray(rec.equivalentExercises) ? rec.equivalentExercises : [];
      rows.push(['detail.equivalent', eq.length ? h('span', null, joinLinks(ctx, eq)) : none()]);
    }
    return h('dl', { class: 'exd-facts' }, rows.map(([key, value]) => [h('dt', null, t(key)), h('dd', null, value)]));
  }
  return { el, sync: () => rebuild(el, build) };
}

function refLabel(ctx, ref) {
  if (ref.kind === 'branchLevel') {
    return h('span', null, t('detail.refBranch', { tree: ref.tree, id: ref.branchId, level: ref.level }));
  }
  return [h('span', null, t('detail.refOtherSide')), exLink(ctx, ref.exerciseId)];
}

async function deleteFlow(ctx, id) {
  const refs = referencesTo(ctx.ds, id);
  if (refs.length) {
    const list = h('ul', { class: 'exd-links exd-links--dialog' }, refs.map((r) => h('li', null, refLabel(ctx, r))));
    const dlg = new Dialog({
      title: t('detail.inUseTitle'),
      wide: true,
      body: [
        h('p', null, t('detail.inUseBody', { id, refs: t('count.reference', { count: refs.length }) })),
        list
      ],
      actions: [{ label: t('common.close'), value: undefined, autofocus: true }]
    });
    list.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      dlg.close(undefined);
      ctx.navigate(a.getAttribute('href'));
    });
    return;
  }
  const ex = record(ctx, id);
  const ok = await confirmDialog({
    title: t('detail.deleteTitle', { id }),
    body: h('div', { class: 'stack stack--tight' },
      h('p', null, h('strong', null, model.exerciseLabel(ex) || t('common.noName')), t('detail.deleteRemoved')),
      h('p', null, t('detail.deleteReserved')),
      h('p', { class: 'small muted' }, t('detail.deleteUndo'))),
    confirmLabel: t('detail.deleteConfirm'),
    danger: true
  });
  if (!ok) return;
  const r = ctx.editor.deleteExercise(id);
  if (!r.ok) {
    messageDialog({ title: t('detail.deleteFailed'), body: firstError(r) });
    return;
  }
  toast(t('detail.deleted', { id }));
  ctx.navigate('#/exercises');
}

function deleteSection(ctx, id) {
  const el = h('div', { class: 'stack stack--tight' });
  function build() {
    if (id === model.PAUSE_ID) return h('p', { class: 'small muted' }, t('core.pauseNoDelete'));
    const refs = referencesTo(ctx.ds, id);
    let usage = t(ctx.ds.treeNames.length ? 'detail.notUsed' : 'detail.notUsedNoTrees');
    if (refs.length) usage = t('detail.inUseBy', { refs: t('count.reference', { count: refs.length }) });
    return [
      h('p', { class: 'small muted' }, usage),
      h('div', null, h('button', {
        type: 'button', class: 'btn btn--small btn--danger-outline', 'data-fkey': 'delete', onclick: () => deleteFlow(ctx, id)
      }, t('detail.deleteConfirm')))
    ];
  }
  return { el, sync: () => rebuild(el, build) };
}

/* ---------- Page ---------- */

const notFound = (root, id) => root.append(emptyState({
  title: t('detail.notFoundTitle', { id }),
  body: t('detail.notFoundBody'),
  action: h('a', { class: 'btn btn--primary', href: '#/exercises' }, t('detail.backToAll'))
}));

/**
 * @typedef {{ prev: string | null, next: string | null, position: number, total: number }} DetailNav
 * @param {HTMLElement} root @param {import('./registry.js').Ctx} ctx @param {string} exerciseId
 * @param {{ focus?: 'name' | null, nav?: DetailNav | null }} [opts]
 * @returns {{ update: () => void }}
 */
export function render(root, ctx, exerciseId, { focus = null, nav = null } = {}) {
  const id = String(exerciseId);
  if (!record(ctx, id)) {
    notFound(root, id);
    return { update: () => {} };
  }

  const page = { linkBack: true };
  const isNew = !model.originalExercise(ctx.ds, id);
  const title = h('h1', { class: 'page-title exd-title' });
  const badges = h('div', { class: 'row exd-badges' });

  const head = h('header', { class: 'exd-head' },
    h('div', { class: 'row exd-crumbs' },
      h('a', { href: '#/exercises', class: 'exd-back' }, t('detail.allExercises')),
      h('span', { class: 'spacer' }),
      nav?.total ? h('span', { class: 'small muted num' }, t('detail.position', { position: fmt(nav.position), total: fmt(nav.total) })) : null,
      nav?.prev ? h('a', { class: 'btn btn--small', href: exerciseHash(nav.prev), rel: 'prev' }, t('pager.previous')) : null,
      nav?.next ? h('a', { class: 'btn btn--small', href: exerciseHash(nav.next), rel: 'next' }, t('pager.next')) : null),
    h('div', { class: 'exd-titlebar' },
      h('span', { class: 'exd-id mono', title: t('detail.exerciseId') }, id),
      title),
    badges);

  function syncHead() {
    const r = record(ctx, id);
    title.textContent = model.exerciseLabel(r) || t('common.noName');
    const n = (ctx.ds.index.branchRefsByExerciseId.get(id) ?? []).length;
    let usage = h('span', { class: 'badge' }, t('detail.systemExercise'));
    if (id !== model.PAUSE_ID && !ctx.ds.treeNames.length) {
      usage = h('span', { class: 'badge' }, t('detail.treesMissing'));
    } else if (id !== model.PAUSE_ID) {
      usage = n
        ? h('span', { class: 'badge' }, t('detail.usedOn', { count: n }))
        : h('span', { class: 'badge badge--advisory' }, t('detail.notInBranch'));
    }
    badges.replaceChildren(...[
      isNew ? h('span', { class: 'badge badge--info' }, t('detail.newInSession')) : null,
      r.displayName != null && r.displayName !== r.name && r.name ? h('span', { class: 'small muted' }, t('detail.nameBadge', { name: r.name })) : null,
      usage
    ].filter(Boolean));
  }

  const basics = basicSpecs().map((s) => field(ctx, id, s));
  const levelM = field(ctx, id, levelSpec('m'));
  const levelW = field(ctx, id, levelSpec('w'));
  const flags = FLAGS.map(({ key, label, hint }) => field(ctx, id, {
    key, label: t(label), path: [key], kind: 'checkbox', hint: t(hint), show: (r) => r[key] === true
  }));
  const fields = [...basics, levelM, levelW, ...flags];

  const other = otherSideSection(ctx, id, page);
  const tags = tagsSection(ctx, id);
  const matrix = valueMatrix.build(ctx, id);
  const usedIn = usedInSection(ctx, id);
  const facts = factsSection(ctx, id);
  const del = deleteSection(ctx, id);
  const sections = [other, tags, usedIn, facts, del];
  const [nameField, displayField, descriptionField] = basics;

  const main = h('div', { class: 'exd-main' },
    card(t('detail.basics'), h('div', { class: 'exd-basics' },
      nameField.el, displayField.el,
      h('div', { class: 'exd-levels' }, levelM.el, levelW.el),
      descriptionField.el), {
      lead: t('detail.basicsLead', { revert: t('detail.revert') })
    }),
    card(t('detail.behaviour'), h('div', { class: 'exd-flags' }, flags.map((f) => f.el))),
    card(t('detail.otherSide'), other.el, { lead: t('detail.otherSideLead') }),
    card(t('detail.tags'), tags.el),
    card(t('detail.values'), matrix.el, { cls: 'exd-card--values', lead: t('detail.valuesLead') }));

  const aside = h('aside', { class: 'exd-aside' },
    card(t('detail.usedIn'), usedIn.el, { lead: t('detail.usedInLead') }),
    card(t('detail.files'), facts.el, { lead: t('detail.filesLead') }),
    card(t('detail.delete'), del.el, { cls: 'exd-card--danger' }));

  root.append(h('div', { class: 'exd' }, head, h('div', { class: 'exd-layout' }, main, aside)));

  syncHead();
  for (const s of sections) s.sync();

  if (focus === 'name') {
    nameField.input.focus();
    nameField.input.select();
  }

  return {
    update() {
      if (!record(ctx, id)) {
        // `deleteFlow` navigates to `#/exercises`, so skip the not-found render.
        if (location.hash !== exerciseHash(id)) return;
        root.replaceChildren();
        notFound(root, id);
        return;
      }
      syncHead();
      for (const f of fields) f.sync();
      matrix.sync();
      for (const s of sections) s.sync();
    }
  };
}
