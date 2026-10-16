// Repository specific values. Update this file when the app moves to another
// repository or when the developer changes a pinned test.

/**
 * Folder in the target repository that holds Exercises.json and the skillTrees folder.
 * The welcome screen, the error texts, the export and the changelog build file paths from it.
 */
export const DATA_TARGET_PATH = 'athlete-mobile/assets/data/generator';

/** Database table that stores per-athlete exercise and branch ids. */
export const ATHLETE_DATA_TABLE = 'user_exercises';

/**
 * Tests in the target repository that pin counts of the data. The changelog
 * names them when an edit changes a pinned value.
 */
export const PINNED_TESTS = Object.freeze({
  exerciseRegistry: Object.freeze({
    file: 'athlete-mobile/src/data/exerciseRegistry.spec.ts',
    exerciseCount: 1210,
    pauseLine: '90',
    quadricepsTag: 'MUSCLE_QUADRICEPS',
    quadricepsCount: 418,
    quadricepsLine: '97'
  }),
  skillTreeRegistry: Object.freeze({
    file: 'athlete-mobile/src/data/skillTreeRegistry.spec.ts',
    countedTree: 'BAS',
    countedTreeBranches: 19,
    countedTreeLine: '59',
    pinnedBranchId: '548',
    pinnedBranchLines: '64-72'
  })
});
