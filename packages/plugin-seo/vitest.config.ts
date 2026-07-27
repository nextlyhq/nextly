import { defineConfig } from "vitest/config";

// The `*.integration.test.ts` suites boot a real Nextly instance per test via
// `createTestNextly` (DI container + schema registry + in-memory SQLite). A
// single boot is sub-second in isolation, but under the monorepo's parallel
// `Test` step the runner saturates and a boot can exceed Vitest's 5s default.
// Give the integration tests the headroom they legitimately need; fast unit
// tests are unaffected.
export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
