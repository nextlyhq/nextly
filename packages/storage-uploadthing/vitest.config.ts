import { defineConfig } from "vitest/config";

/*
 * This package's own config. Vitest 5 no longer looks in parent folders for
 * one, so without it the package ran with no config at all, where Vitest 4
 * had found the repository root's.
 *
 * The budgets are the root config's, which these tests ran under before.
 */
export default defineConfig({
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
