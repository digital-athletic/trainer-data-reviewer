// English texts of the messages that core returns or throws. Every message carries its code and
// params next to the English text, so the UI can show the message in the trainer's language.

/** @typedef {{ code: string, params: Record<string, unknown>, message: string }} Message */

export const MESSAGES = Object.freeze({
  text: '{text}',
  // model.js
  unsafeField: 'The field name "{name}" is not allowed.',
  notJson: '{path} is not valid JSON ({detail}). Pick an unchanged copy of the file.',
  exercisesMissing: 'Exercises.json is missing. Pick {path}.',
  exercisesNotList: 'Exercises.json must hold a list of exercises.',
  unexpectedFile: 'Unexpected file {path}.',
  treeNotObject: '{path} must hold an object of branches.',
  // edits.js
  recordGone: 'The record no longer exists.',
  recordMissing: 'The record does not exist.',
  noField: 'No field given.',
  tagsViaEditor: 'Tags change through the tag editor.',
  idFixed: 'The id of an exercise cannot be changed.',
  levelsViaLadder: 'Branch levels change through the ladder.',
  nameEmpty: 'The name must not be empty.',
  pauseTag: 'The tag {tag} belongs to the Pause exercise only.',
  newTagUnconfirmed: 'New tag {tags} is not in the vocabulary yet. Confirm it.',
  exerciseMissing: 'Exercise {id} does not exist.',
  ownOtherSide: 'An exercise cannot be its own other side.',
  idTaken: 'Exercise id {id} is already taken.',
  pauseNoDelete: 'Pause is a system exercise and cannot be deleted.',
  inUse: 'This exercise is still in use. Remove these references first.',
  noLoadedValue: 'This record is new, so there is no loaded value to go back to.',
  unknownCommand: 'Unknown change "{method}".',
  notAdded: 'Exercise {id} was not added, so this change was skipped.',
  // schema.js
  cellNumber: 'Enter a number such as 12 or 2.5, or leave the cell empty.',
  valueGroup: 'Must be a group of values.',
  weightType: 'Weight type must be one of {list}.',
  unknownGender: 'Unknown gender "{gender}". Use one of {list}.',
  levelGroup: 'Must be a group of fitness level values.',
  unknownLevel: 'Unknown fitness level "{level}". Use one of {list}.',
  valuesGroup: 'Values must be a group of training parameters or empty.',
  unknownParam: 'Unknown training parameter "{param}". Use one of {list}.',
  paramParts: 'Must hold a start value and a target value.',
  startMissing: 'Start value is missing.',
  targetMissing: 'Target value is missing.',
  textOrEmpty: 'Must be text or empty.',
  tagsList: 'Tags must be a list.',
  tagText: 'Every tag must be text.',
  exerciseRecord: 'An exercise must be a record.',
  idText: 'The id must be text.',
  levelMissing: 'Level m and w are missing.',
  levelNumber: 'Level {gender} must be a number.',
  nameText: 'The name must be text.',
  valuesMissing: 'Values are missing.',
  flagBoolean: 'Must be ticked or unticked (true or false).',
  equivalentList: 'Equivalent exercises must be a list of ids.',
  conversionNumber: 'The conversion factor must be a number.',
  branchRecord: 'A branch must be a record.',
  levelsGroup: 'Levels must be a group of branch levels.',
  branchLevelKey: 'Branch level "{level}" is not allowed. Use 1 to 6.',
  branchLevelTarget: 'Branch level {level} must point to an exercise id.',
  // loader.js
  projectFolder: 'You picked the whole project folder. Pick the file {path} instead.',
  onlyExercises: 'The app reads the file Exercises.json only. Pick {path}.',
  tooLarge: '{path} is larger than {mb} MB. The app does not read it. Pick the Exercises.json of the project.',
  unreadable: 'The browser could not read {path}.',
  notTreeFile: '{name} is not a skill tree file. Pick the .json files from {path}.',
  treeTooLarge: '{path} is larger than {mb} MB. The app does not read it.',
  // workfile.js
  notWorkFile: 'This file is not a work file of the coach data reviewer. Pick a coach-review-work file that this app saved.',
  newerWorkFile: 'This work file comes from a newer version of the app. Update the app and try again.',
  tooManyCommands: 'This work file holds more than {max} changes. The app does not open it.',
  skippedCommands: 'Skipped {count} unreadable change(s).'
});

/**
 * Fills {name} placeholders from params. Numbers get the thousands separator of the locale.
 * A placeholder without a param stays as it is.
 * @param {string} template @param {Record<string, unknown>} [params] @param {string} [locale]
 * @returns {string}
 */
export function format(template, params = {}, locale = 'en') {
  return template.replace(/\{(\w+)\}/g, (whole, key) => {
    if (!Object.hasOwn(params, key)) return whole;
    const v = params[key];
    return typeof v === 'number' ? v.toLocaleString(locale) : String(v);
  });
}

/** @param {keyof typeof MESSAGES} code @param {Record<string, unknown>} [params] @returns {Message} */
export const msg = (code, params = {}) => ({ code, params, message: format(MESSAGES[code], params) });

/** An Error whose message is the English text, with code and params for the UI. @param {keyof typeof MESSAGES} code @param {Record<string, unknown>} [params] */
export const messageError = (code, params = {}) => Object.assign(new Error(format(MESSAGES[code], params)), { code, params });
