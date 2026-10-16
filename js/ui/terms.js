// Labels the screens share: tag group names, tag value names and the tag meta of an exercise.
// The tag groups come from model.TAG_GROUPS.
import { TAG_GROUPS } from '../core/model.js';
import { has, t } from './i18n.js';

/** First tag with the prefix, or null. @param {unknown} tags @param {string} prefix */
const findTag = (tags, prefix) => (Array.isArray(tags) ? tags : []).find((tag) => tag.startsWith(prefix)) ?? null;

const META_PREFIXES = Object.freeze(['EQ_TYPE_', 'SIDE_']);
const GROUP_BY_PREFIX = new Map(TAG_GROUPS.map((g) => [g.prefix, g]));

/**
 * The weight type and side tags of an exercise, each with the prefix cut off.
 * @param {{ tags?: unknown }} ex @returns {{ tag: string, label: string }[]}
 */
export const exerciseTagMeta = (ex) => META_PREFIXES.flatMap((prefix) => {
  const tag = findTag(ex.tags, prefix);
  return tag ? [{ tag, label: tag.slice(prefix.length) }] : [];
});

/** The label of a tag group, or null for an unknown prefix. @param {string} prefix @returns {string | null} */
export function tagGroupLabel(prefix) {
  const group = GROUP_BY_PREFIX.get(prefix);
  return group ? t(`tagGroup.${group.key}`) : null;
}

/**
 * The label of a tag in a filter list: the term of the dictionary under tagValue.<facet>, else the
 * tag without its prefix in sentence case.
 * @param {string} facet filter key such as region, place or eq @param {string} tag @param {string} prefix
 * @returns {string}
 */
export function tagValueLabel(facet, tag, prefix) {
  const rest = prefix && tag.startsWith(prefix) ? tag.slice(prefix.length) : tag;
  const key = `tagValue.${facet}.${rest}`;
  if (has(key)) return t(key);
  const s = rest.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
