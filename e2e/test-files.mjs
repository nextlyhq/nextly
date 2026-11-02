import { globSync } from "node:fs";
import { sep } from "node:path";

/**
 * Every file under `e2e/` that Playwright's default `testMatch` takes as a
 * test file, as repository paths.
 *
 * The default is `**\/*.@(spec|test).?(c|m)[jt]s?(x)`: `.spec` or `.test`, in
 * any of TypeScript's and JavaScript's module suffixes, with or without JSX.
 * Read by `scripts/e2e-specs-take-suite-test.test.mjs`, which holds each of
 * them to the suite's `test`, without loading a single spec, since it runs
 * before the packages specs import are built. Every config's own `--list` is
 * held to this set by `tests/test-files-listed.test.ts`, so a config that
 * runs a file outside it fails there.
 *
 * @param {string} repoRoot the repository's root directory
 * @returns {string[]}
 */
export function e2eTestFiles(repoRoot) {
  return globSync("e2e/**/*.{spec,test}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}", {
    cwd: repoRoot,
  })
    .map(file => file.split(sep).join("/"))
    .filter(
      file =>
        !file.includes("/node_modules/") && !file.includes("/.playwright/")
    )
    .sort();
}
