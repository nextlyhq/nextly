// Integration test config for nextly. Runs only *.integration.test.ts files.
// Why a separate config: integration tests need real DB connections, longer
// timeouts, and isolated runs from unit tests. F18 introduced this split.

import path from "path";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@nextly/storage": path.resolve(__dirname, "./src/storage/index.ts"),
    },
  },
  test: {
    name: "nextly-integration",
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.integration.test.ts"],
    exclude: ["node_modules", "dist", ".turbo", "**/*.d.ts"],
    // Why longer timeouts: integration tests do real DB I/O, schema setup,
    // and teardown. 30s gives Neon-style cold starts plus per-test schema
    // creation room to breathe.
    testTimeout: 30000,
    hookTimeout: 30000,
    // Why singleFork: per-test schema isolation handles concurrency, but
    // running multiple test files against the same container in parallel
    // can saturate connections. Sequential is conservative; we can revisit
    // with parallel forks later if the runtime becomes a bottleneck.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
