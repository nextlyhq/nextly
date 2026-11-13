import { defineConfig } from "vitest/config";

// Integration tests for the playground's fixture plugins: they run the real
// `nextly` command against a real database on each dialect, so they stay out
// of `vitest.config.ts`, whose unit run has no database. Each dialect's server
// is read from TEST_POSTGRES_URL / TEST_MYSQL_URL, as in every package's
// integration run.
export default defineConfig({
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    name: "playground-integration",
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    // Each step spawns the `nextly` command, which loads the config and opens
    // the database afresh.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // A file's steps share one database and run in order.
    fileParallelism: false,
  },
});
