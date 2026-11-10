// Boot-time auto-apply for code-first schema changes (dev only).
//
// Why this exists: without this, the dev experience has a footgun.
// Editing a code-first collection (e.g. rename `excerpt` -> `summary`
// in `src/collections/Posts.ts`), then restarting the server, only
// updates `dynamic_collections.fields` JSON via
// `syncCodeFirstCollections`. The actual `dc_<slug>` table column
// stays at the old name. Subsequent admin-UI / direct queries fail
// with "no such column" until the user manually runs `nextly db:sync`.
// `runDriftCheck` only warns; it does not fix the divergence.
//
// `reloadNextlyConfig` is the same path HMR uses, so behavior is
// consistent: introspect live -> diff against desired -> safe ops
// apply through the F4 Option E pipeline (rename detector pairs
// drop+add into a column rename, clack prompts the user in the dev
// terminal, RealClassifier handles type changes,
// RealPreCleanupExecutor runs explicit UPDATE/DELETE for unsafe
// resolutions). Safety gates inside `classifyForCodeFirst` skip
// anything that needs admin review (multi-rename, drop-only without
// rename pair, type changes that need explicit resolution).
//
// Production restarts do NOT auto-apply: schema changes there belong
// in the migration files committed with the code, not in a side-effect
// of starting the server. Disable explicitly with
// `NEXTLY_DISABLE_BOOT_APPLY=1` if a dev workflow needs the old
// "metadata-only on restart" behavior (e.g. running multiple branches
// that touch the same DB).
//
// Why this is shared: Nextly has two init entry points - `init.ts`
// (direct API: `nextly.find()`) and
// `route-handler/auth-handler.ts:ensureServicesInitialized` (route
// handler: `/admin/api/*`). The user's traffic decides which one
// runs first. Both need the same boot-apply behavior, so the logic
// is centralized here and called from both.

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { LoadConfigResult } from "../cli/utils/config-loader";
import type { SchemaRegistry } from "../database/schema-registry";
import type { ExtensionSchema } from "../domains/schema/extension/build-extension-schema";
import type {
  PluginMigrationSet,
  pluginMigrationArgs,
} from "../domains/schema/migrate/plugin/run-plugin-migrations";
import { NextlyError } from "../errors";
// The operator view of an error: code, the `logMessage` detail its generic
// public message leaves out, the cause chain and the log context.
import { describeError } from "../errors/describe-error";
import { consoleLogger, type Logger } from "../shared/types";

import { reloadDynamicTables } from "./reload-dynamic-tables";

const callerLabel = (caller?: string): string =>
  caller ? `[Nextly:${caller}]` : "[Nextly]";

/**
 * Whether this process applies code-first schema on boot: development, and not
 * opted out with `NEXTLY_DISABLE_BOOT_APPLY=1`.
 *
 * One predicate for everything that creates schema outside migrations at boot
 * — the development push below and the creation of missing extension tables in
 * `registerServices` — so an opt-out that stops one stops both.
 */
export function bootApplyEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.NEXTLY_DISABLE_BOOT_APPLY !== "1"
  );
}

export async function runBootTimeApplyIfDev(opts?: {
  caller?: string;
}): Promise<void> {
  if (!bootApplyEnabled()) return;

  const label = callerLabel(opts?.caller);
  try {
    // Step 1: Apply pending SQL migrations first (lock-guarded, safe across workers)
    const registeredByMigrate = await applyPendingMigrations(label);

    // Step 1.5: Register collections from migration metadata
    // NOTE: This runs OUTSIDE the migrate lock. Multiple Next.js dev workers may
    // execute this concurrently. The select-then-insert pattern is racy (workers
    // can both check existence, then both insert), but slug unique constraints
    // prevent duplicates. If a worker loses the race, it continues normally.
    // Any metadata-table-to-physical-table mismatch self-heals on next boot.
    const registeredFromSnapshots = await registerMigrationMetadata(label);

    // Migration-created collections and singles need permissions just like
    // code-first ones. Either step may have registered them — the migrate
    // run's own metadata phase first, the snapshot pass after it finding
    // nothing left — so the seeding follows both.
    if (registeredByMigrate + registeredFromSnapshots > 0) {
      await seedPermissionsForMigrationCollections(label);
    }

    // Step 1.6: Reload dynamic tables into the schema registry.
    // The registry was built by `registerServices` before any of the above ran,
    // so without this a migration-created collection is addressable in metadata
    // and unqueryable. Shared with the production path, which needs the same
    // step for the same reason.
    await reloadDynamicTables(label);

    // Step 2: Apply code-first schema changes
    const { reloadNextlyConfig } = await import("./reload-config");
    await reloadNextlyConfig();

    // Step 3: every relation a declared table names resolves, now that the
    // steps above registered what migrations created.
    await assertRelationsResolveAfterApply();
  } catch (err) {
    const msg = describeError(err);
    // NOTE: Errors are logged but don't block dev server startup. This is intentional:
    // - Dev boot should remain resilient even if migrations/metadata have issues
    // - The app still works against the live DB schema (code-first edits won't apply)
    // - Users can run `nextly migrate` manually to see actual errors
    // Set NEXTLY_BOOT_APPLY_FAIL_LOUDLY=1 to throw instead of warn (useful for debugging)
    if (process.env.NEXTLY_BOOT_APPLY_FAIL_LOUDLY === "1") {
      consoleLogger.error(
        `${label} Boot-time schema apply FAILED ( NEXTLY_BOOT_APPLY_FAIL_LOUDLY=1 ): ${msg}`
      );
      throw err;
    }
    consoleLogger.warn(
      `${label} Boot-time schema apply failed: ${msg}. ` +
        `The dev server still works against the live DB schema, ` +
        `but code-first edits won't be applied until next restart, ` +
        `HMR fires, or you run \`nextly db:sync\`. ` +
        `Set NEXTLY_BOOT_APPLY_FAIL_LOUDLY=1 for full error details.`
    );
  }
}

/**
 * Ask the schema registry whether every relation a declared table names
 * resolves.
 *
 * Development's place for the check `registerServices` makes everywhere else
 * (`assertBootRelationsResolve`), which stands aside when this apply runs: a
 * Builder-made table that arrives through a migration is registered only by
 * Step 1.6, so asked any earlier a relation to it is refused on every fresh
 * clone, by a boot that then never reaches the step that would register it.
 * Reported like every other step here, without stopping the dev server.
 */
async function assertRelationsResolveAfterApply(): Promise<void> {
  const { container } = await import("../di/container");
  if (!container.has("schemaRegistry")) return;
  container.get<SchemaRegistry>("schemaRegistry").assertRelationsResolve();
}

/**
 * Ask the schema registry whether every relation resolves, before plugins
 * initialise: refuse where the boot refuses, and report where development
 * carries on.
 *
 * In development the boot's schema apply runs after this and may register
 * the table a relation names (a Builder-made one arriving through a
 * migration), so a relation not resolved yet is reported, not refused, and
 * the apply asks again (`assertRelationsResolve` above). Either way the
 * registry keeps the relations that do resolve, so a plugin's `init` that
 * queries relationally reaches every other relation rather than failing on
 * the one already named.
 */
export function checkRelationsBeforePlugins(
  registry: Pick<SchemaRegistry, "assertRelationsResolve"> | undefined,
  how: { refuse: boolean; warn: (message: string) => void }
): void {
  if (registry === undefined) return;
  if (how.refuse) {
    registry.assertRelationsResolve();
    return;
  }
  try {
    registry.assertRelationsResolve();
  } catch (error) {
    if (
      !NextlyError.is(error) ||
      error.code !== "NEXTLY_SCHEMA_RELATION_UNRESOLVED"
    ) {
      throw error;
    }
    how.warn(
      `[Nextly] ${describeError(error)} The development boot's schema apply may yet register the table; it asks again once it has run.`
    );
  }
}

/**
 * The app's configuration and the path of its migrations directory, read as
 * `nextly migrate` reads them. The directory need not exist: what its absence
 * means differs by caller, so each asks about it on its own.
 */
async function bootMigrateConfig(): Promise<{
  configResult: LoadConfigResult;
  migrationsDir: string;
}> {
  const path = await import("path");
  const { loadConfig } = await import("../cli/utils/config-loader");
  const configResult = await loadConfig({ cwd: process.cwd() });
  const migrationsDir = path.join(
    process.cwd(),
    configResult.config.db.migrationsDir
  );
  return { configResult, migrationsDir };
}

/**
 * Register collections from migration metadata at boot time (development only).
 *
 * This bridges the gap for visual approach templates where:
 * - SQL migrations create the physical tables (via applyPendingMigrations)
 * - Migration snapshots define the schema metadata
 * - This function registers that metadata in dynamic_collections/dynamic_singles tables
 *
 * CONCURRENCY: This runs OUTSIDE the migrate lock. Multiple Next.js dev workers may
 * execute this concurrently. The select-then-insert pattern is racy (workers can both
 * check existence, then both insert), but slug unique constraints prevent duplicates.
 * Any metadata-table-to-physical-table mismatch self-heals on next boot.
 *
 * Without this, the collections registry stays empty because visual.config.ts has
 * empty collections array (by design - users create collections via Admin Panel).
 */
async function registerMigrationMetadata(label: string): Promise<number> {
  try {
    const { migrationsDir } = await bootMigrateConfig();
    const fs = await import("fs");
    const path = await import("path");

    // The snapshots live in `meta` inside the migrations directory; a project
    // without that directory, or without its `meta`, has none to register.
    const metaDir = path.join(migrationsDir, "meta");
    if (!fs.existsSync(metaDir)) {
      return 0;
    }

    // Import the registration function
    const { registerFromMigrations } = await import(
      "../domains/schema/migrate/metadata-register"
    );

    // Get the adapter from DI (consistent with reloadDynamicTables)
    const { container } = await import("../di/container");
    const drizzleAdapter = container.get("adapter");

    if (!drizzleAdapter) {
      consoleLogger.warn(
        `${label} Adapter not available for migration metadata registration. Run \`nextly migrate\` manually.`
      );
      return 0;
    }

    const adapter = drizzleAdapter as {
      dialect: "postgresql" | "mysql" | "sqlite";
    };

    const logger = {
      info: (msg: string) => consoleLogger.info(`${label} ${msg}`),
      warn: (msg: string) => consoleLogger.warn(`${label} ${msg}`),
      error: (msg: string) => consoleLogger.error(`${label} ${msg}`),
      debug: (msg: string) => consoleLogger.debug(`${label} ${msg}`),
    };

    // Register collections from migration snapshots
    const result = await registerFromMigrations({
      migrationsDir,
      adapter: drizzleAdapter,
      dialect: adapter.dialect,
      logger,
    });

    const registered = result.collectionsRegistered + result.singlesRegistered;
    if (registered > 0) {
      consoleLogger.info(
        `${label} ✅ Registered ${result.collectionsRegistered} collection(s), ${result.singlesRegistered} single(s) from migration metadata`
      );
    }
    return registered;
  } catch (err) {
    // Metadata registration failed - log but don't block startup
    const msg = err instanceof Error ? err.message : String(err);
    consoleLogger.warn(
      `${label} Migration metadata registration skipped: ${msg}. ` +
        `Collections from migrations may not be available.`
    );
    return 0;
  }
}

/**
 * Seed permissions for collections and singles registered from migrations.
 *
 * After registerMigrationMetadata() inserts new rows into dynamic_collections/dynamic_singles,
 * we need to seed CRUD permissions for those collections and singles so they show up
 * in the role creation/editing pages.
 */
async function seedPermissionsForMigrationCollections(
  label: string
): Promise<void> {
  // A start's own seeding follows and ensures every entity's permissions, so
  // they are left to it rather than ensured twice in one start.
  const { bootSeedingFollows } = await import("./seed-permissions");
  if (bootSeedingFollows()) return;
  try {
    const { container } = await import("../di/container");

    // Check if permissionSeedService is available
    if (!container.has("permissionSeedService")) {
      consoleLogger.warn(
        `${label} PermissionSeedService not available - skipping permission seeding for migration collections`
      );
      return;
    }

    const permissionSeedService = container.get<{
      seedAllCollectionPermissions: () => Promise<{
        newPermissionIds: string[];
      }>;
      seedAllSinglePermissions: () => Promise<{ newPermissionIds: string[] }>;
      assignNewPermissionsToSuperAdmin: (ids: string[]) => Promise<unknown>;
    }>("permissionSeedService");

    // Seed permissions for all collections (including newly registered ones)
    const collectionResult =
      await permissionSeedService.seedAllCollectionPermissions();
    const singleResult = await permissionSeedService.seedAllSinglePermissions();

    const allNewIds = [
      ...collectionResult.newPermissionIds,
      ...singleResult.newPermissionIds,
    ];

    // Assign new permissions to super_admin
    if (allNewIds.length > 0) {
      await permissionSeedService.assignNewPermissionsToSuperAdmin(allNewIds);
      consoleLogger.info(
        `${label} ✅ Seeded ${allNewIds.length} permission(s) for migration collections and singles`
      );
    }
  } catch (err) {
    // Permission seeding failed - log but don't block startup
    const msg = err instanceof Error ? err.message : String(err);
    consoleLogger.warn(
      `${label} Permission seeding for migration collections failed: ${msg}. ` +
        `Permissions may need to be seeded manually.`
    );
  }
}

/**
 * Apply pending SQL migrations at boot time (development only).
 *
 * This ensures template migrations (like blog schema) are applied
 * automatically when the dev server starts, eliminating the need
 * for manual `nextly migrate` commands during development.
 *
 * Uses migrateCore directly instead of spawning a child process to:
 * - Avoid npx network reach-out (if local binary isn't resolvable)
 * - Avoid expensive second Node process startup
 * - Get proper error handling instead of exit codes
 * - Use the intended injectable migrateCore seam
 */
async function applyPendingMigrations(label: string): Promise<number> {
  try {
    const { configResult, migrationsDir } = await bootMigrateConfig();

    // A configured plugin's modules run whether or not the app has a
    // migrations directory: they ship with the plugin, and every reader
    // `migrateCore` uses takes an absent directory as no app files. They are
    // read through `pluginMigrationArgs`, as the CLI and the production boot
    // read them, and the run is skipped only when there is no directory and
    // that same source names no module, so a project with neither still
    // returns before `migrateCore` and the schema it compiles are loaded.
    const fs = await import("fs");
    const { pluginMigrationArgs } = await import(
      "../domains/schema/migrate/plugin/run-plugin-migrations"
    );
    const pluginMigrations = await pluginMigrationArgs(
      configResult.config.plugins ?? []
    );
    if (
      !fs.existsSync(migrationsDir) &&
      pluginMigrations.pluginMigrationSets.length === 0
    ) {
      // No migrate run here, yet every content table still needs the
      // per-document columns `migrateCore` would have added, under the same
      // schema lock.
      const { container } = await import("../di/container");
      const adapter = container.get<DrizzleAdapter | undefined>("adapter");
      const { addDocumentColumnsUnderLock } = await import(
        "../domains/schema/migrate/document-columns"
      );
      // At a development start the last one recorded, only the changed
      // entities' tables: the rest have their columns already.
      if (adapter) {
        await addDocumentColumnsUnderLock(
          adapter,
          consoleLogger,
          tablesChangedSinceLastStart()
        );
      }
      return 0;
    }

    consoleLogger.info(`${label} Checking for pending migrations...`);

    // Import migrateCore and related dependencies
    const { migrateCore } = await import("../cli/commands/migrate");
    const { validateDatabaseEnv } = await import("../cli/utils/adapter");
    const { container } = await import("../di/container");

    // Validate database environment
    const dbValidation = validateDatabaseEnv();
    if (!dbValidation.valid) {
      consoleLogger.warn(
        `${label} Database environment invalid. Run \`nextly migrate\` manually.`,
        { errors: dbValidation.errors }
      );
      return 0;
    }

    // Get adapter from DI (consistent with reloadDynamicTables)
    const drizzleAdapter = container.get<DrizzleAdapter | undefined>("adapter");

    if (!drizzleAdapter) {
      consoleLogger.warn(
        `${label} Adapter not available. Run \`nextly migrate\` manually.`
      );
      return 0;
    }

    // Create a logger compatible with migrateCore's CommandContext["logger"]
    const logger = {
      header: (msg: string) => consoleLogger.info(`${label} ${msg}`),
      info: (msg: string) => consoleLogger.info(`${label} ${msg}`),
      success: (msg: string) => consoleLogger.info(`${label} ✅ ${msg}`),
      warn: (msg: string) => consoleLogger.warn(`${label} ⚠️  ${msg}`),
      error: (msg: string) => consoleLogger.error(`${label} ❌ ${msg}`),
      debug: (msg: string) => consoleLogger.debug(`${label} ${msg}`),
      keyValue: (key: string, value: string | number | boolean) =>
        consoleLogger.info(`${label} ${key}: ${value}`),
      divider: () => consoleLogger.info(`${label} ---`),
      newline: () => consoleLogger.info(""),
      item: (msg: string) => consoleLogger.info(`${label} • ${msg}`),
      table: (_headers: string[], _rows: (string | number | boolean)[][]) => {},
      spinner: (msg: string) => {
        consoleLogger.info(`${label} ${msg}`);
        return { stop: () => {} };
      },
      setOptions: () => {},
      getOptions: () => ({}),
    };

    // Run migrateCore with appropriate options
    const { resolveDeclaredSchema } = await import(
      "../domains/schema/migrate/resolved-schema"
    );
    const resolvedSchema = await resolveDeclaredSchema({
      projectRoot: process.cwd(),
      config: configResult.config,
      deferredExtends: configResult.deferredExtends,
    });
    // Compiled from the same config the CLI compiles from; see
    // `MigrateCoreDeps.extensionSchema` for why it is passed, not read.
    const { compileExtensionSchema } = await import(
      "../domains/schema/extension/publish"
    );
    const extensionSchema = await compileExtensionSchema({
      dialect: drizzleAdapter.dialect,
      plugins: configResult.config.plugins ?? [],
      config: configResult.config,
      logger: { warn: m => consoleLogger.warn(m) },
    });
    const result = await migrateAtDevBoot({
      migrateCore,
      adapter: drizzleAdapter,
      extensionSchema,
      pluginMigrations,
      migrationsDir,
      logger,
      ttlSeconds: configResult.config.db.migrateLockTtlSeconds,
      // Boot applies migrations through the same drift verification the CLI
      // does, so it needs the same knowledge of which tables are derived. A
      // custom `options.junctionTable` name matches no convention and appears
      // in no snapshot, so without this an install that migrates on boot stops
      // with drift the CLI path would not have reported. Resolved through the
      // same helper the CLI uses, because the name may come from a Builder
      // collection rather than the config, and reading the config alone would
      // make boot and CLI disagree about the same database.
      knownJunctions: resolvedSchema.knownJunctions,
      declaredTables: resolvedSchema.declaredTables,
      junctionsByEntity: resolvedSchema.junctionsByEntity,
      label,
    });

    // Both streams count: a boot that ran only plugin modules still applied
    // something, and saying otherwise sends the reader looking for a run
    // that did nothing.
    const applied = result.applied + result.pluginModulesApplied;
    if (applied > 0) {
      consoleLogger.info(`${label} Applied ${applied} migration(s)`);
    } else {
      consoleLogger.info(`${label} No pending migrations`);
    }
    return (
      result.metadata.collectionsRegistered + result.metadata.singlesRegistered
    );
  } catch (err) {
    // Migration check/apply failed - log but don't block startup
    const msg = err instanceof Error ? err.message : String(err);
    consoleLogger.warn(
      `${label} Migration auto-apply skipped: ${msg}. ` +
        `Run \`nextly migrate\` manually if needed.`
    );
    return 0;
  }
}

/**
 * What the development boot hands `migrateCore`, declared here because the
 * runtime may not import the CLI's migrate module, types included. A
 * `migrateCore` passed in is checked against it wherever it is passed.
 */
export interface DevBootMigrateDeps<TLogger> {
  extensionSchema: ExtensionSchema | undefined;
  pluginMigrationSets: PluginMigrationSet[];
  pluginsWithMigrations: Set<string>;
  dialect: DrizzleAdapter["dialect"];
  db: ReturnType<DrizzleAdapter["getDrizzle"]>;
  adapter: DrizzleAdapter;
  migrationsDir: string;
  logger: TLogger;
  lockMode: "fail-fast";
  ttlSeconds?: number;
  knownJunctions?: ReadonlySet<string>;
  /** What the declared schema names, which old Builder files are judged against. */
  declared?: {
    junctions?: ReadonlyMap<string, ReadonlySet<string>>;
    tables?: ReadonlySet<string>;
  };
  allowDestructive: boolean;
  ensureLedger: () => Promise<void>;
}

/**
 * Apply the app's pending migration files at development boot, the plugin
 * modules before them, through the CLI's own `migrateCore`.
 *
 * The adapter is the application's own, as the production boot hands it:
 * `migrateCore` reads it as the full `DrizzleAdapter` — listing tables,
 * opening the single-connection transaction a file runs in — so a stand-in
 * exposing part of that surface would fail on the first app file. The plugin
 * modules are what `pluginMigrationArgs` returns, the helper the CLI and the
 * production boot read them from, taken whole: `migrateCore` refuses every
 * plugin table whose plugin it is not told ships migrations, so a boot passing
 * none would stop applying the app's own files the moment a plugin declared a
 * table. The caller reads them, because it also decides from them whether a
 * project without a migrations directory has anything to run.
 */
export async function migrateAtDevBoot<
  TLogger,
  TResult extends {
    applied: number;
    pluginModulesApplied: number;
    metadata: { collectionsRegistered: number; singlesRegistered: number };
  },
>(args: {
  migrateCore: (deps: DevBootMigrateDeps<TLogger>) => Promise<TResult>;
  adapter: DrizzleAdapter;
  extensionSchema: ExtensionSchema | undefined;
  pluginMigrations: Awaited<ReturnType<typeof pluginMigrationArgs>>;
  migrationsDir: string;
  logger: TLogger;
  ttlSeconds?: number;
  knownJunctions?: ReadonlySet<string>;
  /** The entity tables the declared schema names (`declared`). */
  declaredTables?: ReadonlySet<string>;
  /** Each collection's custom junction names, by its slug (`declared`). */
  junctionsByEntity?: ReadonlyMap<string, ReadonlySet<string>>;
  label: string;
}): Promise<TResult> {
  const { adapter, label } = args;
  // Loaded here, as every heavy dependency of this file is, so importing the
  // boot does not load the migration engine.
  const { ensureSchemaEventsTable } = await import(
    "../domains/schema/events/schema-events-ddl"
  );
  return args.migrateCore({
    extensionSchema: args.extensionSchema,
    ...args.pluginMigrations,
    dialect: adapter.dialect,
    db: adapter.getDrizzle(),
    adapter,
    migrationsDir: args.migrationsDir,
    logger: args.logger,
    lockMode: "fail-fast",
    ttlSeconds: args.ttlSeconds,
    knownJunctions: args.knownJunctions,
    declared: {
      junctions: args.junctionsByEntity,
      tables: args.declaredTables,
    },
    // The development boot lets the core reconcile make destructive changes.
    allowDestructive: true,
    ensureLedger: async () => {
      try {
        await ensureSchemaEventsTable(adapter);
      } catch (err) {
        // A ledger that cannot be created is reported, and the run goes on:
        // recording an event then fails with the database's own reason.
        consoleLogger.warn(
          `${label} Ledger bootstrap failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
  });
}

// ---------------------------------------------------------------------------
// What a development start last brought in line, and whether it changed since
// ---------------------------------------------------------------------------

/**
 * The `nextly_meta` keys a development start records under: the salt, and one
 * row per entity, so a start that changed one entity writes that entity's row
 * and no other's.
 */
const START_SALT_KEY = "development_start:salt";
const START_ENTITY_PREFIX = "development_start:entity:";

/**
 * One start's fingerprints: a salt every entity's depends on (the Nextly
 * version, the dialect and the settings that change what any declaration
 * builds), and each entity's own, keyed `<kind>:<slug>`.
 */
interface StartFingerprints {
  salt: string;
  entities: Record<string, string>;
}

/** The entity kinds a start fingerprints. */
export type FingerprintedKind = "collection" | "single" | "fieldGroup";

/** What a fingerprint is taken of: the configuration's entities and settings. */
export interface FingerprintedConfig {
  collections?: ReadonlyArray<{ slug: string; dbName?: string }>;
  singles?: ReadonlyArray<{ slug: string; dbName?: string }>;
  fieldGroups?: ReadonlyArray<{ slug: string }>;
  perLanguageStorage?: boolean;
  localization?: unknown;
}

/**
 * The fingerprints recorded and the ones this start computed, on `globalThis`
 * for the reason the rest of the boot state is: Next.js can evaluate this
 * module in more than one server graph.
 */
const globalForFingerprints = globalThis as unknown as {
  __nextly_startFingerprints?: {
    recorded: StartFingerprints | null;
    current: StartFingerprints;
    /** Each configured collection's and Single's table, by fingerprint key. */
    tables: Record<string, string>;
  };
};

/** JSON with every object's keys sorted and functions left out, so one declaration gives one text. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner === "function") return undefined;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const record = inner as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map(key => [key, record[key]])
      );
    }
    return inner;
  });
}

async function fingerprintOf(value: unknown): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

async function startFingerprints(
  config: FingerprintedConfig,
  dialect: string
): Promise<StartFingerprints> {
  const { getCoreVersion } = await import("../plugins/core-version");
  const entities: Record<string, string> = {};
  const kinds: Array<[FingerprintedKind, FingerprintedConfig["collections"]]> =
    [
      ["collection", config.collections],
      ["single", config.singles],
      ["fieldGroup", config.fieldGroups],
    ];
  for (const [kind, list] of kinds) {
    for (const entity of list ?? []) {
      try {
        entities[`${kind}:${entity.slug}`] = await fingerprintOf(entity);
      } catch {
        // A declaration that cannot be written out (a cycle, say) gets no
        // fingerprint, so it is never taken for unchanged.
      }
    }
  }
  return {
    salt: await fingerprintOf([
      getCoreVersion(),
      dialect,
      config.perLanguageStorage === true,
      config.localization ?? null,
    ]),
    entities,
  };
}

/**
 * At a development start, before any per-entity work: the fingerprints the
 * last development start recorded (one read of `nextly_meta`), and this start's,
 * for `unchangedSinceLastStart` to compare. Any other start reads nothing and
 * takes every entity for changed.
 */
export async function readStartFingerprints(
  adapter: DrizzleAdapter,
  logger: Logger,
  config: FingerprintedConfig
): Promise<void> {
  globalForFingerprints.__nextly_startFingerprints = undefined;
  if (process.env.NODE_ENV !== "development") return;
  let current: StartFingerprints;
  try {
    current = await startFingerprints(config, adapter.dialect);
  } catch {
    // Settings that cannot be written out (a cycle, say) give no salt: nothing
    // is taken for unchanged, and the start does the full work.
    return;
  }
  let recorded: StartFingerprints | null = null;
  try {
    const { MetaService } = await import(
      "../domains/meta/services/meta-service"
    );
    // One read of the whole (small) table, whatever the number of entities.
    const stored = await new MetaService(adapter, logger).getAll();
    const salt = stored[START_SALT_KEY];
    if (typeof salt === "string") {
      const entities: Record<string, string> = {};
      for (const [key, value] of Object.entries(stored)) {
        if (key.startsWith(START_ENTITY_PREFIX) && typeof value === "string") {
          entities[key.slice(START_ENTITY_PREFIX.length)] = value;
        }
      }
      recorded = { salt, entities };
    }
  } catch {
    // A meta table not created yet records nothing: every entity is changed.
  }
  const [{ resolveCollectionTableName }, { resolveSingleTableName }] =
    await Promise.all([
      import("../domains/schema/utils/resolve-table-name"),
      import("../domains/singles/services/resolve-single-table-name"),
    ]);
  const tables: Record<string, string> = {};
  for (const c of config.collections ?? []) {
    tables[`collection:${c.slug}`] = resolveCollectionTableName(
      c.slug,
      c.dbName
    );
  }
  for (const single of config.singles ?? []) {
    tables[`single:${single.slug}`] = resolveSingleTableName({
      slug: single.slug,
      dbName: single.dbName,
    });
  }
  globalForFingerprints.__nextly_startFingerprints = {
    recorded,
    current,
    tables,
  };
}

/**
 * The tables of the configured collections and Singles whose declaration
 * changed since the last development start, for a step that would otherwise
 * read every content table. Undefined, meaning every table, wherever no start
 * has been recorded under the same Nextly version, dialect and settings: the
 * Schema Builder's entities are in no configuration, so only a recorded start
 * vouches for them.
 */
export function tablesChangedSinceLastStart(): readonly string[] | undefined {
  const state = globalForFingerprints.__nextly_startFingerprints;
  if (!state?.recorded || state.recorded.salt !== state.current.salt) {
    return undefined;
  }
  return Object.entries(state.tables)
    .filter(([key]) => {
      const [kind, ...slug] = key.split(":");
      return !unchangedSinceLastStart(
        kind as FingerprintedKind,
        slug.join(":")
      );
    })
    .map(([, table]) => table);
}

/**
 * Whether the entity's declaration is the one the last development start
 * recorded, under the same Nextly version, dialect and settings: its schema
 * reads (the layout refusal, the table probe, the drift check, the
 * per-document columns) are skipped then, because nothing about it changed
 * since a start brought it in line. False outside a development start, and
 * for anything not recorded.
 */
export function unchangedSinceLastStart(
  kind: FingerprintedKind,
  slug: string
): boolean {
  const state = globalForFingerprints.__nextly_startFingerprints;
  if (!state?.recorded || state.recorded.salt !== state.current.salt) {
    return false;
  }
  const key = `${kind}:${slug}`;
  const now = state.current.entities[key];
  return now !== undefined && state.recorded.entities?.[key] === now;
}

/**
 * Once a development start has brought its entities in line: record their
 * fingerprints for the next start, writing only the rows that differ from what
 * is recorded, so a start with nothing changed writes nothing and one with an
 * entity changed writes that entity's row alone. An entity in `notInLine` (the
 * drift check found it drifted, say) is left unrecorded, and so is one no
 * longer declared, so the next start checks it again.
 */
export async function recordStartFingerprints(
  adapter: DrizzleAdapter,
  logger: Logger,
  notInLine: Iterable<string> = []
): Promise<void> {
  const state = globalForFingerprints.__nextly_startFingerprints;
  if (!state || process.env.NODE_ENV !== "development") return;
  const entities = { ...state.current.entities };
  for (const key of notInLine) delete entities[key];
  const before = state.recorded?.entities ?? {};
  try {
    const { MetaService } = await import(
      "../domains/meta/services/meta-service"
    );
    const meta = new MetaService(adapter, logger);
    for (const [key, fingerprint] of Object.entries(entities)) {
      if (before[key] !== fingerprint) {
        await meta.set(`${START_ENTITY_PREFIX}${key}`, fingerprint);
      }
    }
    for (const key of Object.keys(before)) {
      if (!(key in entities)) await meta.delete(`${START_ENTITY_PREFIX}${key}`);
    }
    // Last, so a start stopped part-way leaves the old salt, and the next does
    // the full work rather than trusting rows half written.
    if (state.recorded?.salt !== state.current.salt) {
      await meta.set(START_SALT_KEY, state.current.salt);
    }
    state.recorded = { salt: state.current.salt, entities };
  } catch (error) {
    // Unrecorded, the next start does the full work again: slower, not wrong.
    consoleLogger.warn(
      `[Nextly] Could not record the development start's fingerprints: ${describeError(error)}`
    );
  }
}
