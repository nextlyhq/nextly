// The import cycles `packages/nextly/src` still has, and the rule that keeps
// any other from forming. `oxlint.config.mjs` turns `import/no-cycle` on for
// the package's source and off for the files listed here;
// `scripts/lint-config.test.mjs` runs the rule over every file and holds the
// cycles it finds to exactly these groups.
//
// The list only shrinks. A file that leaves its cycle fails that test until it
// is removed here, so a cycle broken once cannot quietly re-form behind the
// exemption it no longer needs. A file that joins a cycle is reported by the
// lint itself; two listed cycles merging, which no per-file exemption can see,
// fails the test as a changed group.
//
// What these guards hold is which files are on a cycle and how the cycles
// group, not each import between them. A new import between two files already
// in one group adds a cycle inside it and passes: it puts no file newly on a
// cycle, and the group already loads as one unit. Telling it apart would take
// the import edges themselves, which oxlint does not report.

/** Where the rule applies, relative to the repository root. */
export const NEXTLY_SOURCE = "packages/nextly/src";

/**
 * The rule's setting, shared by the configuration and the test that measures
 * the cycles. Type-only imports load nothing at runtime, so they close no cycle
 * that matters, and `ignoreTypes` leaves them out.
 *
 * Dynamic imports are not exempted here: `allowUnsafeDynamicCyclicDependency`
 * would exempt a cycle through any `import()`, a top-level `await import()`
 * that runs while the module loads included. oxlint 1.89 leaves every dynamic
 * import out of the cycles it reports whatever this says. The harm such a
 * cycle can do is a deadlock, which needs the module to wait on the import, so
 * `nextly/no-top-level-await` refuses the wait; an `import()` the module does
 * not wait on stays allowed and invisible to this rule.
 */
export const NO_CYCLE = [
  "error",
  { ignoreTypes: true, allowUnsafeDynamicCyclicDependency: false },
];

/** Each cycle as its member files, relative to `NEXTLY_SOURCE`. */
export const IMPORT_CYCLES = [
  // The CLI's program and the commands it registers, each of which imports
  // the program back.
  [
    "cli/commands/add.ts",
    "cli/commands/build.ts",
    "cli/commands/db-sync.ts",
    "cli/commands/generate-manifest.ts",
    "cli/commands/generate-types.ts",
    "cli/commands/i18n-restore.ts",
    "cli/commands/init.ts",
    "cli/commands/migrate-baseline.ts",
    "cli/commands/migrate-check.ts",
    "cli/commands/migrate-create.ts",
    "cli/commands/migrate-down.ts",
    "cli/commands/migrate-field-groups.ts",
    "cli/commands/migrate-fresh.ts",
    "cli/commands/migrate-resolve.ts",
    "cli/commands/migrate-status.ts",
    "cli/commands/migrate.ts",
    "cli/commands/permissions-cleanup.ts",
    "cli/commands/plugins.ts",
    "cli/commands/prune.ts",
    "cli/commands/telemetry.ts",
    "cli/commands/upgrade.ts",
    "cli/commands/webhooks-prune.ts",
    "cli/program.ts",
  ],
  // The Direct API and `init`, through the content-event namespaces.
  [
    "api/subject-events.ts",
    "api/versions-access.ts",
    "direct-api/namespaces/content-events.ts",
    "direct-api/namespaces/index.ts",
    "direct-api/nextly.ts",
    "init.ts",
  ],
  // The REST route handler and the dispatcher it routes through.
  [
    "dispatcher/dispatcher.ts",
    "dispatcher/handlers/collection-dispatcher.ts",
    "dispatcher/handlers/single-dispatcher.ts",
    "routeHandler.ts",
  ],
  [
    "domains/collections/services/collection-registry-service.ts",
    "domains/collections/services/collection-sync-service.ts",
  ],
  [
    "plugins/schema/apply-contributions.ts",
    "plugins/schema/reconcile-builder-contributions.ts",
  ],
];
