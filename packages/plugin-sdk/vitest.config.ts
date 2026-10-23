import { defineConfig } from "vitest/config";

// Unit suites only; the integration lane, which boots Nextly, has its own
// config.
export default defineConfig({
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
  },
});
