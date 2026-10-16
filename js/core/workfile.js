import { msg } from './messages.js';
import { isObject, localDate } from './model.js';
import { parseValue } from './review.js';

/**
 * One JSON file holds the current work: the editor's command log and the review marks.
 * The app keeps a copy in localStorage and offers it as a download.
 *
 * @typedef {import('./edits.js').Command} Command
 * @typedef {import('./review.js').ReviewStatus} ReviewStatus
 * @typedef {{ commands: Command[], review: ReviewStatus, fingerprint: string | null, savedAt?: string }} WorkInput
 * @typedef {{ commands: Command[], review: ReviewStatus, fingerprint: string | null, savedAt: string }} Work
 * @typedef {import('./messages.js').Message} Message
 * @typedef {{ ok: true, value: Work, warnings: Message[] } | ({ ok: false } & Message)} WorkParseResult
 */

export const KIND = 'coach-data-review-work';
const VERSION = 1;
const FILE_PREFIX = 'coach-review-work';
/** The app refuses a work file above this size in bytes. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_COMMANDS = 50_000;

const BAD_FILE = { ok: false, ...msg('notWorkFile') };
const NEWER_FILE = { ok: false, ...msg('newerWorkFile') };
const TOO_MANY = { ok: false, ...msg('tooManyCommands', { max: MAX_COMMANDS }) };
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
export const fileName = (date = new Date()) => `${FILE_PREFIX}-${localDate(date)}.json`;

/** @param {WorkInput} work @returns {string} */
export function serialize({ commands, review, fingerprint, savedAt = new Date().toISOString() }) {
  const file = { kind: KIND, version: VERSION, savedAt, fingerprint: fingerprint ?? null, commands: commands ?? [], review };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** @param {string} text @returns {WorkParseResult} */
export function parse(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ...BAD_FILE };
  }
  if (!isObject(data)) return { ...BAD_FILE };

  if (data.kind !== KIND || !Number.isInteger(data.version)) return { ...BAD_FILE };
  if (data.version > VERSION) return { ...NEWER_FILE };
  if (data.version !== VERSION || !Array.isArray(data.commands)) return { ...BAD_FILE };
  if (data.commands.length > MAX_COMMANDS) return { ...TOO_MANY };
  const review = parseValue(data.review);
  if (!review.ok) return { ...BAD_FILE };

  const commands = data.commands.filter(isCommand);
  const warnings = [];
  const skipped = data.commands.length - commands.length;
  if (skipped) warnings.push(msg('skippedCommands', { count: skipped }));
  const value = {
    commands,
    review: review.status,
    fingerprint: typeof data.fingerprint === 'string' ? data.fingerprint : null,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : ''
  };
  return { ok: true, value, warnings };
}
