// Labels the screens share: tag groups and the tag meta of an exercise.

/**
 * Tag groups in display order. de is null when the German word equals the English one.
 * @type {readonly { readonly prefix: string, readonly en: string, readonly de: string | null }[]}
 */
export const TAG_GROUPS = Object.freeze([
  ['SKILL_', 'Skill', null],
  ['REGION_', 'Region', null],
  ['EXERCISE_DIRECTION_', 'Movement direction', 'Bewegungsrichtung'],
  ['EQ_TYPE_', 'Weight type', 'Gewichtstyp'],
  ['EQ_', 'Equipment', 'Ausrüstung'],
  ['PLACE_', 'Training place', 'Trainingsort'],
  ['SIDE_', 'Side', 'Seite'],
  ['AGE_', 'Age group', 'Altersgruppe'],
  ['PAIN_', 'Pains', 'Beschwerden'],
  ['SEASON_PHASE_', 'Season phase', 'Saisonphase'],
  ['MUSCLE_', 'Muscle', 'Muskel'],
  ['MUSCLE_SECONDARY_', 'Secondary muscle', 'Hilfsmuskel'],
  ['MUSCLE_INVOLVEMENT_', 'Muscle involvement', 'Muskelbeteiligung']
].map(([prefix, en, de]) => Object.freeze({ prefix, en, de })));

/** First tag with the prefix, or null. @param {unknown} tags @param {string} prefix */
export const findTag = (tags, prefix) => (Array.isArray(tags) ? tags : []).find((t) => t.startsWith(prefix)) ?? null;

const META_PREFIXES = Object.freeze(['EQ_TYPE_', 'SIDE_']);

/**
 * The weight type and side tags of an exercise, each with the prefix cut off.
 * @param {{ tags?: unknown }} ex @returns {{ tag: string, label: string }[]}
 */
export const exerciseTagMeta = (ex) => META_PREFIXES.flatMap((prefix) => {
  const tag = findTag(ex.tags, prefix);
  return tag ? [{ tag, label: tag.slice(prefix.length) }] : [];
});
