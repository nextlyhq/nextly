// Integration tests for the plugin SDK. Runs only *.integration.test.ts
// files: they boot a real Nextly through the SDK's own harness, so they need
// longer timeouts and must not run in the unit job.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "plugin-sdk-integration",
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // A real boot, schema setup and teardown.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The harness resets process-wide registries, so suites cannot interleave.
    fileParallelism: false,
  },
});
