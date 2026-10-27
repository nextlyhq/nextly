// Integration tests for the plugin SDK. Runs only *.integration.test.ts
// files: they boot a real Nextly through the SDK's own harness, so they need
// longer timeouts and must not run in the unit job.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    name: "plugin-sdk-integration",
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // A real boot, schema setup and teardown.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The harness resets process-wide registries, so suites cannot interleave.
    fileParallelism: false,
    // The SQLite integration leg hands every package of its lane the same
    // `--shard`, and vitest refuses a shard count above a package's number of
    // test files unless it may pass with none. This suite has fewer files
    // than shards, so the shard that gets no file passes empty.
    passWithNoTests: true,
  },
});
