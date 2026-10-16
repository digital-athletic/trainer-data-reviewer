# Core API

Each file in `js/core/` is a native ES module with named exports. The UI imports a module as a namespace, for example `import * as model from './core/model.js'`, and calls `model.load(raw)`.

| Module | Exports |
|---|---|
| `config.js` | `DATA_TARGET_PATH`, `PINNED_TESTS`, `ATHLETE_DATA_TABLE` |
| `model.js` | `REPO_BASE`, `EXERCISES`, `PAUSE_ID`, `PAUSE_TAG`, `TAG_GROUPS`, `load`, `buildIndex`, `stats`, `fingerprint`, `getAt`, `hasAt`, `setAt`, `deleteAt`, `isUnsafeKey`, `recordKeyOf`, `parseRecordKey`, `originalData`, `originalExercise`, `isChanged`, `localDate`, `serializeFile`, `changedFiles`, `tagPrefix`, `exerciseLabel`, `deepEqual`, `clone`, `isObject` |
| `schema.js` | `PICKLISTS`, `CELL_MESSAGE`, `validateExercise`, `validateBranch`, `validateDataset`, `parseCellInput` |
| `query.js` | `FACET_PREFIX`, `haystack`, `buildRows`, `filter`, `facetValues` |
| `edits.js` | `Editor`, `referencesTo`, `emptyParameter` |
| `review.js` | `create`, `parseValue` |
| `changelog.js` | `build`, `pinnedTestNotes`, `newTags` |
| `loader.js` | `pickDataFiles`, `readFileList` (async), `MAX_DATA_FILE_BYTES`, `PROJECT_ERROR`, `MISSING_ERROR` |
| `workfile.js` | `KIND`, `MAX_FILE_BYTES`, `MAX_COMMANDS`, `fileName`, `serialize`, `parse` |
| `messages.js` | `MESSAGES`, `format`, `msg`, `messageError` |

`PINNED_TESTS`, `PICKLISTS`, `TAG_GROUPS` and `MESSAGES` are frozen. A write to them throws in strict mode.

## Messages

Core never imports UI code, and it returns its user-visible texts as messages. `messages.js` holds the English text of every message under a code in `MESSAGES`.

- `msg(code, params)` returns `{ code, params, message }`. `message` is the English text with the `{name}` placeholders filled in. The specs read `message`.
- `messageError(code, params)` returns an `Error` with the English `message` plus `code` and `params`. `model.load`, `setAt` and `deleteAt` throw it.
- A failed `Result` lists violations of the shape `{ path, code, params, message }`. `deleteExercise` returns its `reason` as a message. `loader` returns `error` and `errors` as messages. `workfile.parse` returns `{ ok: false, code, params, message }` and its `warnings` as messages.
- `format(template, params, locale)` fills the placeholders and formats a number param with the thousands separator of `locale`.
- The UI shows a message through `coreText` in `js/ui/i18n.js`, which looks up `core.<code>` in the dictionary of the current language. The English dictionary takes `MESSAGES` as its `core` part, so the English UI shows the same text the specs check.
- `changelog.js` writes English on purpose: `changelog.md` goes to the developer.

## Config

`config.js` holds the values that depend on the target repository:

- `DATA_TARGET_PATH` is the folder inside that repository that holds `Exercises.json` and the `skillTrees` folder. `model.REPO_BASE` prefixes it to every file path. The welcome screen, the changelog, the export texts, and the errors of `loader.js` and `model.load` show `DATA_TARGET_PATH/Exercises.json` as the file to pick.
- `PINNED_TESTS` names the tests of that repository that pin counts of the data. `changelog.pinnedTestNotes` reads it.
- `ATHLETE_DATA_TABLE` is the database table that stores athlete ids of exercises and branches.

## Record keys and paths

- `model.recordKeyOf(target, level?)` returns `exercise:429`, `branch:SKKG/979` or, with a level, `branch:SKKG/979:L3`. `model.parseRecordKey(key)` returns `{ target, level }` or `null`.
- `getAt` and `hasAt` treat a path with `__proto__`, `constructor` or `prototype` as missing.
- `setAt` and `deleteAt` throw the message `unsafeField` (`The field name "<key>" is not allowed.`) on such a path. `Editor.setField` and `Editor.revertField` return the same message in a failed result.

## Loader

The app picks the single file `Exercises.json`. `model.load(raw)` needs `raw['Exercises.json']` and accepts any number of `skillTrees/*.json` entries, zero included.

- `loader.pickDataFiles(entries)` finds `Exercises.json` in the picked entries. For a single picked file it returns `trees: []`. For a picked folder it also returns the sibling `skillTrees/*.json`, whatever the folder is called.
- `pickDataFiles` returns `MISSING_ERROR` when no entry is named `Exercises.json`, and `PROJECT_ERROR` when the entries hold the whole project folder.
- `loader.readFileList(fileList)` is `async` and returns `{ raw, ignored, errors }`. It refuses a picked file larger than `MAX_DATA_FILE_BYTES` (50 MB) before it reads the text, and adds an error for it.

## Review

- `review.create(ds)` returns an empty review status.
- `review.parseValue(data)` validates an already parsed review status and returns `{ ok: true, status }` or `{ ok: false }`. It copies `branches` and `issues` from the file unchanged. The app writes no review marks.

## UI helpers

- `js/ui/i18n.js`: the UI language. German is the default, English the alternative. `t(key, params)` returns the text of a dictionary key with its `{name}` placeholders filled in; a number `params.count` picks the `key_one` or `key_other` form first. `setLang('de' | 'en')` switches the language, stores the choice under `STORAGE_KEY` in `localStorage` and calls the `onLangChange` listeners; app.js then renders the header and the open screen again. `storedLang()` falls back to German when the storage is empty, holds an unknown value or throws. `applyStatic()` sets `<html lang>` and fills the `data-i18n`, `data-i18n-title` and `data-i18n-label` texts of `index.html`. `coreText(m)` shows a core message, an `Error` or a plain string. `fmt(n)` formats a number for the current language.
- `js/ui/locale-de.js` and `js/ui/locale-en.js` hold the dictionaries with the same keys. The German domain terms follow `athlete-mobile/src/i18n/locales/de.json` and `trainer-web/src/i18n/locales/de.json` of the athlete app repository. `spec/i18n.spec.js` checks that both dictionaries hold the same keys and placeholders, and that no UI module outside these files holds English prose.
- `js/ui/routes.js`: `exerciseHash`, `parseRoute`.
- `js/ui/terms.js`: `exerciseTagMeta`, `tagGroupLabel(prefix)` and `tagValueLabel(facet, tag, prefix)`. Each entry of `model.TAG_GROUPS` holds a `prefix` and a dictionary `key` under `tagGroup`. `tagValueLabel` looks a tag up under `tagValue.<facet>` and falls back to the tag without its prefix. `query.FACET_PREFIX` takes the prefixes of the skill, region, eq and place filters from `model.TAG_GROUPS` too.
- `js/ui/registry.js` defines the `Ctx` typedef that every view receives.
- `js/ui/work-file.js` saves and opens work files and restores the browser backup. `replayOnFreshCopy(ds, commands)` replays a command list on a fresh copy of the loaded files and returns `{ editor, result, count }`. `settleRestore(app, saved, editor, restore)` applies the trainer's answer on a backup: restore starts a session and rewrites the backup with its `unsaved` flag, decline removes the backup. `replaceWork(app, work, editor)` replaces the session and its backup with an opened work file.
- `js/ui/autosave.js`: `AutoSave` writes the backup under the key `PREFIX` plus the data fingerprint, so each backup belongs to one `Exercises.json`. `read()` returns `{ work, unsaved }` for the backup of the current fingerprint, or `null`. It never offers the backup of another fingerprint, and `forget()` removes only the own entry. A backup stays in `localStorage` until the trainer chooses that `Exercises.json` again and declines the restore, or undoes every change of that session. `read()` ignores an entry whose text exceeds `workfile.MAX_FILE_BYTES`.
- `js/ui/export-dialog.js`: `openExport` downloads the changed files and `changelog.md`.

## Editor

`new Editor(ds)` creates an editor for the dataset `ds`. The properties `ds` and `highWater` (`{ exerciseId, branchId }`) are public.

`Editor` exposes these methods:

- `setField`, `setTags`, `setOtherSide`, `addExercise`, `deleteExercise` and `revertField` change the dataset. Each returns `{ ok: true }` or `{ ok: false, errors }`. `addExercise` also returns the new `id`. `deleteExercise` returns `{ ok: false, reason, references }` for Pause and for an exercise that a branch level or another exercise still references.
- `undo()` reverts the last group of edits and returns them, or returns `null` when the journal is empty.
- `journal()` returns a copy of the edits. `commands()` returns the public calls that `replay(commands)` applies again. `replay` returns `{ applied, failed }`.
- The `journalLength` getter returns the number of edits without copying the journal.
- `netChanges()` returns one entry per changed field, with the loaded value and the current value. `changeCount(changes?)` returns `netChanges().length`, or the length of `changes` when you pass them.
- `markExported()` stores the new value of every net change, keyed by record key and field.
- `unexportedCount(changes?)` counts the net changes that are missing from that snapshot or hold another value, plus snapshot entries that are no longer a net change. Before any export it equals `changeCount()`. Pass the result of `netChanges()` to skip computing it twice.
- `subscribe(fn)` calls `fn` with the applied edits after every change and returns a function that removes the listener.

## Changelog

`changelog.build(editor, ds, { date?, changes? })` returns the Markdown text of `changelog.md`. `date` defaults to the local date from `model.localDate`. `changes` takes the result of `editor.netChanges()` so the export computes them once. The text has four sections:

1. the changed files
2. a table of the net changes
3. the confirmed new tags (`newTags`)
4. the notes for the developer (`pinnedTestNotes(editor, ds, changes?)`)

A table cell escapes `` \ ` | < > [ ] & * _ ~ ! `` with a backslash. A cell or a code span replaces CR, LF, U+2028 and U+2029 with a space. The reserved id note prints the deleted id as a code span.

## Work file

One JSON file holds the edit journal and the review part. The file carries `kind: 'coach-data-review-work'` and `version: 1`.

- `workfile.serialize({ commands, review, fingerprint, savedAt })` returns the file text. `savedAt` defaults to now.
- `workfile.parse(text)` returns `{ ok: true, value: { commands, review, fingerprint, savedAt }, warnings }` or `{ ok: false, code, params, message }`. `review` comes from `review.parseValue`.
- `parse` refuses a file with more than `MAX_COMMANDS` (50,000) commands. It skips a command that is not an object with a text `method` and a list `args` of plain JSON values, and adds a warning.
- The app refuses a file larger than `MAX_FILE_BYTES` (5 MB) before it reads the file. The browser backup in `localStorage` goes through the same `parse`.
- `workfile.fileName(date)` returns `coach-review-work-YYYY-MM-DD.json` with the local calendar date of `date`, which defaults to now.
- `fingerprint` comes from `model.fingerprint(ds)`, a hash over the path and raw text of every loaded file. A work file saved by the older app version, which read the whole data folder, carries a fingerprint over `Exercises.json` and the skill trees. The app finds that fingerprint different from a load of `Exercises.json` alone and asks the trainer before it replays the work file. `replay` reports each branch command of such a file as failed. The app does not offer a browser backup under another fingerprint.

## Skill trees and branches

The app UI loads no skill trees today: the trainer picks `Exercises.json` alone, so `ds.treeNames` is empty and the header shows the exercise count only. The core code keeps full skill tree support for a dataset that holds skill trees, and the specs load the three skill trees in `spec/fixtures/sample/skillTrees/`.

- Loading: `model.load` reads each `skillTrees/<TREE>.json` entry of `raw` into `ds.trees[TREE]`, an object of branches keyed by branch id. `ds.treeNames` lists the trees in sorted order. `ds.loadMax.branchId` holds the highest loaded branch id, and `Editor.highWater.branchId` starts from it. `loader.pickDataFiles` and `readFileList` collect the `skillTrees/*.json` files of a picked folder.
- Index: `model.buildIndex` maps each exercise id to the branch levels that use it (`branchRefsByExerciseId`), each branch id to its tree (`treeOfBranch`), and counts branch tags in `tagCounts.branch`. `model.stats` counts trees and branches.
- Branch editing: `setField`, `setTags` and `revertField` accept the target `{ kind: 'branch', tree, branchId }`. Edits on a branch go to `skillTrees/<tree>.json`, and `changedFiles` exports that file. `undo` can revert an added or removed branch record, but no public `Editor` method adds or removes a branch.
- The `levels` rule: `setField` refuses a path that starts with `levels` ("Branch levels change through the ladder."). `schema.validateBranch` accepts level keys 1 to 6 only, and each level must point to an exercise id. `deleteExercise` refuses an exercise that a branch level references.
- Changelog: `pinnedTestNotes` writes a note when branches of a skill tree were added or deleted, a count note for the tree `PINNED_TESTS.skillTreeRegistry.countedTree`, a note when an edit changes the `levels` or `tags` of the branch `pinnedBranchId` or adds or deletes that branch, and a reserved id note for a deleted branch. `config.PINNED_TESTS.skillTreeRegistry` names the test file and lines.
- Queries: `query.buildRows` lists the skill trees of each exercise, and `facetValues` offers `ds.treeNames` as the skill tree filter. The exercises table shows the skill tree column and filter only when `ds.treeNames` is not empty.
- Tag picker: `pickTags(ctx, { kind: 'branch' })` in `js/ui/pickers.js` counts each tag on branches instead of exercises. No view calls it with `kind: 'branch'` today.

## Specs

`npm test` runs `spec/**/*.spec.js` with Node's test runner against the tracked sample data in `spec/fixtures/sample/`. The real-data specs read `CDR_DATA_DIR` (default `spec/fixtures/real/generator`, not tracked) and skip when the folder is missing. `spec/README.md` explains how to run them.

`npm start` serves the app folder on 127.0.0.1, port 8080 (`node dev/serve.js [port]`), because browsers load ES modules over HTTP only. The server answers 404 for dot files and dot folders and for symlinks that lead out of the app folder.
