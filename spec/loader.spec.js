import test from 'node:test';
import assert from 'node:assert/strict';
import * as loader from '../js/core/loader.js';
import { REAL, REAL_DIR, SAMPLE_DIR, fixturePaths, readRaw } from './helpers.js';

const pick = loader.pickDataFiles;
const entries = (paths) => paths.map((relativePath) => ({ relativePath }));

// Builds browser-like File objects for the files of a data folder, as a folder pick yields them.
function fileList(dir, folder) {
  const raw = readRaw(dir);
  const files = fixturePaths(dir).map((p) => ({
    name: p.split('/').at(-1),
    webkitRelativePath: `${folder}/${p}`,
    text: async () => raw[p]
  }));
  const extra = { name: 'notes.ts', webkitRelativePath: `${folder}/regions/notes.ts`, text: async () => '' };
  return [...files, extra];
}

test('loader: accepts a renamed generator folder', () => {
  const r = pick(entries([
    'my-data/Exercises.json',
    'my-data/TestIntensity.json',
    'my-data/skillTrees/SK.json',
    'my-data/skillTrees/SKKG.json',
    'my-data/intensity/SK.ts',
    'my-data/skillTrees/nested/X.json'
  ]));
  assert.equal(r.error, undefined);
  assert.equal(r.exercises, 'my-data/Exercises.json');
  assert.deepEqual(r.trees, ['my-data/skillTrees/SK.json', 'my-data/skillTrees/SKKG.json']);
  assert.equal(r.ignored, 3);
});

test('loader: accepts athlete-mobile/assets/data/generator paths', () => {
  const r = pick(entries([
    'athlete-mobile/assets/data/generator/Exercises.json',
    'athlete-mobile/assets/data/generator/skillTrees/BAS.json',
    'athlete-mobile/assets/data/generator/regions/BAS.ts'
  ]));
  assert.equal(r.error, undefined);
  assert.equal(r.exercises, 'athlete-mobile/assets/data/generator/Exercises.json');
  assert.deepEqual(r.trees, ['athlete-mobile/assets/data/generator/skillTrees/BAS.json']);
  assert.equal(r.ignored, 1);
});

test('loader: refuses the whole project folder', () => {
  const root = pick(entries(['app/athlete-mobile/assets/data/generator/Exercises.json', 'app/README.md']));
  assert.equal(root.error, loader.PROJECT_ERROR);
  assert.match(root.error, /You picked the whole project folder/);
  const mobile = pick(entries(['athlete-mobile/node_modules/x/index.js', 'athlete-mobile/assets/data/generator/Exercises.json']));
  assert.equal(mobile.error, loader.PROJECT_ERROR);
});

test('loader: reports a folder without Exercises.json', () => {
  const r = pick(entries(['x/skillTrees/SK.json']));
  assert.equal(r.exercises, null);
  assert.match(r.error, /Exercises\.json was not found/);
});

test('loader: readFileList reads a picked folder into the raw file map', async () => {
  const r = await loader.readFileList(fileList(SAMPLE_DIR, 'generator'));
  assert.deepEqual(r.errors, []);
  assert.equal(r.ignored, 1);
  assert.deepEqual(r.raw, readRaw(SAMPLE_DIR));
});

test('loader: readFileList reports unreadable files and picker errors', async () => {
  const files = fileList(SAMPLE_DIR, 'generator');
  files[1].text = async () => {
    throw new Error('locked');
  };
  const r = await loader.readFileList(files);
  assert.deepEqual(r.errors, [`The browser could not read ${files[1].webkitRelativePath}.`]);
  assert.equal(Object.hasOwn(r.raw, 'Exercises.json'), true);
  const empty = await loader.readFileList([]);
  assert.match(empty.errors[0], /Exercises\.json was not found/);
});

test('loader (real data): readFileList reads the real folder', REAL, async () => {
  const r = await loader.readFileList(fileList(REAL_DIR, 'generator'));
  assert.deepEqual(r.errors, []);
  assert.equal(Object.keys(r.raw).length, 28);
  assert.deepEqual(r.raw, readRaw(REAL_DIR));
});
