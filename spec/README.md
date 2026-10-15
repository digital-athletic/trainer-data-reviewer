# Specs

Run all specs with Node's built-in test runner. The app has no dependencies, so nothing needs installing.

```bash
npm test
```

## Sample data

`fixtures/sample/` holds a small synthetic data folder that the repository tracks:

- `Exercises.json`: 17 exercises, Pause included
- `skillTrees/BAS.json`: ends with a newline
- `skillTrees/SKKG.json`: ends without a newline
- `skillTrees/SUPPORT.json`: the empty `"{\n\n}"` file

The sample also holds records with planted problems, for example exercise 14 with a broken `isJump` flag that `schema.spec.js` finds. The unit specs run against the sample.

## Real data

Some specs check the real data folder: the byte round trip of all 28 files, the pinned counts (1,210 exercises, 852 branches, 436 orphans) and replay on the real catalog. The repository never tracks the real data, because the trainer loads it in the app.

The real-data specs read the folder from the environment variable `CDR_DATA_DIR`. It defaults to `spec/fixtures/real/generator`, which `.gitignore` excludes. When the folder is missing, the runner skips these specs with the note "real data not present: set CDR_DATA_DIR".

To run them, either:

1. copy the data folder `generator` (with `Exercises.json` and `skillTrees/`) into `spec/fixtures/real/`, then run `npm run test:real`, or
2. point the variable at the folder: `CDR_DATA_DIR=/path/to/generator npm run test:real`.

The real-data spec in `changelog.spec.js` also checks that the pinned counts in `js/core/config.js` still match the data.
