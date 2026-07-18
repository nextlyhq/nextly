import { defineConfig } from "vitest/config";

// Several suites here (`*.integration.test.ts`) boot a full Nextly instance
// per test via `createTestNextly` (DI container + schema registry + an
// in-memory SQLite DB). A single boot is ~700ms, but when the whole package
// runs in parallel with the rest of the monorepo's `Test` step the CI runner
// saturates and individual tests occasionally exceed Vitest's 5s default —
// an intermittent, environment-only timeout (each suite passes in isolation).
// Give these integration tests the headroom they legitimately need; fast unit
// tests finishing in milliseconds are unaffected.
export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
