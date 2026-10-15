import { DATA_TARGET_PATH } from './config.js';

/**
 * @typedef {import('./model.js').RawFiles} RawFiles
 * @typedef {{ relativePath: string }} PathEntry
 * @typedef {{ exercises: string | null, trees: string[], ignored: number, error?: string }} PickResult
 * @typedef {{ raw: RawFiles, ignored: number, errors: string[] }} ReadResult
 */

export const PROJECT_ERROR = `You picked the whole project folder. Please pick ${DATA_TARGET_PATH} instead.`;
const MISSING_ERROR = `Exercises.json was not found in the chosen folder. Please pick ${DATA_TARGET_PATH}.`;
const [PROJECT_FOLDER] = DATA_TARGET_PATH.split('/');

const segments = (entry) => String(entry.relativePath ?? '').replace(/\\/g, '/').split('/').filter(Boolean);

/**
 * Finds Exercises.json and its sibling skillTrees/*.json, whatever the picked folder is called.
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
 * @param {ArrayLike<{ name: string, webkitRelativePath?: string, text(): Promise<string> }>} fileList
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
    try {
      return { text: await byPath.get(path).text() };
    } catch {
      return { error: `The browser could not read ${path}.` };
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
