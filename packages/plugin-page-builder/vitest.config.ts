import { defineConfig } from "vitest/config";

// React JSX in tests uses the automatic runtime; renderToStaticMarkup runs in node.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "node",
    // Unit tests live in src/. The Playwright e2e/ suite runs separately (needs a live
    // playground + browser) and must not be collected by vitest.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Integration tests boot a real Nextly against a database and have their
    // own config, exactly as core's split does. Collected here they would run
    // in the unit job, where no database is provisioned.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/**/*.integration.test.ts",
    ],
    // Runs fresh inside EACH test file's own resolved environment, which is
    // what lets one file serve both the node suites and the jsdom ones — see
    // the guard it opens with.
    setupFiles: ["../../scripts/vitest-dom-setup.ts"],
  },
});
