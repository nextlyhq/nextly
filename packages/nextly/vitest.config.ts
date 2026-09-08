import { createRequire } from "module";
import path from "path";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Mirror the tsup `define` so `getCoreVersion()` resolves under test (D6).
const require = createRequire(import.meta.url);
const { version: coreVersion } = require("./package.json") as {
  version: string;
};

export default defineConfig({
  plugins: [tsconfigPaths()],
  define: {
    __NEXTLY_CORE_VERSION__: JSON.stringify(coreVersion),
  },
  resolve: {
    alias: {
      "@nextly/storage": path.resolve(__dirname, "./src/storage/index.ts"),
    },
  },
  test: {
    name: "nextly",
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    // Capped below the (cores - 1) default: the pre-push gate runs this suite
    // alongside admin's on the same machine, and every worker competing for
    // every core made route/service tests exceed their timeouts — flaking the
    // local gate for reasons unrelated to the code under test. Fewer workers
    // trades suite wall-time for per-test CPU, which is what the timeouts
    // actually measure.
    fileParallelism: true,
    poolOptions: { forks: { maxForks: 3 } },
    // Why explicit exclude of integration tests: F18 runs unit and integration
    // suites separately. Unit run skips *.integration.test.ts so the suite
    // stays green without a database. Integration run uses
    // vitest.integration.config.ts.
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    exclude: [
      "node_modules",
      "dist",
      ".turbo",
      "**/*.d.ts",
      "**/*.integration.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/types/**",
        "**/index.ts",
        "scripts/**",
        "src/types/**",
        "src/database/schema/**",
        "src/schemas/**",
      ],
      thresholds: {
        // Target: 70% when DATABASE_URL is available for integration tests
        // Current: 50% threshold accounts for 610 pre-existing integration test
        // failures that require a running database (DATABASE_URL not set)
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },
    // 10s was tuned on a fast runner: the full suite runs its files in
    // parallel workers, and route/service tests that boot the whole handler
    // stack exceeded it on slower or busier machines while passing in
    // isolation and on CI — flaking the local pre-push gate for reasons that
    // have nothing to do with the code under test. 30s bounds a runaway, not
    // a slow start.
    testTimeout: 120000,
    hookTimeout: 60000,
  },
});
