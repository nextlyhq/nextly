// Integration tests for the accounts plugin. Runs only *.integration.test.ts
// files: they boot a real Nextly against a database on each dialect, so they
// need longer timeouts and must not run in the unit job, where no database is
// provisioned.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    name: "plugin-accounts-integration",
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Real database I/O, schema setup and teardown.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // System tables are shared, so suites cannot safely interleave.
    fileParallelism: false,
  },
});
