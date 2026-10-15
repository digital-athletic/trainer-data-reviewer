import { PAUSE_ID, exerciseLabel, tagPrefix } from './model.js';

/**
 * @typedef {import('./model.js').Dataset} Dataset
 * @typedef {{ id: string, label: string, levelM: number, levelW: number, trees: string[],
 *   branchCount: number, hasVideo: boolean, hasDescription: boolean,
 *   haystack: string, tagSet: Set<string> }} Row
 * @typedef {{ text?: string, tree?: string, skill?: string, region?: string, eq?: string, place?: string,
 *   usage?: 'all' | 'used' | 'orphan', hasVideo?: boolean | null,
 *   hasDescription?: boolean | null }} Criteria
 */

const FACET_PREFIX = { skill: 'SKILL_', region: 'REGION_', eq: 'EQ_', place: 'PLACE_' };
const TAG_FACETS = Object.keys(FACET_PREFIX);

/** @param {Dataset} ds @returns {Row[]} */
export function buildRows(ds) {
  return ds.exercises.map((ex) => {
    const refs = ds.index.branchRefsByExerciseId.get(ex.id) ?? [];
    const trees = new Set(refs.map((r) => r.tree));
    const branches = new Set(refs.map((r) => `${r.tree}/${r.branchId}`));
    const { m, w } = ex.level ?? {};
    return {
      id: ex.id,
      label: exerciseLabel(ex),
      levelM: m,
      levelW: w,
      trees: [...trees].sort(),
      branchCount: branches.size,
      hasVideo: typeof ex.video === 'string' && ex.video !== '',
      hasDescription: typeof ex.description === 'string' && ex.description.trim() !== '',
      haystack: [ex.id, ex.name, ex.displayName].filter((s) => s != null).join(' ').toLowerCase(),
      tagSet: new Set(Array.isArray(ex.tags) ? ex.tags : [])
    };
  });
}

/** @param {Row[]} rows @param {Criteria} [criteria] @returns {Row[]} */
export function filter(rows, criteria) {
  const c = criteria ?? {};
  const tokens = String(c.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const tags = TAG_FACETS.map((k) => c[k]).filter(Boolean);
  const usage = c.usage || 'all';
  return rows.filter((row) => {
    if (!tokens.every((t) => row.haystack.includes(t))) return false;
    if (!tags.every((t) => row.tagSet.has(t))) return false;
    if (c.tree && !row.trees.includes(c.tree)) return false;
    if (usage === 'used' && row.branchCount === 0) return false;
    if (usage === 'orphan' && (row.branchCount > 0 || row.id === PAUSE_ID)) return false;
    if (c.hasVideo != null && row.hasVideo !== c.hasVideo) return false;
    if (c.hasDescription != null && row.hasDescription !== c.hasDescription) return false;
    return true;
  });
}

/** @param {Dataset} ds @returns {{ tree: string[], skill: string[], region: string[], eq: string[], place: string[] }} */
export function facetValues(ds) {
  const out = { tree: [...ds.treeNames], skill: [], region: [], eq: [], place: [] };
  for (const tag of [...ds.index.tagCounts.exercise.keys()].sort()) {
    const prefix = tagPrefix(tag);
    for (const k of TAG_FACETS) if (FACET_PREFIX[k] === prefix) out[k].push(tag);
  }
  return out;
}
