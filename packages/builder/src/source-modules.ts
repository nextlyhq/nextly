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
 * `.mts` and `.cts` are here because both tools resolve them. A module written
 * with either extension is a module the bundler follows, so a list omitting
 * them leaves that file invisible to every check in this package.
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

/**
 * Every module beneath a directory, found by one rule.
 *
 * Both guards in this package walk `src` looking for files to inspect, and each
 * had its own copy of this loop. Two walks can diverge in ways the shared
 * extension list cannot prevent — one skipping a directory, one matching on a
 * different part of the path — and a guard that walks past a file reports clean
 * about code it never read.
 *
 * Reading the directory is INJECTED rather than imported, so this module keeps
 * importing nothing: a `node:fs` import here would put a Node dependency inside
 * `src`, where the layering guard is entitled to refuse it. The caller supplies
 * the two functions; the rule about what counts and where to recurse lives here.
 */
export function collectModules(
  dir: string,
  readdir: (
    at: string
  ) => ReadonlyArray<{ name: string; isDirectory: () => boolean }>,
  join: (...parts: string[]) => string
): string[] {
  const out: string[] = [];
  for (const entry of readdir(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectModules(full, readdir, join));
    else if (BUNDLED_MODULE.test(entry.name)) out.push(full);
  }
  return out;
}
