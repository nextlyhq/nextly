import { defineConfig } from "vitest/config";

// The engine is plain Node with no globals: tests import from vitest explicitly
// and run in the node environment, scoped to this package's own src suites.
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
