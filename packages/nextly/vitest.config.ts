import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "module";
import path from "path";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Mirror the tsup `define` so `getCoreVersion()` resolves under test (D6).
const require = createRequire(import.meta.url);
const { version: coreVersion } = require("./package.json") as {
  version: string;
};

/**
 * What a test file uses that leaves state behind for the next file in its worker.
 *
 * Unit files run in two projects. Most share a worker's module graph
 * (`isolate: false`), so a module the suite imports a thousand times is
 * evaluated once per worker instead of once per file: loading modules is most
 * of this suite's time. A file that changes what it shares with the next one
 * keeps a module graph of its own:
 * - module mocks, and anything that resets or reads the real module behind one;
 * - spies, stubbed globals or environment, and fake timers, which outlive the
 *   file unless it restores them;
 * - writes to `process.env` or to a global;
 * - a real SQLite database.
 *
 * Read from each file's source when the config loads, so a file that starts
 * using one of these moves to the isolated project by itself.
 */
const LEAVES_STATE = new RegExp(
  [
    String.raw`\bvi\.(?:mock|doMock|unmock|doUnmock|hoisted|resetModules|importActual|importMock|stubGlobal|stubEnv|spyOn|useFakeTimers|setSystemTime)\b`,
    String.raw`process\.env(?:\.\w+|\[[^\]]+\])\s*(?:=(?!=)|\?\?=|\|\|=)`,
    String.raw`\bdelete\s+process\.env\b`,
    String.raw`\b(?:globalThis|global|window)(?:\.\w+|\[[^\]]+\])\s*=(?!=)`,
    String.raw`better-sqlite3|createTestNextly|:memory:`,
  ].join("|")
);

const UNIT_FILE = /\.(?:test|spec)\.ts$/;

/** The unit files that keep a module graph of their own, relative to this folder. */
function filesThatLeaveState(): string[] {
  return readdirSync(path.join(__dirname, "src"), { recursive: true })
    .map(file => path.join("src", String(file)).split(path.sep).join("/"))
    .filter(
      file =>
        UNIT_FILE.test(file) &&
        !file.endsWith(".integration.test.ts") &&
        LEAVES_STATE.test(readFileSync(path.join(__dirname, file), "utf8"))
    );
}

const isolatedFiles = filesThatLeaveState();

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
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
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
    exclude: [
      "node_modules",
      "dist",
      ".turbo",
      "**/*.d.ts",
      "**/*.integration.test.ts",
    ],
    // Inline projects inherit everything above and merge their arrays into
    // it, so `include` is per project and `exclude` is shared.
    projects: [
      {
        extends: true,
        test: {
          name: "nextly",
          include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
          exclude: isolatedFiles,
          isolate: false,
          setupFiles: ["./src/__tests__/shared-module-guards.ts"],
          // A worker keeps every module its files load: about 1.2 GB live once
          // it has run the files that reach nextly's service graph. V8 lets a
          // heap grow well past that before collecting, to about 2.9 GB
          // resident in one worker; capped at 2 GB it stays near 2.3 GB, every
          // file order tried passes, and a 1.5 GB cap ran out of memory.
          execArgv: ["--max-old-space-size=2048"],
        },
      },
      {
        extends: true,
        test: {
          name: "nextly (isolated)",
          include: isolatedFiles,
        },
      },
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
