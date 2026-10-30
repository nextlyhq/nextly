import { defineConfig } from "vitest/config";

// Unit suites only; the integration lane, which boots Nextly, has its own
// config.
export default defineConfig({
  // The package's tsconfig sets no `jsx`, so the transform would otherwise
  // compile a test's JSX to `React.createElement` with no `React` in scope.
  esbuild: { jsx: "automatic" },
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    // `.tsx` for the tests that render the admin entry's components; those
    // files choose a DOM environment for themselves, so the rest stay in Node.
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
    // A suite loads this package's built entry, and suites are collected in
    // parallel — so a missing build has to stop the run before collection
    // starts rather than inside any one suite. See the setup file.
    globalSetup: ["./vitest.global-setup.ts"],
  },
});
