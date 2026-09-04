import { defineConfig } from "vitest/config";

// Unit suites only. The `*.integration.test.ts` files boot a real Nextly via
// `createTestNextly` and drive a full authorize/callback/login round trip
// against a fake identity provider, which is not what the `test` task is sized
// for: turbo runs it across every package at once. Same split as `nextly`, the
// three adapters, `plugin-seo` and `plugin-page-builder`.
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
