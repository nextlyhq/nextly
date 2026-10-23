import { defineConfig } from "vitest/config";

// Unit suites only: the suites that boot a Nextly instance against a database
// are *.integration.test.ts, run by vitest.integration.config.ts.
export default defineConfig({
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    include: ["src/**/*.{test,spec}.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/**/*.integration.test.ts",
    ],
  },
});
