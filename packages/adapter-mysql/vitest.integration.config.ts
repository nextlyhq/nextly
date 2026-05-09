// Integration test config for adapter-mysql.
// Why a separate config: integration tests need real DB connections, longer
// timeouts, and isolated runs from unit tests. F18 introduced this split.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    exclude: ["node_modules", "dist", ".turbo"],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
