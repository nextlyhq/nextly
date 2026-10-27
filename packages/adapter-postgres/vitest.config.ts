// Unit test config for adapter-postgres.
// Why explicit config: F18 splits tests into unit (*.test.ts excluding
// .integration.test.ts) and integration (*.integration.test.ts only).

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", ".turbo", "**/*.integration.test.ts"],
  },
});
