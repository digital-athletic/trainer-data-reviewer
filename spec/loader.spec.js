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
  assert.equal(root.error.code, 'projectFolder');
  assert.match(root.error.message, /You picked the whole project folder/);
  const mobile = pick(entries(['athlete-mobile/node_modules/x/index.js', 'athlete-mobile/assets/data/generator/Exercises.json']));
  assert.equal(mobile.error, loader.PROJECT_ERROR);
});

test('loader: reports a folder without Exercises.json', () => {
  const r = pick(entries(['x/skillTrees/SK.json']));
  assert.equal(r.exercises, null);
  assert.equal(r.error, loader.MISSING_ERROR);
});

test('loader: accepts a single picked Exercises.json and finds no skill trees', () => {
  const r = pick(entries(['Exercises.json']));
  assert.equal(r.error, undefined);
  assert.equal(r.exercises, 'Exercises.json');
  assert.deepEqual(r.trees, []);
  assert.equal(r.ignored, 0);
});

test('loader: refuses a single file with another name', () => {
  const r = pick(entries(['Exercises (1).json']));
  assert.equal(r.exercises, null);
  assert.equal(r.error, loader.MISSING_ERROR);
  assert.match(r.error.message, /Exercises\.json/);
});

test('loader: readFileList reads a single picked Exercises.json', async () => {
  const raw = readRaw(SAMPLE_DIR);
  const r = await loader.readFileList([{ name: 'Exercises.json', webkitRelativePath: '', text: async () => raw['Exercises.json'] }]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ignored, 0);
  assert.deepEqual(r.raw, { 'Exercises.json': raw['Exercises.json'] });
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
  assert.deepEqual(r.errors.map((e) => e.message), [`The browser could not read ${files[1].webkitRelativePath}.`]);
  assert.equal(Object.hasOwn(r.raw, 'Exercises.json'), true);
  const empty = await loader.readFileList([]);
  assert.equal(empty.errors[0], loader.MISSING_ERROR);
});

test('loader: readFileList refuses a file above 50 MB without reading it', async () => {
  let read = false;
  const big = {
    name: 'Exercises.json', webkitRelativePath: '', size: loader.MAX_DATA_FILE_BYTES + 1,
    text: async () => {
      read = true;
      return '[]';
    }
  };
  const r = await loader.readFileList([big]);
  assert.equal(read, false);
  assert.deepEqual(r.raw, {});
  assert.deepEqual(r.errors.map((e) => e.message), ['Exercises.json is larger than 50 MB. The app does not read it. Pick the Exercises.json of the project.']);
  assert.deepEqual(r.errors[0].params, { path: 'Exercises.json', mb: 50 });
});

// Builds browser-like File objects for the picked skill tree files, as a multi-file pick yields them.
const treeFiles = (raw, names) => names.map((name) => ({ name, size: 10, text: async () => raw[`skillTrees/${name}`] }));

test('loader: readTreeFiles reads picked skill tree files into skillTrees keys', async () => {
  const raw = readRaw(SAMPLE_DIR);
  const r = await loader.readTreeFiles(treeFiles(raw, ['BAS.json', 'SKKG.json', 'SUPPORT.json']));
  assert.deepEqual(r.errors, []);
  const { 'Exercises.json': _, ...trees } = raw;
  assert.deepEqual(r.raw, trees);
});

test('loader: readTreeFiles refuses Exercises.json, other file types and files above 50 MB', async () => {
  let read = false;
  const big = { name: 'BIG.json', size: loader.MAX_DATA_FILE_BYTES + 1, text: async () => { read = true; return '{}'; } };
  const files = [
    { name: 'Exercises.json', size: 2, text: async () => '[]' },
    { name: 'notes.ts', size: 2, text: async () => '' },
    big,
    { name: 'BAS.json', size: 2, text: async () => '{}' }
  ];
  const r = await loader.readTreeFiles(files);
  assert.equal(read, false);
  assert.deepEqual(r.raw, { 'skillTrees/BAS.json': '{}' });
  assert.deepEqual(r.errors.map((e) => e.code), ['notTreeFile', 'notTreeFile', 'treeTooLarge']);
  assert.equal(r.errors[0].params.path, loader.TREES_PATH);
  assert.equal(loader.TREES_PATH, 'athlete-mobile/assets/data/generator/skillTrees');
});

test('loader: readTreeFiles reports an unreadable file', async () => {
  const r = await loader.readTreeFiles([{ name: 'BAS.json', size: 2, text: async () => { throw new Error('locked'); } }]);
  assert.deepEqual(r.raw, {});
  assert.deepEqual(r.errors.map((e) => e.message), ['The browser could not read BAS.json.']);
});

test('loader (real data): readFileList reads the real folder', REAL, async () => {
  const r = await loader.readFileList(fileList(REAL_DIR, 'generator'));
  assert.deepEqual(r.errors, []);
  assert.equal(Object.keys(r.raw).length, 28);
  assert.deepEqual(r.raw, readRaw(REAL_DIR));
});
