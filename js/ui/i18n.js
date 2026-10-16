// UI language: the de and en dictionaries, t() and the language choice. German is the default.
// The choice stays per viewer in localStorage. Core messages carry a code that t() looks up under core.
import { format } from '../core/messages.js';
import { de } from './locale-de.js';
import { en } from './locale-en.js';

export const LANGS = Object.freeze(['de', 'en']);
export const DEFAULT_LANG = 'de';
/** The localStorage key of the language choice. */
export const STORAGE_KEY = 'cdr.lang';
export const DICTIONARIES = Object.freeze({ de, en });
const LOCALES = Object.freeze({ de: 'de-DE', en: 'en-US' });

/** The stored language, or German when storage is empty, broken or blocked. @returns {'de' | 'en'} */
export function storedLang() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return LANGS.includes(v) ? v : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

let current = storedLang();
/** @type {(() => void)[]} */
const listeners = [];

/** @returns {'de' | 'en'} */
export const lang = () => current;
/** The BCP 47 locale for number and date formats. */
export const locale = () => LOCALES[current];

function lookup(dict, key) {
  let node = dict;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** True when the current dictionary holds key. @param {string} key */
export const has = (key) => lookup(DICTIONARIES[current], key) !== undefined;

/**
 * The text for key in the current language with {name} placeholders filled from params.
 * A number params.count picks key_one or key_other first. A missing key falls back to German, then to the key.
 * @param {string} key @param {Record<string, unknown>} [params] @returns {string}
 */
export function t(key, params = {}) {
  const dict = DICTIONARIES[current];
  let text;
  if (typeof params.count === 'number') text = lookup(dict, `${key}_${params.count === 1 ? 'one' : 'other'}`);
  text ??= lookup(dict, key) ?? lookup(DICTIONARIES[DEFAULT_LANG], key) ?? key;
  return format(text, params, locale());
}

/** A number in the format of the current language. @param {number} n @returns {string} */
export const fmt = (n) => n.toLocaleString(locale());

/**
 * The text of a core message, error or plain string in the current language.
 * @param {{ code?: string, params?: Record<string, unknown>, message?: string } | string | null | undefined} m
 * @returns {string}
 */
export function coreText(m) {
  if (m == null) return '';
  if (typeof m === 'string') return m;
  if (m.code && has(`core.${m.code}`)) return t(`core.${m.code}`, m.params ?? {});
  return m.message ?? String(m);
}

/** Sets the lang attribute of the page and fills the [data-i18n] texts of index.html. @param {ParentNode} [root] */
export function applyStatic(root = document) {
  document.documentElement.lang = current;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
}

/** Switches the language, stores the choice and calls the listeners. @param {string} next */
export function setLang(next) {
  if (!LANGS.includes(next) || next === current) return;
  current = /** @type {'de' | 'en'} */ (next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage is unavailable, so the choice lasts until the page reloads.
  }
  for (const fn of [...listeners]) fn();
}

/** Calls fn after every language switch. @param {() => void} fn */
export function onLangChange(fn) {
  listeners.push(fn);
}
