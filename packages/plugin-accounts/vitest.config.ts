import { defineConfig } from "vitest/config";

// Unit suites only; the integration lane, which boots Nextly on each dialect,
// has its own config. The admin screens' suites render React under jsdom,
// which each such file asks for itself (`@vitest-environment jsdom`), so the
// node suites stay in node.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
    // Rendering through the admin's own components is heavier than vitest's
    // 5s default is sized for on a loaded runner; the admin package uses the
    // same budget for the same kind of test.
    testTimeout: 10_000,
    // The shared DOM setup tears renders down between cases; the second
    // gives jsdom the globals the admin bundle needs at import time.
    setupFiles: [
      "../../scripts/vitest-dom-setup.ts",
      "./src/test-support/dom-setup.ts",
    ],
  },
});
