import test from 'node:test';
import assert from 'node:assert/strict';
import { TAG_GROUPS } from '../js/core/model.js';
import * as i18n from '../js/ui/i18n.js';
import { exerciseTagMeta, tagLabel, tagValueKey } from '../js/ui/terms.js';
import { stubStorage } from './helpers.js';

/** Runs fn with the language set to lang and puts German back afterwards. */
function inLang(t, lang, fn) {
  stubStorage(t);
  i18n.setLang(lang);
  try {
    return fn();
  } finally {
    i18n.setLang('de');
  }
}

// One tag of every group, as the catalog of the athlete app stores them.
const SAMPLE = {
  SKILL_STABILITY_BODY: ['Ganzkörperstabilität', 'Full-body stability'],
  REGION_LOWER_BODY: ['Unterkörper', 'Lower body'],
  EXERCISE_DIRECTION_HORIZONTAL_PUSH: ['Horizontales Drücken', 'Horizontal push'],
  EQ_TYPE_KG: ['Körpergewicht', 'Bodyweight'],
  EQ_DUMBBELL: ['2 Kurzhanteln', 'Dumbbell'],
  PLACE_HALL: ['In der Halle', 'Gym hall'],
  SIDE_BOTH: ['Beidseitig', 'Both sides'],
  AGE_CHILD: ['Kinder', 'Child'],
  GENDER_FEMALE: ['Weiblich', 'Female'],
  POSITION_FIELD: ['Feldspieler/in', 'Field player'],
  PAIN_KNEE: ['Knie', 'Knee'],
  BLOCK_HIGH_BMI: ['Hoher BMI', 'High BMI'],
  PREVENTION_KNEE_HIP: ['Knie & Hüfte', 'Knee & hip'],
  SEASON_PHASE_COMPETITION: ['Spielsaison', 'Competitive'],
  MUSCLE_QUADRICEPS: ['Oberschenkelvorderseite', 'Front thigh'],
  MUSCLE_SECONDARY_LOWER_BACK: ['Unterer Rücken', 'Lower back'],
  MUSCLE_INVOLVEMENT_ISOLATED: ['Isoliert', 'Isolated'],
  PAUSE: ['Pause', 'Rest']
};

test('terms: tagLabel names a tag of every group in both languages', (t) => {
  for (const [tag, [de, en]] of Object.entries(SAMPLE)) {
    assert.equal(tagLabel(tag), de, tag);
    assert.equal(inLang(t, 'en', () => tagLabel(tag)), en, tag);
  }
});

test('terms: every tag group has a name and a value dictionary', () => {
  for (const { key } of TAG_GROUPS) {
    assert.notEqual(i18n.t(`tagGroup.${key}`), `tagGroup.${key}`, key);
  }
  const values = Object.keys(i18n.DICTIONARIES.de.tagValue);
  for (const { prefix } of TAG_GROUPS) {
    assert.ok(values.includes(tagValueKey(`${prefix}X`).split('.')[1]), prefix);
  }
});

test('terms: secondary muscles share the muscle names', () => {
  assert.equal(tagValueKey('MUSCLE_SECONDARY_NECK'), 'tagValue.muscle.NECK');
  assert.equal(tagValueKey('MUSCLE_INVOLVEMENT_COMPLEX'), 'tagValue.muscleInvolvement.COMPLEX');
  assert.equal(tagValueKey('PAUSE_CARDIO_4'), 'tagValue.other.PAUSE_CARDIO_4');
});

test('terms: an unknown tag shows without its prefix in sentence case', () => {
  assert.equal(tagLabel('SKILL_STRENGTH'), 'Strength');
  assert.equal(tagLabel('EQ_NEW_THING'), 'New thing');
  assert.equal(tagLabel('CUSTOM_TAG'), 'Custom tag');
});

test('terms: exerciseTagMeta names the weight type and the side', () => {
  assert.deepEqual(exerciseTagMeta({ tags: ['SIDE_LEFT', 'EQ_TYPE_WEIGHTS', 'EQ_BARBELL'] }), [
    { tag: 'EQ_TYPE_WEIGHTS', label: 'Gewichte' },
    { tag: 'SIDE_LEFT', label: 'Links' }
  ]);
});
