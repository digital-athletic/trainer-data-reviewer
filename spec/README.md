# Specs

`npm test` needs no `npm install`.

```bash
npm test
```

## Sample data

`fixtures/sample/` holds a small synthetic data folder that the repository tracks:

- `Exercises.json`: 17 exercises, Pause included
- `skillTrees/BAS.json`: ends with a newline
- `skillTrees/SKKG.json`: ends without a newline
- `skillTrees/SUPPORT.json`: the empty `"{\n\n}"` file

Exercise 14 carries one planted violation, a non-boolean `isJump`, which `schema.spec.js` finds. The unit specs run against the sample. `exercises-only.spec.js` loads the sample `Exercises.json` without the skill trees, as the app does.

## Real data

Some specs check the real data folder: the byte round trip of all 28 files, the pinned counts (1,210 exercises, 852 branches, 436 orphans) and replay on the real catalog. The repository never tracks the real data, because the trainer loads it in the app.

The real-data specs read the folder from the environment variable `CDR_DATA_DIR`. It defaults to `spec/fixtures/real/generator`, which `.gitignore` excludes. When the folder is missing, the runner skips these specs with the note "real data not present: set CDR_DATA_DIR".

To run them, either:

1. copy the data folder `generator` (with `Exercises.json` and `skillTrees/`) into `spec/fixtures/real/`, then run `npm test`, or
2. point the variable at the folder: `CDR_DATA_DIR=/path/to/generator npm test`.

The real-data spec in `changelog.spec.js` also checks that the pinned counts in `js/core/config.js` still match the data.
