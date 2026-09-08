import { defineConfig } from "vitest/config";

// Unit suites only. The `*.integration.test.ts` files boot a real Nextly
// instance per test via `createTestNextly` (DI container + schema registry +
// in-memory SQLite), which is not what the `test` task is sized for: turbo runs
// it across every package at once, and a boot competing with the rest of the
// monorepo took a case to 30556ms on CI while the same file finishes in about
// 1.6s in isolation. Raising the budget was the previous answer here, and it
// has now been exceeded, so the suites move to their own task instead — the
// split `nextly`, the three adapters, `plugin-page-builder` and `plugin-seo`
// already use.
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/**/*.integration.test.ts",
    ],
    // The component suites here render React under jsdom, which is heavier than
    // the node unit tests vitest's 5s default is sized for. This package
    // carried a 30s budget until the integration suites moved out, and that
    // budget was covering these too: without it `ConditionalLogicEditor` took
    // 5399ms on a loaded CI runner and failed on the default, turning `main`
    // red. Set to the value `@nextlyhq/admin` already uses for the same class
    // of test rather than a number picked here, and kept apart from the 30s the
    // integration config carries, which is sized for an instance boot.
    testTimeout: 10_000,
    // Component suites request jsdom per file (`@vitest-environment jsdom`)
    // rather than switching it on globally. This setup only fills in globals
    // jsdom lacks, so it is inert for the node ones.
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
