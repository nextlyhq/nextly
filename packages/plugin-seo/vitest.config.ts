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
    include: ["src/**/*.{test,spec}.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/**/*.integration.test.ts",
    ],
  },
});
