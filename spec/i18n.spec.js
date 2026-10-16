import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MESSAGES, msg } from '../js/core/messages.js';
import * as i18n from '../js/ui/i18n.js';
import { APP, stubStorage } from './helpers.js';

const UI = join(APP, 'js', 'ui');
// These files hold the dictionaries and the lookup, so they may hold any text.
const TEXT_FILES = new Set(['i18n.js', 'locale-de.js', 'locale-en.js']);

/** Every leaf of a nested dictionary as "a.b.c" to its text. */
function flatten(node, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else flatten(value, path, out);
  }
  return out;
}

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Runs fn with the language set to lang and puts German back afterwards. */
function inLang(t, lang, fn) {
  stubStorage(t);
  i18n.setLang(lang);
  try {
    return fn();
  } finally {
    i18n.setLang('de');
  }
}

test('i18n: every key exists in both dictionaries with the same placeholders', () => {
  const de = flatten(i18n.DICTIONARIES.de);
  const en = flatten(i18n.DICTIONARIES.en);
  assert.deepEqual([...de.keys()].filter((k) => !en.has(k)), [], 'keys only in de');
  assert.deepEqual([...en.keys()].filter((k) => !de.has(k)), [], 'keys only in en');
  for (const [key, text] of de) {
    assert.notEqual(text.trim(), '', `de ${key} is empty`);
    assert.deepEqual(placeholders(text), placeholders(en.get(key)), `placeholders of ${key}`);
  }
});

test('i18n: every core message has a German text', () => {
  const de = flatten(i18n.DICTIONARIES.de);
  for (const code of Object.keys(MESSAGES)) assert.ok(de.has(`core.${code}`), code);
});

test('i18n: the default language is German', (t) => {
  assert.equal(i18n.DEFAULT_LANG, 'de');
  assert.equal(i18n.lang(), 'de');
  const storage = stubStorage(t);
  assert.equal(i18n.storedLang(), 'de', 'empty storage');
  storage.items.set(i18n.STORAGE_KEY, 'fr');
  assert.equal(i18n.storedLang(), 'de', 'an unknown language');
  storage.items.set(i18n.STORAGE_KEY, 'en');
  assert.equal(i18n.storedLang(), 'en');
  delete globalThis.localStorage;
  assert.equal(i18n.storedLang(), 'de', 'no storage at all');
});

test('i18n: t substitutes params, picks the plural form and formats numbers', () => {
  assert.equal(i18n.t('exl.added', { id: '1234' }), 'Übung 1234 hinzugefügt. Geben Sie ihr einen Namen und Werte.');
  assert.equal(i18n.t('count.change', { count: 1 }), '1 Änderung');
  assert.equal(i18n.t('count.change', { count: 1210 }), '1.210 Änderungen');
  assert.equal(i18n.t('exl.chip', { label: 'Region' }), 'Region: {value}', 'a missing param stays visible');
  assert.equal(i18n.t('no.such.key'), 'no.such.key');
});

test('i18n: setLang switches, stores the choice per viewer and calls the listeners', (t) => {
  const storage = stubStorage(t);
  let calls = 0;
  i18n.onLangChange(() => { calls++; });
  i18n.setLang('en');
  assert.equal(i18n.lang(), 'en');
  assert.equal(storage.items.get(i18n.STORAGE_KEY), 'en');
  assert.equal(i18n.t('count.change', { count: 1210 }), '1,210 changes');
  i18n.setLang('xx');
  assert.equal(i18n.lang(), 'en', 'an unknown language changes nothing');
  i18n.setLang('de');
  assert.equal(storage.items.get(i18n.STORAGE_KEY), 'de');
  assert.equal(calls, 2);
});

test('i18n: setLang works when the browser refuses to store', (t) => {
  stubStorage(t, { failSet: true });
  i18n.setLang('en');
  assert.equal(i18n.lang(), 'en');
  i18n.setLang('de');
  assert.equal(i18n.lang(), 'de');
});

test('i18n: coreText shows a core message in the current language', (t) => {
  const m = msg('exerciseMissing', { id: '42' });
  assert.equal(m.message, 'Exercise 42 does not exist.');
  assert.equal(i18n.coreText(m), 'Übung 42 gibt es nicht.');
  assert.equal(inLang(t, 'en', () => i18n.coreText(m)), 'Exercise 42 does not exist.');
  assert.equal(i18n.coreText(new Error('locked')), 'locked', 'a browser error keeps its text');
  assert.equal(i18n.coreText({ code: 'unknown', message: 'Plain' }), 'Plain');
  assert.equal(i18n.coreText(msg('tooManyCommands', { max: 50_000 })), 'Diese Arbeitsdatei enthält mehr als 50.000 Änderungen. Die App öffnet sie nicht.');
});

test('i18n: every data-i18n key in index.html exists', () => {
  const html = readFileSync(join(APP, 'index.html'), 'utf8');
  assert.match(html, /<html lang="de">/);
  const keys = [...html.matchAll(/data-i18n(?:-title|-label)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 5);
  const de = flatten(i18n.DICTIONARIES.de);
  for (const key of keys) assert.ok(de.has(key), key);
});

// Single words that the code compares with, for example KeyboardEvent.key values.
const CODE_WORDS = new Set(['Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']);
// A capitalised word followed by a lower-case word, as in "Choose another file".
const PROSE = /[A-Z][a-z]+ [a-z]+/;

test('i18n: no hard-coded English text is left in js/ui', () => {
  const found = [];
  for (const name of readdirSync(UI).filter((f) => f.endsWith('.js') && !TEXT_FILES.has(f))) {
    const code = readFileSync(join(UI, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const [, single, template] of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
      const text = single ?? template.replace(/\$\{[^}]*\}/g, ' ');
      if (CODE_WORDS.has(text)) continue;
      if (PROSE.test(text) || /^[A-Z][a-z]{2,}$/.test(text)) found.push(`${name}: ${text}`);
    }
  }
  assert.deepEqual(found, []);
});
