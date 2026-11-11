import { defineConfig } from "vitest/config";

// Unit suites only. The `*.integration.test.ts` files boot a real Nextly
// instance per test via `createTestNextly` (DI container + schema registry +
// in-memory SQLite), which is not what the `test` task is sized for: turbo runs
// it across every package at once, and a boot competing with seventeen other
// suites took a case past 30s on CI while the same file finishes in about 1.5s
// of test time in isolation. Raising the budget was the previous answer and it
// has now been exceeded twice, so the suites move to their own task instead —
// the split `nextly`, the three adapters and `plugin-page-builder` already use.
export default defineConfig({
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/**/*.integration.test.ts",
    ],
    // The SEO tab's suites render React under jsdom, asked for per file
    // (`@vitest-environment jsdom`), which is heavier than the node suites
    // the 5s default is sized for; the value the other admin suites use.
    testTimeout: 10_000,
    // Fills in what jsdom lacks; inert for the node suites.
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
