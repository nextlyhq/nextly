import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "module";
import path from "path";

import tsconfigPaths from "vite-tsconfig-paths";
import { configDefaults, defineConfig } from "vitest/config";

// Mirror the tsdown `define` so `getCoreVersion()` resolves under test (D6).
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
 * - a call to a `reset…` or `clear…` function other than Vitest's own: what it
 *   empties is state another file in the worker may depend on, as when a file
 *   cleared the release-check registry a shared helper had filled at import
 *   and the next file's releases found no checks registered;
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
    String.raw`(?<!vi\.)\b(?:reset|clear)[A-Z]\w*\(`,
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

/**
 * Unit files that change one of nextly's global singletons through the code
 * under test, named by the singleton they change. Nothing in their source says
 * so where the patterns above can see it. `shared-module-guards.ts` is what
 * finds them: it puts every singleton back after each shared file, and fails a
 * file that changed one already there when it started. So a new one is either
 * restored by its own tests or listed here.
 */
const CHANGES_GLOBAL_SINGLETONS = [
  // __nextly_eventBus
  "src/auth/handlers/__tests__/register-allow-registration.test.ts",
  "src/auth/handlers/__tests__/session-roles-read-failure.test.ts",
  "src/auth/handlers/__tests__/session-row-lock.test.ts",
  "src/plugins/plugin-config-view.test.ts",
  "src/plugins/plugin-singles.test.ts",
  // __nextly_webhookActivation
  "src/domains/media/__tests__/media-folder.test.ts",
  "src/domains/media/__tests__/media-service-edge-cases.test.ts",
  "src/domains/singles/__tests__/single-virtual-field.test.ts",
  // __nextlyFieldFunctionRegistry
  "src/auth/principal-scope.test.ts",
  // __nextly_container
  "src/di/registrations/__tests__/register-users-boot.test.ts",
  "src/domains/media/__tests__/revalidate-media.test.ts",
  // __nextly_emailProviderRegistry
  "src/domains/email/__tests__/built-in-descriptors.test.ts",
  "src/domains/email/__tests__/is-configured.test.ts",
  "src/domains/email/__tests__/provider-callback-failures.test.ts",
  // __nextly_eventBus
  "src/domains/media/__tests__/media-events.test.ts",
  // __nextly_pluginRouteRegistry
  "src/plugins/routes/route-registry.test.ts",
  // __nextly_pluginSubscriptions
  "src/hooks/__tests__/hook-registry-provenance.test.ts",
  // __nextly_systemResolvers, __nextly_widgetDeferredEntities, __nextly_widget_sources, __nextly_widgets
  "src/di/__tests__/register-widgets.test.ts",
  // __nextly_systemResolvers, __nextly_widget_sources, __nextly_widgets
  "src/__tests__/init.test.ts",
  // __nextly_webhookRecordingPolicy
  "src/domains/collections/__tests__/collection-registry-service.localized-persist.test.ts",
  "src/domains/collections/__tests__/collection-registry-service.status-persist.test.ts",
  "src/domains/dynamic-collections/services/__tests__/dynamic-collection-registry-service.status-persist.test.ts",
  "src/domains/singles/__tests__/single-registry-service.test.ts",
  // __nextly_widget_sources
  "src/domains/widgets/__tests__/built-in-sources.test.ts",
  "src/domains/widgets/__tests__/query-limits.test.ts",
  "src/domains/widgets/__tests__/query.test.ts",
  // __nextly_widgets
  "src/domains/widgets/__tests__/canonical.test.ts",
  "src/domains/widgets/__tests__/dismissible.test.ts",
  "src/domains/widgets/__tests__/publish.test.ts",
];

/**
 * Files that need their own module graph for state the guard cannot see:
 * module-local registries, and files that failed when run after others in a
 * shared worker although no singleton on `globalThis` changed.
 *
 * `shared-module-guards.ts` reads only `globalThis`, so this list is kept by
 * hand. The nightly shuffled-order run (`Unit test order`) is what finds a new
 * entry for it.
 */
const KEEPS_MODULE_STATE = [
  // Registers a baseline in the module-local Map in `comparison-baselines.ts`.
  "src/domains/versions/__tests__/comparison-baselines.test.ts",
  // Failed with an internal error in place of CONFLICT after other files in
  // one shuffled order each (seeds 57, 101 and 505); no global had changed.
  "src/domains/releases/__tests__/blocking-reasons.test.ts",
  "src/domains/releases/__tests__/readiness-refusals.test.ts",
  "src/domains/releases/__tests__/releases-service.test.ts",
];

const isolatedFiles = [
  ...new Set([
    ...filesThatLeaveState(),
    ...CHANGES_GLOBAL_SINGLETONS,
    ...KEEPS_MODULE_STATE,
  ]),
];

/** The repository's starter projects, as a path prefix with forward slashes. */
const TEMPLATES = `${path.resolve(__dirname, "../../templates").split(path.sep).join("/")}/`;

/**
 * This package's source for the names a template imports nextly by, for files
 * under `templates/` only. A unit test may load a template's own code (the blog
 * template's migration guard builds its collections), and a template has no
 * `node_modules` of its own to find nextly in. A file anywhere else resolves
 * these names as before.
 */
const TEMPLATE_IMPORTS: Record<string, string> = {
  nextly: path.resolve(__dirname, "./src/index.ts"),
  "nextly/config": path.resolve(__dirname, "./src/config.ts"),
};

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    {
      name: "nextly-for-templates",
      enforce: "pre",
      resolveId(source, importer) {
        const from = importer?.split("?")[0].split(path.sep).join("/");
        if (!from?.startsWith(TEMPLATES)) return null;
        return TEMPLATE_IMPORTS[source] ?? null;
      },
    },
  ],
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
    // Vitest's own reporters for wherever this runs (GitHub's annotations in
    // CI), plus the module budget, which reads the records above at the end
    // of a whole-suite run and fails it when the suite has grown heavier.
    reporters: [
      ...configDefaults.reporters,
      "./src/__tests__/module-budget-reporter.ts",
    ],
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    // Capped below the (cores - 1) default: the pre-push gate runs this suite
    // alongside admin's on the same machine, and every worker competing for
    // every core made route/service tests exceed their timeouts — flaking the
    // local gate for reasons unrelated to the code under test. Fewer workers
    // trades suite wall-time for per-test CPU, which is what the timeouts
    // actually measure.
    // `maxWorkers`, not `poolOptions.forks.maxForks`: Vitest 4 removed
    // `poolOptions` and ignores it, so the cap above had silently stopped
    // applying and a plain `pnpm test` took a worker per core.
    fileParallelism: true,
    maxWorkers: 3,
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
          // Projects run at the same time unless ordered, each with its own
          // workers, so the shared workers and the isolated ones would add up
          // past what `local-limits` sized for. This one runs first and
          // finishes before the isolated project starts.
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "nextly (isolated)",
          include: isolatedFiles,
          sequence: { groupOrder: 1 },
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
