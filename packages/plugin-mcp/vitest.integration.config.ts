// Integration config for the MCP plugin. Runs only `*.integration.test.ts`.
//
// Mirrors the split in `nextly`, `plugin-form-builder`, `plugin-page-builder`
// and `plugin-seo`: these boot a real Nextly instance and reach the endpoint
// through the dispatcher that actually serves it, so they need a budget a unit
// default cannot give them and they must not compete with the parallel unit
// step for the runner.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "plugin-mcp-integration",
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each test boots its own instance against a shared in-memory database, so
    // the files cannot safely interleave.
    fileParallelism: false,
  },
});
