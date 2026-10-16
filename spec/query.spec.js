import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../js/core/model.js';
import * as query from '../js/core/query.js';
import { REAL, loadSample, loadReal } from './helpers.js';

const ds = loadSample();
const rows = query.buildRows(ds);
const facets = query.facetValues(ds);
const ROW_KEYS = ['id', 'label', 'levelM', 'levelW', 'trees', 'branchCount', 'hasVideo', 'hasDescription', 'haystack', 'tagSet'];

test('query: every row carries the Row shape', () => {
  assert.equal(rows.length, 17);
  for (const row of rows) {
    for (const k of ROW_KEYS) assert.ok(k in row, k);
    assert.ok(Array.isArray(row.trees));
    assert.ok(row.tagSet instanceof Set);
  }
  const row15 = rows.find((r) => r.id === '15');
  assert.deepEqual(row15.trees, ['BAS']);
  assert.equal(row15.branchCount, 2);
  const row1 = rows.find((r) => r.id === '1');
  assert.equal(row1.label, 'Shoulder press (1)');
  assert.equal(row1.hasVideo, true);
  assert.equal(row1.hasDescription, true);
});

test('query: the orphan filter returns the unused exercises without Pause', () => {
  assert.deepEqual(query.filter(rows, { usage: 'orphan' }).map((r) => r.id), ['13']);
  assert.equal(query.filter(rows, { usage: 'used' }).length, 17 - 1 - 1);
});

test('query: facets list prefixed tags and the trees', () => {
  assert.deepEqual(facets.tree, ['BAS', 'SKKG', 'SUPPORT']);
  assert.deepEqual(facets.skill, ['SKILL_STABILITY_BODY', 'SKILL_STRENGTH']);
  assert.deepEqual(facets.region, ['REGION_CORE', 'REGION_LOWER_BODY', 'REGION_UPPER_BODY']);
  assert.deepEqual(facets.eq, ['EQ_BARBELL', 'EQ_DUMBBELL']);
  assert.deepEqual(facets.place, ['PLACE_HOME', 'PLACE_STUDIO']);
});

test('query: FACET_PREFIX takes its prefixes from TAG_GROUPS', () => {
  assert.deepEqual(query.FACET_PREFIX, { skill: 'SKILL_', region: 'REGION_', eq: 'EQ_', place: 'PLACE_' });
  const prefixes = model.TAG_GROUPS.map((g) => g.prefix);
  for (const p of Object.values(query.FACET_PREFIX)) assert.ok(prefixes.includes(p), p);
});

test('query: filters combine as AND', () => {
  assert.deepEqual(query.filter(rows, { text: 'squat' }).map((r) => r.id), ['2', '3', '15']);
  assert.deepEqual(query.filter(rows, { text: 'squat level' }).map((r) => r.id), ['2', '3']);
  assert.deepEqual(query.filter(rows, { text: 'squat', tree: 'BAS', eq: 'EQ_BARBELL' }).map((r) => r.id), ['3']);
  const sk = query.filter(rows, { tree: 'SKKG' });
  assert.ok(sk.length > 0 && sk.every((r) => r.trees.includes('SKKG')));
  assert.deepEqual(query.filter(rows, { hasVideo: true }).map((r) => r.id), ['1']);
  const noText = query.filter(rows, { hasDescription: false });
  assert.ok(noText.length > 0);
  assert.ok(noText.every((r) => !r.hasDescription));
  assert.equal(query.filter(rows, {}).length, 17);
  assert.equal(query.filter(rows).length, 17);
});

test('query (real data): the orphan filter returns 436', REAL, () => {
  const real = loadReal();
  const realRows = query.buildRows(real);
  assert.equal(realRows.length, 1210);
  assert.equal(query.filter(realRows, { usage: 'orphan' }).length, 436);
  assert.equal(query.filter(realRows, { usage: 'used' }).length, 1210 - 436 - 1);
  assert.equal(query.facetValues(real).tree.length, 27);
});

// The bound only catches a gross slowdown; a busy CI runner must not fail it.
test('query (real data): five representative criteria filter the right rows in well under a second', REAL, (t) => {
  const real = loadReal();
  const realRows = query.buildRows(real);
  const f = query.facetValues(real);
  // Facet values that combine to a non-empty result on the current data.
  assert.ok(f.skill.includes('SKILL_EXPLOSIVE_POWER') && f.region.includes('REGION_LOWER_BODY'));
  assert.ok(f.eq.includes('EQ_DUMBBELL') && f.place.includes('PLACE_STUDIO'));
  // Each predicate states the criteria on its own, so the expected rows follow from the data.
  const cases = [
    { c: { text: 'kniebeuge' }, ok: (r) => r.haystack.includes('kniebeuge') },
    { c: { text: '1', tree: 'SKKG', usage: 'used' },
      ok: (r) => r.haystack.includes('1') && r.trees.includes('SKKG') && r.branchCount > 0 },
    { c: { skill: 'SKILL_EXPLOSIVE_POWER', region: 'REGION_LOWER_BODY' },
      ok: (r) => r.tagSet.has('SKILL_EXPLOSIVE_POWER') && r.tagSet.has('REGION_LOWER_BODY') },
    { c: { eq: 'EQ_DUMBBELL', place: 'PLACE_STUDIO', hasVideo: true, hasDescription: true },
      ok: (r) => r.tagSet.has('EQ_DUMBBELL') && r.tagSet.has('PLACE_STUDIO') && r.hasVideo && r.hasDescription },
    { c: { text: 'kh schulter', usage: 'orphan', hasVideo: null },
      ok: (r) => r.haystack.includes('kh') && r.haystack.includes('schulter') && r.branchCount === 0 &&
        r.id !== '999999' }
  ];
  for (const { c, ok } of cases) {
    const start = performance.now();
    const out = query.filter(realRows, c);
    const ms = performance.now() - start;
    t.diagnostic(`${JSON.stringify(c)}: ${out.length} rows in ${ms.toFixed(1)} ms`);
    assert.ok(ms < 1000, `${JSON.stringify(c)} took ${ms} ms`);
    assert.ok(out.length > 0, JSON.stringify(c));
    assert.deepEqual(out.map((r) => r.id), realRows.filter(ok).map((r) => r.id), JSON.stringify(c));
  }
});
