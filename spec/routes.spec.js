import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseHash, parseRoute } from '../js/ui/routes.js';

test('routes: parseRoute reads the exercises table and an exercise id', () => {
  assert.deepEqual(parseRoute('#/exercises'), { name: 'exercises', params: { id: undefined } });
  assert.deepEqual(parseRoute('#exercises/'), { name: 'exercises', params: { id: undefined } });
  assert.deepEqual(parseRoute('#/exercises/429'), { name: 'exercises', params: { id: '429' } });
});

test('routes: parseRoute reverses exerciseHash and keeps a broken escape as it is', () => {
  assert.deepEqual(parseRoute(exerciseHash('a b')), { name: 'exercises', params: { id: 'a b' } });
  assert.deepEqual(parseRoute('#/exercises/%E0'), { name: 'exercises', params: { id: '%E0' } });
});

test('routes: parseRoute returns null for a hash that names no screen', () => {
  for (const hash of ['', '#', '#/', '#/skill-trees', null, undefined]) assert.equal(parseRoute(hash), null, String(hash));
});
