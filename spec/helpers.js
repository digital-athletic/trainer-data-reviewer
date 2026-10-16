import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load } from '../js/core/model.js';

export const APP = join(import.meta.dirname, '..');

// Small synthetic data that the repository tracks, with one planted violation.
export const SAMPLE_DIR = join(import.meta.dirname, 'fixtures', 'sample');

// A local copy of the real data folder. The repository never tracks it.
export const REAL_DIR = process.env.CDR_DATA_DIR
  ? resolve(process.env.CDR_DATA_DIR)
  : join(import.meta.dirname, 'fixtures', 'real', 'generator');
export const HAS_REAL = existsSync(join(REAL_DIR, 'Exercises.json'));

/** Test option for specs that need the real data. */
export const REAL = { skip: HAS_REAL ? false : 'real data not present: set CDR_DATA_DIR' };

/** Paths of the data files relative to a data folder. */
export function fixturePaths(dir) {
  const trees = readdirSync(join(dir, 'skillTrees')).filter((f) => f.endsWith('.json')).sort();
  return ['Exercises.json', ...trees.map((f) => `skillTrees/${f}`)];
}

const cache = new Map();

/** @param {string} [dir] @returns {Record<string, string>} a fresh copy of the raw file map */
export function readRaw(dir = SAMPLE_DIR) {
  if (!cache.has(dir)) {
    cache.set(dir, Object.fromEntries(fixturePaths(dir).map((p) => [p, readFileSync(join(dir, p), 'utf8')])));
  }
  return { ...cache.get(dir) };
}

export const loadSample = () => load(readRaw(SAMPLE_DIR));
export const loadReal = () => load(readRaw(REAL_DIR));

/**
 * Installs a Map-backed localStorage for one test. failSet makes setItem throw like a full or blocked storage.
 * @param {import('node:test').TestContext} t @param {{ failSet?: boolean }} [opts]
 */
export function stubStorage(t, { failSet = false } = {}) {
  const items = new Map();
  const storage = {
    items,
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => {
      if (failSet) throw new Error('QuotaExceededError');
      items.set(k, String(v));
    },
    removeItem: (k) => items.delete(k)
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  t.after(() => { delete globalThis.localStorage; });
  return storage;
}

/** Line counts of both texts and the indexes of lines that differ. */
export function differingLines(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const diff = [];
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) diff.push(i);
  return { countA: la.length, countB: lb.length, diff };
}
