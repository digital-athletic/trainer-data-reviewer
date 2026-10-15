// Exercise detail form (#/exercises/<id>).
import * as model from '../core/model.js';
import { parseCellInput } from '../core/schema.js';
import { referencesTo } from '../core/edits.js';
import { confirmDialog, emptyState, fmt, h, messageDialog, notice, openDialog, plural, term, toast, uid } from './dom.js';
import { pickExercise, pickTags } from './pickers.js';
import * as valueMatrix from './value-matrix.js';
import { exerciseHash } from './routes.js';
import { TAG_GROUPS } from './terms.js';

const FLAGS = [
  { key: 'isAdvanceByReps', label: ['Advance by repetitions', 'Steigerung über Wiederholungen'],
    hint: 'The plan raises the repetitions from the start value to the target value. Needs repetition values.' },
  { key: 'isAdvanceByDuration', label: ['Advance by duration', 'Steigerung über Dauer'],
    hint: 'The plan raises the duration from the start value to the target value. Needs duration values.' },
  { key: 'isJump', label: ['Jump exercise', 'Sprungübung'],
    hint: 'Marks the exercise as a jump.' }
];

const record = (ctx, id) => ctx.ds.index.exerciseById.get(id);
const changed = (ctx, rec, path) => valueMatrix.isChanged(ctx.ds, rec, path);
const firstError = (r, fallback = 'This change is not allowed.') => r?.errors?.[0]?.message ?? r?.reason ?? fallback;

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
 * @typedef {{ key: string, label: [string, string], path: string[], kind: 'text' | 'textarea' | 'number' | 'checkbox',
 *   hint?: string, placeholder?: string, show: (rec: Exercise) => string | boolean,
 *   parse?: (text: string, rec: Exercise) => { value?: unknown, error?: string }, warn?: (rec: Exercise) => string }} FieldSpec
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
  const dot = h('span', { class: 'changed-dot', hidden: true, title: 'Changed in this session' });
  const dotText = h('span', { class: 'sr-only', hidden: true }, ' (changed)');
  const revert = h('button', {
    type: 'button', class: 'link-btn small exd-revert', hidden: true, 'data-fkey': `r-${spec.key}`,
    'aria-label': `Revert ${spec.label[0].toLowerCase()} to the loaded value`
  }, 'Revert');
  const hint = spec.hint ? h('p', { class: 'field__hint', id: hintId }, spec.hint) : null;
  const warn = h('p', { class: 'field__warn', id: warnId });
  const error = h('p', { class: 'field__error', id: errId, role: 'alert' });
  let lastShown = null;
  const [en, de] = spec.label;
  const labelTerm = term(en, de !== en ? de : null);

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
        h('label', { class: 'check', for: inputId }, input, labelTerm),
        dot, dotText, h('span', { class: 'spacer' }), revert),
      hint, warn, error)
    : h('div', { class: ['field', 'exd-field', spec.kind === 'number' ? 'exd-field--number' : ''] },
      h('div', { class: 'exd-field__label' },
        h('label', { class: 'field__label', for: inputId }, labelTerm),
        dot, dotText, h('span', { class: 'spacer' }), revert),
      input, hint, warn, error);
  sync(true);
  return { el, sync, input };
}

/** @returns {FieldSpec} */
const levelSpec = (g, hint) => ({
  key: `level-${g}`, label: [`Level ${g}`, `Stufe ${g}`], path: ['level', g], kind: 'number', hint,
  show: (rec) => (rec.level?.[g] != null ? String(rec.level[g]) : ''),
  parse: (text) => {
    const p = parseCellInput(text);
    if (!p.ok || p.value === '') return { error: 'Enter a number such as 2. The level must not be empty.' };
    return { value: p.value };
  },
  warn: (rec) => {
    const v = rec.level?.[g];
    return typeof v === 'number' && (v < 1 || v > 6) ? 'Usually between 1 and 6. Please check this value.' : '';
  }
});

/** @returns {FieldSpec[]} */
const basicSpecs = () => [
  {
    key: 'name', label: ['Name', 'Name'], path: ['name'], kind: 'text',
    hint: 'Internal name from the catalog.',
    show: (rec) => (rec.name == null ? '' : String(rec.name)),
    parse: (text) => (text.trim() === '' ? { error: 'The name must not be empty.' } : { value: text }),
    warn: (rec) => (typeof rec.name === 'string' && rec.name.trim() === '' ? 'This exercise has no name yet. Please enter one.' : '')
  },
  {
    key: 'displayName', label: ['Display name', 'Anzeigename'], path: ['displayName'], kind: 'text',
    hint: 'Shown to athletes. Leave it empty to show the name.',
    show: (rec) => (rec.displayName == null ? '' : String(rec.displayName))
  },
  {
    key: 'description', label: ['Description', 'Beschreibung'], path: ['description'], kind: 'textarea',
    hint: 'Instructions shown to athletes. One step per line.',
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
    h('span', { class: 'mono' }, String(otherId)), ex ? ` ${model.exerciseLabel(ex)}` : ' (missing)');
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
    toast(otherId == null ? 'Other side removed' : `Other side set to ${otherId}${linkBack ? `, and ${otherId} points back` : ''}`);
  }

  async function choose() {
    const rec = record(ctx, id);
    const picked = await pickExercise(ctx, {
      title: `Choose the other side of ${id}`, currentId: rec.otherSideExerciseId,
      allowClear: rec.otherSideExerciseId != null, clearLabel: 'Remove other side'
    });
    if (picked !== undefined) apply(picked, page.linkBack);
  }

  function build() {
    const rec = record(ctx, id);
    const other = rec.otherSideExerciseId;
    const partner = other == null ? undefined : record(ctx, String(other));
    let status = null;
    if (other != null) {
      if (!partner) status = h('span', { class: 'badge badge--blocking' }, `Exercise ${other} does not exist`);
      else if (String(partner.otherSideExerciseId) === id) status = h('span', { class: 'badge badge--success' }, 'Points back to this exercise');
      else status = h('span', { class: 'badge badge--blocking' }, `Does not point back. ${other} points to ${partner.otherSideExerciseId ?? 'nothing'}`);
    }
    const isChanged = changed(ctx, rec, ['otherSideExerciseId']);

    const linkBack = h('input', { type: 'checkbox', checked: page.linkBack, 'data-fkey': 'os-linkback' });
    linkBack.addEventListener('change', () => { page.linkBack = linkBack.checked; });

    const pointing = (ctx.ds.index.otherSideRefsByExerciseId.get(id) ?? []).filter((x) => x !== id && String(x) !== String(other));
    return [
      h('div', { class: 'exd-other' },
        other == null
          ? h('p', { class: 'muted' }, 'No other side. Set one for exercises done with the left and the right side.')
          : h('p', { class: 'exd-other__now' }, exLink(ctx, other, 'os-link')),
        status,
        isChanged ? h('span', { class: 'changed-dot', title: 'Changed in this session' }) : null),
      h('label', { class: 'check' }, linkBack, 'Also update the other exercise so it points back (link back)'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn--small', 'data-fkey': 'os-choose', onclick: choose },
          other == null ? 'Choose other side' : 'Change other side'),
        other != null ? h('button', {
          type: 'button', class: 'btn btn--small btn--ghost', 'data-fkey': 'os-clear', onclick: () => apply(null, page.linkBack)
        }, 'Remove other side') : null,
        partner && String(partner.otherSideExerciseId) !== id
          ? h('button', {
            type: 'button', class: 'btn btn--small', 'data-fkey': 'os-fix', onclick: () => apply(String(other), true)
          }, `Make ${other} point back`) : null,
        isChanged ? h('button', {
          type: 'button', class: 'link-btn small', 'data-fkey': 'os-revert',
          onclick: () => {
            const r = ctx.editor.revertField({ kind: 'exercise', id }, ['otherSideExerciseId']);
            if (!r.ok) error.textContent = firstError(r);
          }
        }, 'Revert') : null),
      pointing.length ? h('p', { class: 'small' }, 'Also named as other side by: ', joinLinks(ctx, pointing)) : null,
      error
    ];
  }

  return { el, sync: () => rebuild(el, build) };
}

function groupTags(tags) {
  const groups = new Map(TAG_GROUPS.map(({ prefix }) => [prefix, []]));
  const other = [];
  for (const t of tags) {
    const p = model.tagPrefix(t);
    if (groups.has(p)) groups.get(p).push(t);
    else other.push(t);
  }
  return { groups, other };
}

function tagsSection(ctx, id) {
  const el = h('div', { class: 'stack stack--tight' });
  const error = h('p', { class: 'field__error', role: 'alert' });
  const isPause = id === model.PAUSE_ID;

  async function edit() {
    const rec = record(ctx, id);
    const res = await pickTags(ctx, { title: `Tags of ${id} ${model.exerciseLabel(rec)}`, kind: 'exercise', current: rec.tags ?? [] });
    if (!res) return;
    const r = ctx.editor.setTags({ kind: 'exercise', id }, res.tags, { confirmedNewTags: res.newTags });
    error.textContent = r.ok ? '' : firstError(r);
  }

  const chip = (t, n) => h('span', { class: ['chip', n > 1 ? 'chip--new' : ''] },
    h('span', { class: 'tag' }, t), n > 1 ? h('span', null, `${n} times`) : null);

  function build() {
    const rec = record(ctx, id);
    const tags = Array.isArray(rec.tags) ? rec.tags : [];
    const counts = new Map();
    for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    const unique = [...counts.keys()];
    const { groups, other } = groupTags(unique);
    const isChanged = changed(ctx, rec, ['tags']);
    const dup = unique.filter((t) => counts.get(t) > 1);

    const list = h('dl', { class: 'exd-tags' },
      TAG_GROUPS.flatMap(({ prefix, en, de }) => {
        const items = groups.get(prefix);
        if (!items.length) return [];
        return [h('dt', null, term(en, de)), h('dd', null, h('div', { class: 'chip-group' }, items.map((t) => chip(t, counts.get(t)))))];
      }),
      other.length ? [h('dt', null, 'Other'), h('dd', null, h('div', { class: 'chip-group' }, other.map((t) => chip(t, 1))))] : null);

    return [
      dup.length ? notice('warning', 'Same tag twice', h('p', null,
        `${dup.join(', ')} ${dup.length === 1 ? 'is' : 'are'} listed more than once. Saving the tags removes the duplicates.`)) : null,
      unique.length ? list : h('p', { class: 'muted' }, 'No tags yet.'),
      isPause
        ? h('p', { class: 'small muted' }, 'Pause is a system exercise. Its tag PAUSE stays as it is.')
        : h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn--small', 'data-fkey': 'tags-edit', onclick: edit }, 'Edit tags'),
          isChanged ? h('span', { class: 'changed-dot', title: 'Changed in this session' }) : null,
          isChanged ? h('button', {
            type: 'button', class: 'link-btn small', 'data-fkey': 'tags-revert',
            onclick: () => {
              const r = ctx.editor.revertField({ kind: 'exercise', id }, ['tags']);
              if (!r.ok) error.textContent = firstError(r);
            }
          }, 'Revert tags') : null),
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
      return h('p', { class: 'muted' }, id === model.PAUSE_ID
        ? 'Pause is added by the training plan, not by the ladders.'
        : 'Used in no branch. Add it to a ladder, delete it, or keep it as reserve content.');
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
        h('span', { class: 'exd-links__main' }, tree, h('span', { class: 'muted' }, ' · branch '), h('span', { class: 'mono' }, branchId)),
        h('span', { class: 'exd-links__meta' }, `${levels.length === 1 ? 'level' : 'levels'} ${levels.toSorted().join(', ')}`)))));
  }
  return { el, sync: () => rebuild(el, build) };
}

function factsSection(ctx, id) {
  const el = h('div');
  const path = (v) => (v ? h('span', { class: 'mono small exd-path' }, v) : h('span', { class: 'muted' }, 'none'));
  function build() {
    const rec = record(ctx, id);
    const rows = [
      ['Picture', 'Bild', path(rec.picture)],
      ['Video', 'Video', path(rec.video)]
    ];
    if (Object.hasOwn(rec, 'conversionFactor')) rows.push(['Conversion factor', 'Umrechnungsfaktor', h('span', { class: 'mono' }, String(rec.conversionFactor))]);
    if (Object.hasOwn(rec, 'equivalentExercises')) {
      const eq = Array.isArray(rec.equivalentExercises) ? rec.equivalentExercises : [];
      rows.push(['Equivalent exercises', 'Gleichwertige Übungen', eq.length ? h('span', null, joinLinks(ctx, eq)) : h('span', { class: 'muted' }, 'none')]);
    }
    return h('dl', { class: 'exd-facts' }, rows.map(([en, de, value]) => [h('dt', null, term(en, de !== en ? de : null)), h('dd', null, value)]));
  }
  return { el, sync: () => rebuild(el, build) };
}

function refLabel(ctx, ref) {
  if (ref.kind === 'branchLevel') {
    return h('span', null, `${ref.tree} · branch ${ref.branchId} · level ${ref.level}`);
  }
  return [h('span', null, 'Other side of '), exLink(ctx, ref.exerciseId)];
}

async function deleteFlow(ctx, id) {
  const refs = referencesTo(ctx.ds, id);
  if (refs.length) {
    const list = h('ul', { class: 'exd-links exd-links--dialog' }, refs.map((r) => h('li', null, refLabel(ctx, r))));
    const dlg = openDialog({
      title: 'This exercise is still in use',
      wide: true,
      body: [
        h('p', null, `Exercise ${id} cannot be deleted while other records point to it. Remove these ${plural(refs.length, 'reference')} first:`),
        list
      ],
      actions: [{ label: 'Close', value: undefined, autofocus: true }]
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
    title: `Delete exercise ${id}?`,
    body: h('div', { class: 'stack stack--tight' },
      h('p', null, h('strong', null, model.exerciseLabel(ex) || '(no name)'), ' is removed from the exercise catalog.'),
      h('p', null, 'Athletes may have trained this exercise. Its id stays reserved and is never given to a new exercise.'),
      h('p', { class: 'small muted' }, 'You can undo this with Undo at the top or Ctrl+Z.')),
    confirmLabel: 'Delete exercise',
    danger: true
  });
  if (!ok) return;
  const r = ctx.editor.deleteExercise(id);
  if (!r.ok) {
    messageDialog({ title: 'The exercise was not deleted', body: firstError(r) });
    return;
  }
  toast(`Exercise ${id} deleted. Its id stays reserved.`);
  ctx.navigate('#/exercises');
}

function deleteSection(ctx, id) {
  const el = h('div', { class: 'stack stack--tight' });
  function build() {
    if (id === model.PAUSE_ID) return h('p', { class: 'small muted' }, 'Pause is a system exercise and cannot be deleted.');
    const refs = referencesTo(ctx.ds, id);
    return [
      h('p', { class: 'small muted' }, refs.length
        ? `In use by ${plural(refs.length, 'reference')}. The app shows them when you try to delete.`
        : 'Not used anywhere. Deleting keeps its id reserved.'),
      h('div', null, h('button', {
        type: 'button', class: 'btn btn--small btn--danger-outline', 'data-fkey': 'delete', onclick: () => deleteFlow(ctx, id)
      }, 'Delete exercise'))
    ];
  }
  return { el, sync: () => rebuild(el, build) };
}

/* ---------- Page ---------- */

const notFound = (root, id) => root.append(emptyState({
  title: `Exercise ${id} is not in the catalog`,
  body: 'It may have been deleted in this session, or the link is out of date.',
  action: h('a', { class: 'btn btn--primary', href: '#/exercises' }, 'Back to all exercises')
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
  const isNew = !valueMatrix.original(ctx.ds, id);
  const title = h('h1', { class: 'page-title exd-title' });
  const badges = h('div', { class: 'row exd-badges' });

  const head = h('header', { class: 'exd-head' },
    h('div', { class: 'row exd-crumbs' },
      h('a', { href: '#/exercises', class: 'exd-back' }, '← All exercises'),
      h('span', { class: 'spacer' }),
      nav?.total ? h('span', { class: 'small muted num' }, `${fmt(nav.position)} of ${fmt(nav.total)} in your list`) : null,
      nav?.prev ? h('a', { class: 'btn btn--small', href: exerciseHash(nav.prev), rel: 'prev' }, 'Previous') : null,
      nav?.next ? h('a', { class: 'btn btn--small', href: exerciseHash(nav.next), rel: 'next' }, 'Next') : null),
    h('div', { class: 'exd-titlebar' },
      h('span', { class: 'exd-id mono', title: 'Exercise id' }, id),
      title),
    badges);

  function syncHead() {
    const r = record(ctx, id);
    title.textContent = model.exerciseLabel(r) || '(no name)';
    const n = (ctx.ds.index.branchRefsByExerciseId.get(id) ?? []).length;
    let usage = h('span', { class: 'badge' }, 'System exercise');
    if (id !== model.PAUSE_ID) {
      usage = n
        ? h('span', { class: 'badge' }, `Used on ${plural(n, 'ladder level')}`)
        : h('span', { class: 'badge badge--advisory' }, 'Not used in any branch');
    }
    badges.replaceChildren(...[
      isNew ? h('span', { class: 'badge badge--info' }, 'New in this session') : null,
      r.displayName != null && r.displayName !== r.name && r.name ? h('span', { class: 'small muted' }, `Name: ${r.name}`) : null,
      usage
    ].filter(Boolean));
  }

  const basics = basicSpecs().map((s) => field(ctx, id, s));
  const levelM = field(ctx, id, levelSpec('m', 'Men. Usually 1 to 6.'));
  const levelW = field(ctx, id, levelSpec('w', 'Women. Usually 1 to 6.'));
  const flags = FLAGS.map(({ key, label, hint }) => field(ctx, id, {
    key, label, path: [key], kind: 'checkbox', hint, show: (r) => r[key] === true
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
    card(term('Basics', 'Grunddaten'), h('div', { class: 'exd-basics' },
      nameField.el, displayField.el,
      h('div', { class: 'exd-levels' }, levelM.el, levelW.el),
      descriptionField.el), {
      lead: 'Changes save when you leave a field. A dot marks a changed field; "Revert" brings back the loaded value.'
    }),
    card(term('Training behaviour', 'Trainingsverhalten'), h('div', { class: 'exd-flags' }, flags.map((f) => f.el))),
    card(term('Other side', 'Andere Seite'), other.el, {
      lead: 'The same exercise for the opposite side. Both exercises should point to each other.'
    }),
    card('Tags', tags.el),
    card(term('Values', 'Werte'), matrix.el, {
      cls: 'exd-card--values',
      lead: 'Start and target value per fitness level and gender. Some empty cells are filled by the intensity settings of the plan, so an empty cell is not always a mistake.'
    }));

  const aside = h('aside', { class: 'exd-aside' },
    card(term('Used in', 'Verwendet in'), usedIn.el, { lead: 'Branches whose ladder uses this exercise.' }),
    card(term('Files and links', 'Dateien'), facts.el, { lead: 'Read only in this app.' }),
    card('Delete', del.el, { cls: 'exd-card--danger' }));

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
        // After a delete the app is already on its way back to the table.
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
