// Integration test config for the page-builder plugin. Runs only
// *.integration.test.ts files.
//
// Why a separate config, mirroring core's: these boot a real Nextly against a
// database, so they need longer timeouts and must not run in the unit job,
// where no database is provisioned. A suite covering a field type's storage is
// per-dialect by nature — Postgres stores `jsonb`, MySQL `json`, SQLite `text`,
// and each parses on read differently — so it has to be runnable against each.

import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    name: "plugin-page-builder-integration",
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Real database I/O, schema setup and teardown, so the unit default is
    // far too tight.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // System tables are shared, so suites cannot safely interleave.
    fileParallelism: false,
  },
});
