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
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
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
    // The settings screen's suites render React under jsdom, which each such
    // file asks for itself (`@vitest-environment jsdom`), so the node suites
    // stay in node. Rendering through the admin's components is heavier than
    // the 5s default is sized for on a loaded runner.
    testTimeout: 10_000,
    // The shared DOM setup tears renders down between cases; the second gives
    // jsdom the globals the admin bundle needs at import time.
    setupFiles: [
      "../../scripts/vitest-dom-setup.ts",
      "./src/admin/__tests__/dom-setup.ts",
    ],
  },
});
