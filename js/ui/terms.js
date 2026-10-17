// Labels the screens share: tag group names, tag names and the tag meta of an exercise.
// The tag groups come from model.TAG_GROUPS.
import { TAG_GROUPS, tagPrefix } from '../core/model.js';
import { h } from './dom.js';
import { has, t } from './i18n.js';

/** First tag with the prefix, or null. @param {unknown} tags @param {string} prefix */
const findTag = (tags, prefix) => (Array.isArray(tags) ? tags : []).find((tag) => tag.startsWith(prefix)) ?? null;

const META_PREFIXES = Object.freeze(['EQ_TYPE_', 'SIDE_']);
const GROUP_BY_PREFIX = new Map(TAG_GROUPS.map((g) => [g.prefix, g]));
// Groups that share the value names of another group.
const VALUE_GROUP = Object.freeze({ secondaryMuscle: 'muscle' });

/**
 * The labels of the weight type and side tags of an exercise.
 * @param {{ tags?: unknown }} ex @returns {{ tag: string, label: string }[]}
 */
export const exerciseTagMeta = (ex) => META_PREFIXES.flatMap((prefix) => {
  const tag = findTag(ex.tags, prefix);
  return tag ? [{ tag, label: tagLabel(tag) }] : [];
});

/** The label of a tag group, or null for an unknown prefix. @param {string} prefix @returns {string | null} */
export function tagGroupLabel(prefix) {
  const group = GROUP_BY_PREFIX.get(prefix);
  return group ? t(`tagGroup.${group.key}`) : null;
}

/**
 * The dictionary key of a tag name: tagValue.<group>.<tag without prefix>, or tagValue.other.<tag>
 * for a tag outside the groups.
 * @param {string} tag @returns {string}
 */
export function tagValueKey(tag) {
  const group = GROUP_BY_PREFIX.get(tagPrefix(tag));
  if (!group) return `tagValue.other.${tag}`;
  return `tagValue.${VALUE_GROUP[group.key] ?? group.key}.${tag.slice(group.prefix.length)}`;
}

/**
 * The name of a tag in the current language. A tag outside the dictionary shows without its
 * prefix in sentence case.
 * @param {string} tag @returns {string}
 */
export function tagLabel(tag) {
  const key = tagValueKey(tag);
  if (has(key)) return t(key);
  const group = GROUP_BY_PREFIX.get(tagPrefix(tag));
  const s = (group ? tag.slice(group.prefix.length) : tag).replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The inside of a tag chip: the name, then the tag as stored in the data. @param {string} tag @returns {Node[]} */
export const tagChipContent = (tag) => [h('span', null, tagLabel(tag)), h('span', { class: 'tag chip__code' }, tag)];
