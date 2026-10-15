// DOM helpers shared by all screens. Strings always become text nodes, so data never reaches innerHTML.

const BOOLEAN_ATTRS = new Set(['disabled', 'checked', 'hidden', 'readonly', 'required', 'selected', 'multiple', 'open', 'autofocus']);

/** @typedef {Node | string | number | null | undefined | boolean | Child[]} Child */

const appendChildren = (el, children) => {
  for (const c of children) {
    if (c == null || typeof c === 'boolean') continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
};

/**
 * Builds an element. attrs keys: class (string or list), style (object), dataset, on<event>, text, value, for,
 * boolean attributes, anything else as attribute.
 * @param {string} tag @param {Record<string, unknown> | null} [attrs] @param {...Child} children @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (key === 'class' || key === 'className') {
      el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    } else if (key === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith('--')) el.style.setProperty(p, val);
        else el.style[p] = val;
      }
    } else if (key === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (key.startsWith('on') && typeof v === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), v);
    } else if (key === 'text') {
      el.textContent = v;
    } else if (key === 'value') {
      el.value = v;
    } else if (key === 'for') {
      el.htmlFor = v;
    } else if (BOOLEAN_ATTRS.has(key)) {
      el[key] = true;
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, v === true ? '' : String(v));
    }
  }
  appendChildren(el, children);
  return el;
}

const numberFormat = new Intl.NumberFormat('en-US');

/** @param {number} n @returns {string} */
export const fmt = (n) => numberFormat.format(n);

/** @param {number} n @param {string} one @param {string} [many] @returns {string} */
export const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

/** A unique DOM id. @param {string} [prefix] @returns {string} */
export const uid = (prefix = 'cdr') => `${prefix}-${crypto.randomUUID()}`;

/** English domain term with the German glossary term as a grey hint. @param {string} en @param {string | null} [de] */
export const term = (en, de) => h('span', { class: 'term' }, en, de ? h('span', { class: 'term__de', lang: 'de' }, de) : null);

const NON_TEXT_INPUTS = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'];

/** True when the element takes typed text. @param {Element | null} el @returns {boolean} */
export function isTyping(el) {
  if (!el || el === document.body) return false;
  const { tagName } = el;
  if (tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  if (tagName === 'INPUT') return !NON_TEXT_INPUTS.includes((el.type || 'text').toLowerCase());
  return el.isContentEditable === true;
}

/** Progress bar with a label and a "done of total" count. */
export class ProgressBar {
  #fill = h('div', { class: 'progress__fill' });
  #track;
  #count = h('span', { class: 'num' });
  #unit;

  /** @param {{ label?: string, unit?: string, small?: boolean, done?: number, total?: number }} [opts] */
  constructor({ label = '', unit = '', small = false, done = 0, total = 0 } = {}) {
    this.#unit = unit;
    this.#track = h('div', { class: 'progress__track', role: 'progressbar', 'aria-valuemin': '0', 'aria-label': label || null }, this.#fill);
    this.el = h('div', { class: ['progress', small ? 'progress--small' : ''] },
      h('div', { class: 'progress__label' }, h('strong', null, label), this.#count),
      this.#track);
    this.update({ done, total });
  }

  /** @param {{ done?: number, total?: number }} value */
  update({ done = 0, total = 0 }) {
    const share = total > 0 ? done / total : 0;
    this.#fill.style.width = `${share * 100}%`;
    this.#track.setAttribute('aria-valuemax', String(total));
    this.#track.setAttribute('aria-valuenow', String(done));
    const text = `${fmt(done)} of ${fmt(total)}${this.#unit ? ` ${this.#unit}` : ''} · ${Math.round(share * 100)}%`;
    this.#track.setAttribute('aria-valuetext', text);
    this.#count.textContent = text;
    this.el.classList.toggle('is-complete', total > 0 && done >= total);
  }
}

/** @param {{ title: string, body?: string, action?: Node | null }} opts */
export const emptyState = ({ title, body, action }) =>
  h('div', { class: 'empty' },
    h('h2', { class: 'empty__title' }, title),
    body ? h('p', { class: 'empty__body' }, body) : null,
    action ?? null);

/** @param {'info' | 'success' | 'warning' | 'error'} tone @param {string | null} title @param {Child} [body] */
export const notice = (tone, title, body) =>
  h('div', { class: `notice notice--${tone}`, role: tone === 'error' ? 'alert' : null },
    title ? h('strong', null, title) : null,
    body ?? null);

/**
 * @typedef {{ label?: string, value?: unknown, primary?: boolean, danger?: boolean, ghost?: boolean,
 *   autofocus?: boolean, spacer?: boolean, onClick?: (close: (value?: unknown) => void) => void }} DialogAction
 * @typedef {{ title: string, body?: Child, actions?: DialogAction[], wide?: boolean, closeOnBackdrop?: boolean,
 *   onOpen?: (dialog: HTMLDialogElement, close: (value?: unknown) => void) => void }} DialogOptions
 */

/** Modal on a native dialog. Esc cancels, focus returns to the opener, result resolves with the action value. */
export class Dialog {
  #opener = document.activeElement;
  #settled = false;
  #resolve = () => {};

  /** @param {DialogOptions} opts */
  constructor({ title, body, actions = [], wide = false, closeOnBackdrop = true, onOpen }) {
    const titleId = uid('dlg-title');
    this.body = h('div', { class: 'dialog__body' }, body);
    const foot = h('div', { class: 'dialog__foot' });
    this.dialog = /** @type {HTMLDialogElement} */ (h('dialog', { class: ['dialog', wide ? 'dialog--wide' : ''], 'aria-labelledby': titleId },
      h('div', { class: 'dialog__head' }, h('h2', { id: titleId }, title)),
      this.body,
      foot));
    /** @type {Promise<unknown>} */
    this.result = new Promise((resolve) => { this.#resolve = resolve; });

    for (const a of actions) {
      if (a.spacer) {
        foot.append(h('span', { class: 'spacer' }));
        continue;
      }
      foot.append(h('button', {
        type: 'button',
        class: ['btn', a.primary ? 'btn--primary' : '', a.danger ? 'btn--danger' : '', a.ghost ? 'btn--ghost' : ''],
        'data-autofocus': a.autofocus ? '1' : null,
        onclick: () => (a.onClick ? a.onClick((v) => this.close(v)) : this.close(a.value))
      }, a.label));
    }
    if (!foot.firstChild) foot.remove();

    const { dialog } = this;
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.close(undefined);
    });
    // Chrome may close a dialog without a cancellable event (repeated Esc).
    dialog.addEventListener('close', () => this.close(undefined));
    dialog.addEventListener('mousedown', (e) => {
      if (e.target !== dialog || !closeOnBackdrop) return;
      const r = dialog.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) this.close(undefined);
    });

    document.body.append(dialog);
    dialog.showModal();
    /** @type {HTMLElement | null} */ (dialog.querySelector('[data-autofocus]') ?? dialog.querySelector('[autofocus]'))?.focus();
    onOpen?.(dialog, (v) => this.close(v));
  }

  /** @param {unknown} [value] */
  close(value) {
    if (this.#settled) return;
    this.#settled = true;
    if (this.dialog.open) this.dialog.close();
    this.dialog.remove();
    const opener = this.#opener;
    if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    this.#resolve(value);
  }
}

/** @param {DialogOptions} opts @returns {Dialog} */
export const openDialog = (opts) => new Dialog(opts);

const asBody = (body) => (typeof body === 'string' ? h('p', null, body) : body);

/**
 * @param {{ title: string, body: Child, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export async function confirmDialog({ title, body, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  const value = await openDialog({
    title,
    body: asBody(body),
    actions: [
      { label: cancelLabel, value: false, autofocus: danger },
      { label: confirmLabel, value: true, primary: !danger, danger, autofocus: !danger }
    ]
  }).result;
  return value === true;
}

/** @param {{ title: string, body: Child, wide?: boolean, okLabel?: string }} opts @returns {Promise<unknown>} */
export const messageDialog = ({ title, body, wide = false, okLabel = 'OK' }) =>
  openDialog({ title, body: asBody(body), wide, actions: [{ label: okLabel, value: true, primary: true, autofocus: true }] }).result;

/** @param {number} ms @returns {Promise<void>} */
export const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** @param {string} text @param {{ tone?: 'error', ms?: number }} [opts] */
export function toast(text, { tone, ms = 3800 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h('div', { class: ['toast', tone === 'error' ? 'toast--error' : ''] }, text);
  host.append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/**
 * Calls fn once input has paused for ms. An aborted signal cancels a pending call.
 * @template {unknown[]} A @param {(...args: A) => void} fn @param {number} ms @param {AbortSignal} [signal]
 * @returns {(...args: A) => void}
 */
export function debounce(fn, ms, signal) {
  let timer;
  signal?.addEventListener('abort', () => clearTimeout(timer));
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function pagerHost(container) {
  if (['TBODY', 'THEAD', 'TR'].includes(container.tagName)) {
    const table = container.closest('table');
    return table?.closest('.table-wrap') ?? table ?? container;
  }
  return container;
}

/** Renders one page of items into a container, with Previous and Next controls after it. */
export class Pager {
  #container;
  #renderItem;
  #pageSize;
  /** @type {unknown[]} */
  #items;
  #page = 0;

  /**
   * @param {HTMLElement} container @param {unknown[]} items @param {(item: unknown, index: number) => Node | null} renderItem
   * @param {{ pageSize?: number, label?: string }} [opts]
   */
  constructor(container, items, renderItem, { pageSize = 50, label = 'Pages' } = {}) {
    this.#container = container;
    this.#renderItem = renderItem;
    this.#pageSize = pageSize;
    this.#items = items ?? [];
    this.nav = h('nav', { class: 'pager', 'aria-label': label });
    pagerHost(container).after(this.nav);
    this.#render(false);
  }

  get page() {
    return this.#page;
  }

  get #pages() {
    return Math.max(1, Math.ceil(this.#items.length / this.#pageSize));
  }

  /** @param {number} p @param {boolean} [scroll] */
  goTo(p, scroll = false) {
    this.#page = Math.min(Math.max(0, p), this.#pages - 1);
    this.#render(scroll);
  }

  /** @param {number} index */
  goToItem(index) {
    this.goTo(Math.floor(index / this.#pageSize));
  }

  /** @param {unknown[]} items @param {boolean} [keepPage] */
  update(items, keepPage = false) {
    this.#items = items ?? [];
    if (!keepPage) this.#page = 0;
    this.goTo(this.#page);
  }

  destroy() {
    this.nav.remove();
  }

  #render(scroll) {
    const items = this.#items;
    const start = this.#page * this.#pageSize;
    const end = Math.min(items.length, start + this.#pageSize);
    this.#container.replaceChildren(...items.slice(start, end).flatMap((item, i) => this.#renderItem(item, start + i) ?? []));
    this.nav.hidden = items.length <= this.#pageSize;
    this.nav.replaceChildren();
    if (!this.nav.hidden) {
      const page = this.#page;
      this.nav.append(
        h('span', { class: 'num' }, `Showing ${fmt(start + 1)} to ${fmt(end)} of ${fmt(items.length)}`),
        h('div', { class: 'pager__buttons' },
          h('button', { type: 'button', class: 'btn btn--small', disabled: page === 0, onclick: () => this.goTo(page - 1, true) }, 'Previous'),
          h('span', { class: 'num' }, `Page ${page + 1} of ${this.#pages}`),
          h('button', { type: 'button', class: 'btn btn--small', disabled: page >= this.#pages - 1, onclick: () => this.goTo(page + 1, true) }, 'Next')));
    }
    if (scroll) {
      const host = pagerHost(this.#container);
      const { top } = host.getBoundingClientRect();
      if (top < 0 || top > window.innerHeight) host.scrollIntoView({ block: 'start' });
    }
  }
}

/** Saves text as a file in the downloads folder. @param {string} fileName @param {string} text @param {string} [mime] */
export function download(fileName, text, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: fileName, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** @param {string} text @returns {Promise<boolean>} */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Brief yellow flash on a record the user jumped to. @param {Element | null} el */
export function highlight(el) {
  if (!el) return;
  el.classList.remove('is-highlight');
  // Reading the width restarts the CSS animation.
  el.getBoundingClientRect();
  el.classList.add('is-highlight');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/** Local date as YYYY-MM-DD. @param {Date} [d] @returns {string} */
export const isoDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
