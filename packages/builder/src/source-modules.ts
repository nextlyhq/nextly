/**
 * Which files count as modules, and which of those are tests, as one answer
 * everything in this package asks.
 *
 * Three separate things need to agree here, and each was written with its own
 * copy of the answer:
 *
 * - the layering guard and the geometry-ownership guard each WALK `src` looking
 *   for files to inspect;
 * - the layering guard also CLASSIFIES what it finds, because a test file may
 *   import `vitest` and `node:fs` while a shipped module may not;
 * - `vitest.config.ts` decides which files actually RUN as tests.
 *
 * Two copies of "what counts as a source module" drift the moment TypeScript
 * grows an extension — and a guard that walks past a file reports clean about
 * code it never read, which is the failure mode both guards exist to prevent.
 *
 * The classification copy fails in a nastier direction, and it is why the
 * extension list is not merely shared but drives the vitest globs too. Widening
 * only the guard's idea of a test name grants a file test PRIVILEGES without
 * test EXECUTION: `probe.test.mts` would be allowed to import `vitest`, and
 * vitest would never run it, because a glob of `src/**\/*.test.ts` does not
 * match a `.mts` file. A shipped module could then reach anything it liked by
 * choosing its filename. Deriving both from this list keeps the two definitions
 * of "test" the same definition.
 *
 * The extensions are listed rather than pattern-matched. The pattern this
 * replaced (`[cm]?tsx?`) also admitted `.mtsx` and `.ctsx`, which TypeScript
 * does not recognise, so it was matching names no compiler would ever follow.
 *
 * This module imports nothing on purpose. It is reached from test files and
 * from the vitest config, and a shared helper that pulled in `node:fs` would put
 * a Node import inside `src` where the layering guard is entitled to refuse it.
 */

/**
 * The extensions TypeScript and tsup follow.
 *
 * `.mts` and `.cts` are here because both tools resolve them. They were missing
 * from every copy of this list, so a module written with either extension was
 * invisible to every check in this package.
 */
const MODULE_EXTENSIONS = [
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
] as const;

const ANY_EXTENSION = MODULE_EXTENSIONS.join("|");

/** A file the bundler will follow, and therefore one a guard must read. */
export const BUNDLED_MODULE = new RegExp(`\\.(?:${ANY_EXTENSION})$`);

/**
 * A file that runs as a test, and may therefore import test-only tooling.
 *
 * Matches exactly what {@link TEST_GLOBS} tells vitest to run. Keeping the two
 * derived from one list is what stops the guard trusting a file the runner
 * ignores.
 */
export const TEST_MODULE = new RegExp(`\\.test\\.(?:${ANY_EXTENSION})$`);

/** The same set as {@link TEST_MODULE}, in the form `vitest.config.ts` takes. */
export const TEST_GLOBS = MODULE_EXTENSIONS.map(ext => `src/**/*.test.${ext}`);
