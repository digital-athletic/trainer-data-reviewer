import test from 'node:test';
import assert from 'node:assert/strict';
import * as review from '../js/core/review.js';
import { loadSample } from './helpers.js';

const ds = loadSample();

test('review: create starts an empty review part with the dataset counts', () => {
  const status = review.create(ds);
  assert.equal(status.version, 1);
  assert.deepEqual(status.datasetCounts, { exercises: 17, branches: 9 });
  assert.deepEqual(status.branches, {});
  assert.deepEqual(status.issues, {});
});

test('review: parseValue keeps the marks of a newer work file as they are', () => {
  const status = review.create(ds);
  status.branches['SKKG/253'] = { status: 'reviewed', comment: 'ok', date: '2026-10-15T10:00:00.000Z' };
  status.issues['orphan:exercise:13'] = { status: 'accepted', comment: '', date: '' };
  const r = review.parseValue(structuredClone(status));
  assert.equal(r.ok, true);
  assert.deepEqual(r.status.branches, status.branches);
  assert.deepEqual(r.status.issues, status.issues);
});

test('review: parseValue refuses a value that is not a review part', () => {
  for (const data of [null, [], { version: 2, branches: {}, issues: {} }, { version: 1, branches: {} }]) {
    assert.deepEqual(review.parseValue(data), { ok: false });
  }
});
