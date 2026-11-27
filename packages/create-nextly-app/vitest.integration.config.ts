import { defineConfig } from "vitest/config";

// The connection test against real servers: the PostgreSQL and MySQL test
// containers, named by TEST_POSTGRES_URL and TEST_MYSQL_URL as the root
// `test:integration:*` scripts and the CI lanes set them. A file whose server
// is not named skips its cases.
export default defineConfig({
  test: {
    experimental: { recordDependencies: true },
    name: "create-nextly-app-integration",
    include: ["src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    // The CI lanes shard every package's suite; this one has fewer files
    // than shards, so a shard with none of them passes.
    passWithNoTests: true,
  },
});
