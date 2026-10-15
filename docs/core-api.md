# Core API

Each file in `js/core/` is a native ES module with named exports. The UI imports a module as a namespace, for example `import * as model from './core/model.js'`, and calls `model.load(raw)`. The names match the former `CDR.<name>` objects.

| Module | Exports |
|---|---|
| `config.js` (new) | `DATA_TARGET_PATH`, `PINNED_TESTS`, `ATHLETE_DATA_TABLE` |
| `model.js` | `REPO_BASE`, `EXERCISES`, `PAUSE_ID`, `PAUSE_TAG`, `TAG_PREFIXES`, `load`, `buildIndex`, `stats`, `fingerprint`, `getAt`, `hasAt`, `setAt`, `deleteAt`, `isUnsafeKey`, `recordKeyOf`, `parseRecordKey`, `originalData`, `serializeFile`, `changedFiles`, `tagPrefix`, `exerciseLabel`, `deepEqual`, `clone`, `isObject` |
| `schema.js` | `PICKLISTS`, `CELL_MESSAGE`, `validateExercise`, `validateBranch`, `validateDataset`, `parseCellInput` |
| `query.js` | `buildRows`, `filter`, `facetValues` |
| `edits.js` | `create`, `Editor`, `referencesTo`, `nextExerciseId`, `emptyParameter` |
| `review.js` | `create`, `parseValue` |
| `changelog.js` | `build`, `pinnedTestNotes`, `newTags` |
| `loader.js` | `pickDataFiles`, `readFileList` (async), `PROJECT_ERROR` |
| `workfile.js` (new) | `KIND`, `VERSION`, `FILE_PREFIX`, `MAX_FILE_BYTES`, `MAX_COMMANDS`, `fileName`, `serialize`, `parse` |

The frozen data exports (`PINNED_TESTS`, `PICKLISTS`, `TAG_PREFIXES`) throw on a write in strict mode.

## Record keys and paths

- `model.recordKeyOf(target, level?)` returns `exercise:429`, `branch:SKKG/979` or, with a level, `branch:SKKG/979:L3`. `model.parseRecordKey(key)` returns `{ target, level }` or `null`.
- `getAt` and `hasAt` treat a path with `__proto__`, `constructor` or `prototype` as missing. `setAt` and `deleteAt` throw on such a path. `setField` and `revertField` refuse it with a plain message.

## UI helpers

- `js/ui/routes.js`: `exerciseHash`.
- `js/ui/terms.js`: `TAG_GROUPS`, `findTag`, `exerciseTagMeta`.
- `js/ui/registry.js` defines the `Ctx` typedef that every view receives.

## Editor

`edits.create(ds)` returns an `Editor` instance. Its methods keep the old names: `setField`, `setTags`, `setOtherSide`, `addExercise`, `deleteExercise`, `undo`, `revertField`, `journal`, `commands`, `replay`, `netChanges`, `changeCount`, `markExported`, `unexportedCount`, `subscribe`. The properties `ds` and `highWater` stay public.

- `changeCount()` is the number of net changes (`netChanges().length`).
- `markExported()` stores the new value of every net change, keyed by record key and field.
- `unexportedCount(changes?)` counts the net changes that are missing from that snapshot or hold another value, plus snapshot entries that are no longer a net change. Before any export it equals `changeCount()`. Pass the result of `netChanges()` to skip computing it twice.

## Work file

One JSON file holds the edit journal and the review part.

- `workfile.serialize({ commands, review, fingerprint, savedAt })` returns the file text. `savedAt` defaults to now.
- `workfile.parse(text)` returns `{ ok: true, value: { commands, review, fingerprint, savedAt }, warnings }` or `{ ok: false, message }`.
  - `review` comes from `review.parseValue`. This version sets no review marks; it keeps the marks of a work file from a newer version as they are.
- `parse` refuses a file with more than `MAX_COMMANDS` (50,000) commands and skips a command whose arguments are not plain JSON values. The app refuses a file larger than `MAX_FILE_BYTES` (5 MB) before reading it. The browser backup goes through the same `parse`.
- `workfile.fileName(date)` returns `coach-review-work-YYYY-MM-DD.json`.
- The file carries `kind: 'coach-data-review-work'` and `version: 1`.

## Behaviour changes

- `loader.readFileList(fileList)` is an `async` function. The result shape stays `{ raw, ignored, errors }`.
- `review.parseValue(data)` validates an already parsed object.
- `config.js` holds the repository specific values: the target data path for the changelog and the pinned-test notes.
- The loader and model error texts name `config.DATA_TARGET_PATH` as the folder to pick.

## Specs

`npm test` runs `spec/**/*.spec.js` with Node's test runner against the tracked sample data in `spec/fixtures/sample/`. The real-data specs read `CDR_DATA_DIR` (default `spec/fixtures/real/generator`, not tracked) and skip when the folder is missing. `spec/README.md` explains how to run them.

`npm start` serves the app folder on 127.0.0.1, port 8080 (`node dev/serve.js [port]`), because browsers load ES modules over HTTP only. The server answers 404 for dot files and dot folders and for symlinks that lead out of the app folder.
