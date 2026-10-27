import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    include: ["src/**/*.{test,spec}.ts"],
    // The integration lane owns these; running them here too would boot a real
    // instance inside the parallel unit step.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/**/*.integration.test.ts",
    ],
  },
});
