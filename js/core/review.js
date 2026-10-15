import { isObject, stats } from './model.js';

/**
 * The review part of the work file. This version sets no review marks. It keeps the
 * marks of a work file from a newer version as they are, so saving does not lose them.
 * @typedef {import('./model.js').Dataset} Dataset
 * @typedef {{ version: 1, savedAt: string, datasetCounts: { exercises: number, branches: number },
 *   branches: Record<string, unknown>, issues: Record<string, unknown> }} ReviewStatus
 * @typedef {{ ok: true, status: ReviewStatus, warnings: string[] } | { ok: false, message: string }} ParseResult
 */

const BAD_FILE = 'This file is not a review progress file (review-status.json). Please pick the review-status.json the app saved.';

const now = () => new Date().toISOString();

/** @param {Dataset} ds @returns {ReviewStatus} */
export function create(ds) {
  const { exercises, branches } = stats(ds);
  return { version: 1, savedAt: now(), datasetCounts: { exercises, branches }, branches: {}, issues: {} };
}

/** Validates an already parsed review status. @param {unknown} data @returns {ParseResult} */
export function parseValue(data) {
  if (!isObject(data) || data.version !== 1 || !isObject(data.branches) || !isObject(data.issues)) {
    return { ok: false, message: BAD_FILE };
  }
  const warnings = [];
  const counts = data.datasetCounts;
  /** @type {ReviewStatus} */
  const status = {
    version: 1,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : '',
    datasetCounts: isObject(counts) ? { exercises: counts.exercises, branches: counts.branches } : { exercises: 0, branches: 0 },
    branches: structuredClone(data.branches),
    issues: structuredClone(data.issues)
  };
  return { ok: true, status, warnings };
}
