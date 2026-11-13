import { defineConfig } from "vitest/config";

// Vitest config for playground-internal tooling. Discovers unit tests under
// scripts/__tests__/ for the dev-experience helpers (doctor, seed, reset).
//
// Default environment stays "node": some fixtures here assert that a module
// throws when it detects a browser-like global (`window`), which a blanket
// jsdom environment would defeat. A suite needing DOM APIs opts into jsdom
// itself via a `// @vitest-environment jsdom` docblock rather than changing the
// default for every other one.
export default defineConfig({
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    globals: false,
    environment: "node",
    // The upgrade gate's own units beside it; its gate needs a database, so it
    // runs in the integration config.
    include: ["scripts/__tests__/**/*.test.ts", "upgrade-gate/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
