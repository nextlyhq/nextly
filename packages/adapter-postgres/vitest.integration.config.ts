// Integration test config for adapter-postgres.
// Why a separate config: integration tests need real DB connections, longer
// timeouts, and isolated runs from unit tests. F18 introduced this split.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    exclude: ["node_modules", "dist", ".turbo"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // One file at a time on one worker, against the one test database.
    // `poolOptions.forks.singleFork` did this before Vitest 4, which removed
    // `poolOptions` and ignores it, so files could run in parallel.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
