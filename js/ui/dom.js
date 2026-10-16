// DOM helpers shared by all screens. Strings always become text nodes, so data never reaches innerHTML.
import { fmt, t } from './i18n.js';

export { fmt };

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

/** A unique DOM id. @param {string} [prefix] @returns {string} */
export const uid = (prefix = 'cdr') => `${prefix}-${crypto.randomUUID()}`;

const NON_TEXT_INPUTS = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'];

/** True when the element takes typed text. @param {Element | null} el @returns {boolean} */
export function isTyping(el) {
  if (!el || el === document.body) return false;
  const { tagName } = el;
  if (tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  if (tagName === 'INPUT') return !NON_TEXT_INPUTS.includes((el.type || 'text').toLowerCase());
  return el.isContentEditable === true;
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
 *   cancelable?: boolean, onOpen?: (dialog: HTMLDialogElement, close: (value?: unknown) => void) => void }} DialogOptions
 *   With cancelable false, Esc does nothing and only an action closes the dialog.
 */

/** Modal on a native dialog. Esc cancels, focus returns to the opener, result resolves with the action value. */
export class Dialog {
  #opener = document.activeElement;
  #settled = false;
  #resolve = () => {};

  /** @param {DialogOptions} opts */
  constructor({ title, body, actions = [], wide = false, closeOnBackdrop = true, cancelable = true, onOpen }) {
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
      if (cancelable) this.close(undefined);
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

const asBody = (body) => (typeof body === 'string' ? h('p', null, body) : body);

/**
 * @param {{ title: string, body: Child, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export async function confirmDialog({ title, body, confirmLabel = t('common.ok'), cancelLabel = t('common.cancel'), danger = false }) {
  const value = await new Dialog({
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
export const messageDialog = ({ title, body, wide = false, okLabel = t('common.ok') }) =>
  new Dialog({ title, body: asBody(body), wide, actions: [{ label: okLabel, value: true, primary: true, autofocus: true }] }).result;

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
  constructor(container, items, renderItem, { pageSize = 50, label = t('pager.label') } = {}) {
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
        h('span', { class: 'num' }, t('pager.showing', { start: start + 1, end, total: items.length })),
        h('div', { class: 'pager__buttons' },
          h('button', { type: 'button', class: 'btn btn--small', disabled: page === 0, onclick: () => this.goTo(page - 1, true) }, t('pager.previous')),
          h('span', { class: 'num' }, t('pager.page', { page: page + 1, pages: this.#pages })),
          h('button', { type: 'button', class: 'btn btn--small', disabled: page >= this.#pages - 1, onclick: () => this.goTo(page + 1, true) }, t('pager.next'))));
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
