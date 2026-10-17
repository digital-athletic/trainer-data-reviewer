import { DATA_TARGET_PATH } from './config.js';
import { msg } from './messages.js';

/**
 * @typedef {import('./model.js').RawFiles} RawFiles
 * @typedef {import('./messages.js').Message} Message
 * @typedef {{ relativePath: string }} PathEntry
 * @typedef {{ exercises: string | null, trees: string[], ignored: number, error?: Message }} PickResult
 * @typedef {{ raw: RawFiles, ignored: number, errors: Message[] }} ReadResult
 */

export const PROJECT_ERROR = Object.freeze(msg('projectFolder', { path: `${DATA_TARGET_PATH}/Exercises.json` }));
export const MISSING_ERROR = Object.freeze(msg('onlyExercises', { path: `${DATA_TARGET_PATH}/Exercises.json` }));
/** The app refuses a picked data file above this size in bytes. */
export const MAX_DATA_FILE_BYTES = 50 * 1024 * 1024;
/** The folder of the skill tree files in the target repository. */
export const TREES_PATH = `${DATA_TARGET_PATH}/skillTrees`;
const [PROJECT_FOLDER] = DATA_TARGET_PATH.split('/');

const segments = (entry) => String(entry.relativePath ?? '').replace(/\\/g, '/').split('/').filter(Boolean);

/**
 * Finds Exercises.json in the picked files. A single picked file has no folder, so trees stays empty.
 * A folder pick also yields the sibling skillTrees/*.json files, whatever the folder is called.
 * @param {PathEntry[]} entries @returns {PickResult}
 */
export function pickDataFiles(entries) {
  const list = entries ?? [];
  const project = list.some((e) => segments(e).slice(0, 2)
    .some((seg, i) => seg === 'node_modules' || (seg === PROJECT_FOLDER && i === 1)));
  if (project) return { exercises: null, trees: [], ignored: list.length, error: PROJECT_ERROR };

  const candidates = list.filter((e) => segments(e).at(-1) === 'Exercises.json')
    .sort((a, b) => segments(a).length - segments(b).length);
  if (!candidates.length) return { exercises: null, trees: [], ignored: list.length, error: MISSING_ERROR };

  const [first] = candidates;
  const base = segments(first).slice(0, -1).join('/');
  const prefix = base ? `${base}/skillTrees/` : 'skillTrees/';
  const trees = list
    .filter((e) => {
      const p = segments(e).join('/');
      return p.startsWith(prefix) && /^[^/]+\.json$/.test(p.slice(prefix.length));
    })
    .map((e) => e.relativePath);
  return { exercises: first.relativePath, trees, ignored: list.length - 1 - trees.length };
}

/**
 * Browser only: reads the picked FileList into a RawFiles map.
 * @param {ArrayLike<{ name: string, size: number, webkitRelativePath?: string, text(): Promise<string> }>} fileList
 * @returns {Promise<ReadResult>}
 */
export async function readFileList(fileList) {
  const entries = Array.from(fileList ?? [], (file) => ({ relativePath: file.webkitRelativePath || file.name, file }));
  const picked = pickDataFiles(entries);
  if (picked.error) return { raw: {}, ignored: picked.ignored, errors: [picked.error] };
  const byPath = new Map(entries.map((e) => [e.relativePath, e.file]));
  const jobs = [
    { key: 'Exercises.json', path: picked.exercises },
    ...picked.trees.map((path) => ({ key: `skillTrees/${path.split('/').at(-1)}`, path }))
  ];
  const texts = await Promise.all(jobs.map(async ({ path }) => {
    const file = byPath.get(path);
    if (file.size > MAX_DATA_FILE_BYTES) {
      return { error: msg('tooLarge', { path, mb: MAX_DATA_FILE_BYTES / (1024 * 1024) }) };
    }
    try {
      return { text: await file.text() };
    } catch {
      return { error: msg('unreadable', { path }) };
    }
  }));
  /** @type {RawFiles} */
  const raw = {};
  const errors = [];
  for (const [i, { key }] of jobs.entries()) {
    const { text, error } = texts[i];
    if (error) errors.push(error);
    else raw[key] = text;
  }
  return { raw, ignored: picked.ignored, errors };
}

/**
 * Browser only: reads picked skill tree files into a RawFiles map keyed "skillTrees/<name>".
 * Every picked file must be a .json file other than Exercises.json. model.load checks the content.
 * @param {ArrayLike<{ name: string, size: number, text(): Promise<string> }>} fileList
 * @returns {Promise<ReadResult>}
 */
export async function readTreeFiles(fileList) {
  const files = Array.from(fileList ?? []);
  const results = await Promise.all(files.map(async (file) => {
    const { name } = file;
    if (!/^[^/\\]+\.json$/.test(name) || name === 'Exercises.json') {
      return { error: msg('notTreeFile', { name, path: TREES_PATH }) };
    }
    if (file.size > MAX_DATA_FILE_BYTES) {
      return { error: msg('treeTooLarge', { path: name, mb: MAX_DATA_FILE_BYTES / (1024 * 1024) }) };
    }
    try {
      return { key: `skillTrees/${name}`, text: await file.text() };
    } catch {
      return { error: msg('unreadable', { path: name }) };
    }
  }));
  /** @type {RawFiles} */
  const raw = {};
  const errors = [];
  for (const { key, text, error } of results) {
    if (error) errors.push(error);
    else raw[key] = text;
  }
  return { raw, ignored: 0, errors };
}
