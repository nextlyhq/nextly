// Integration test config for nextly. Runs only *.integration.test.ts files.
// Why a separate config: integration tests need real DB connections, longer
// timeouts, and isolated runs from unit tests. F18 introduced this split.

import path from "path";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@nextly/storage": path.resolve(__dirname, "./src/storage/index.ts"),
    },
  },
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    name: "nextly-integration",
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    // Prints the run's transaction escapes, grouped by call site, at its end.
    globalSetup: ["./src/__tests__/transaction-escapes-inventory.ts"],
    include: ["src/**/*.integration.test.ts"],
    exclude: ["node_modules", "dist", ".turbo", "**/*.d.ts"],
    // Why longer timeouts: integration tests do real DB I/O, schema setup,
    // and teardown. 30s gives Neon-style cold starts plus per-test schema
    // creation room to breathe.
    testTimeout: 30000,
    hookTimeout: 30000,
    // Why singleFork: per-test schema isolation handles concurrency, but
    // running multiple test files against the same container in parallel
    // can saturate connections. Sequential is conservative; we can revisit
    // with parallel forks later if the runtime becomes a bottleneck.
    // One worker: Vitest 4 removed `poolOptions.forks.singleFork` and ignores
    // it; `maxWorkers: 1` is its replacement. Each file keeps its own module
    // graph (the default isolation), as it did inside the single fork.
    pool: "forks",
    maxWorkers: 1,
    // singleFork keeps everything in one process, but vitest still interleaves
    // test files within it by default. The suites that exercise system tables
    // with a fixed name (`nextly_schema_events`) cannot use the per-file table
    // prefix, so two of them running at once drop and recreate the same table
    // out from under each other. Running files sequentially is the "conservative"
    // behavior the note above intends and makes that class of collision
    // impossible.
    fileParallelism: false,
  },
});
