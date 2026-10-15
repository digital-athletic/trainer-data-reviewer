import { isObject } from './model.js';
import { parseValue } from './review.js';

/**
 * One JSON file holds the current work: the editor's command log and the review marks.
 * The app keeps a copy in localStorage and offers it as a download.
 *
 * @typedef {import('./edits.js').Command} Command
 * @typedef {import('./review.js').ReviewStatus} ReviewStatus
 * @typedef {{ commands: Command[], review: ReviewStatus, fingerprint: string | null, savedAt?: string }} WorkInput
 * @typedef {{ commands: Command[], review: ReviewStatus, fingerprint: string | null, savedAt: string }} Work
 * @typedef {{ ok: true, value: Work, warnings: string[] } | { ok: false, message: string }} WorkParseResult
 */

export const KIND = 'coach-data-review-work';
export const VERSION = 1;
export const FILE_PREFIX = 'coach-review-work';
/** The app refuses a work file above this size in bytes. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_COMMANDS = 50_000;

const BAD_FILE = 'This file is not a work file of the coach data reviewer. Please pick a coach-review-work file the app saved.';
const NEWER_FILE = 'This work file comes from a newer version of the app. Please update the app and try again.';
const TOO_MANY = `This work file holds more than ${MAX_COMMANDS.toLocaleString('en')} changes. The app does not open it.`;
const MAX_DEPTH = 32;

// Plain JSON values only: null, booleans, finite numbers, text, lists and plain objects, nested at most MAX_DEPTH deep.
function isJsonSafe(v, depth = 0) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (depth >= MAX_DEPTH || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.every((x) => isJsonSafe(x, depth + 1));
  return Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every((x) => isJsonSafe(x, depth + 1));
}

const isCommand = (c) => isObject(c) && typeof c.method === 'string' && Array.isArray(c.args) &&
  c.args.every((a) => isJsonSafe(a));

/** @param {Date} [date] @returns {string} */
export const fileName = (date = new Date()) => `${FILE_PREFIX}-${date.toISOString().slice(0, 10)}.json`;

/** @param {WorkInput} work @returns {string} */
export function serialize({ commands, review, fingerprint, savedAt = new Date().toISOString() }) {
  const file = {
    kind: KIND,
    version: VERSION,
    savedAt,
    fingerprint: fingerprint ?? null,
    commands: structuredClone(commands ?? []),
    review: structuredClone(review)
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** @param {string} text @returns {WorkParseResult} */
export function parse(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: BAD_FILE };
  }
  if (!isObject(data)) return { ok: false, message: BAD_FILE };

  if (data.kind !== KIND || !Number.isInteger(data.version)) return { ok: false, message: BAD_FILE };
  if (data.version > VERSION) return { ok: false, message: NEWER_FILE };
  if (data.version !== VERSION || !Array.isArray(data.commands)) return { ok: false, message: BAD_FILE };
  if (data.commands.length > MAX_COMMANDS) return { ok: false, message: TOO_MANY };
  const review = parseValue(data.review);
  if (!review.ok) return { ok: false, message: BAD_FILE };

  const commands = data.commands.filter(isCommand);
  const warnings = [...review.warnings];
  const skipped = data.commands.length - commands.length;
  if (skipped) warnings.push(`Skipped ${skipped} unreadable change(s).`);
  const value = {
    commands,
    review: review.status,
    fingerprint: typeof data.fingerprint === 'string' ? data.fingerprint : null,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : ''
  };
  return { ok: true, value, warnings };
}
