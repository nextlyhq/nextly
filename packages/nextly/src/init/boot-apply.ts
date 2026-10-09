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
import type { ExtensionSchema } from "../domains/schema/extension/build-extension-schema";
import type { PluginMigrationSet } from "../domains/schema/migrate/plugin/run-plugin-migrations";
import type { PluginDefinition } from "../plugins/plugin-context";

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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // NOTE: Errors are logged but don't block dev server startup. This is intentional:
    // - Dev boot should remain resilient even if migrations/metadata have issues
    // - The app still works against the live DB schema (code-first edits won't apply)
    // - Users can run `nextly migrate` manually to see actual errors
    // Set NEXTLY_BOOT_APPLY_FAIL_LOUDLY=1 to throw instead of warn (useful for debugging)
    if (process.env.NEXTLY_BOOT_APPLY_FAIL_LOUDLY === "1") {
      console.error(
        `${label} Boot-time schema apply FAILED ( NEXTLY_BOOT_APPLY_FAIL_LOUDLY=1 ): ${msg}`
      );
      throw err;
    }
    console.warn(
      `${label} Boot-time schema apply failed: ${msg}. ` +
        `The dev server still works against the live DB schema, ` +
        `but code-first edits won't be applied until next restart, ` +
        `HMR fires, or you run \`nextly db:sync\`. ` +
        `Set NEXTLY_BOOT_APPLY_FAIL_LOUDLY=1 for full error details.`
    );
  }
}

/**
 * The app's configuration and its migrations directory, read as `nextly
 * migrate` reads them, or undefined when the directory does not exist: a
 * project without one has nothing for the boot to apply or register.
 */
async function bootMigrationsDir(): Promise<
  { configResult: LoadConfigResult; migrationsDir: string } | undefined
> {
  const fs = await import("fs");
  const path = await import("path");
  const { loadConfig } = await import("../cli/utils/config-loader");
  const configResult = await loadConfig({ cwd: process.cwd() });
  const migrationsDir = path.join(
    process.cwd(),
    configResult.config.db.migrationsDir
  );
  return fs.existsSync(migrationsDir)
    ? { configResult, migrationsDir }
    : undefined;
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
    const dir = await bootMigrationsDir();
    if (!dir) return 0;
    const { migrationsDir } = dir;
    const fs = await import("fs");
    const path = await import("path");

    // Check if meta directory exists
    const metaDir = path.join(migrationsDir, "meta");
    if (!fs.existsSync(metaDir)) {
      return 0; // No metadata, skip
    }

    // Import the registration function
    const { registerFromMigrations } = await import(
      "../domains/schema/migrate/metadata-register"
    );

    // Get the adapter from DI (consistent with reloadDynamicTables)
    const { container } = await import("../di/container");
    const drizzleAdapter = container.get("adapter");

    if (!drizzleAdapter) {
      console.warn(
        `${label} Adapter not available for migration metadata registration. Run \`nextly migrate\` manually.`
      );
      return 0;
    }

    const adapter = drizzleAdapter as {
      dialect: "postgresql" | "mysql" | "sqlite";
    };

    const logger = {
      info: (msg: string) => console.log(`${label} ${msg}`),
      warn: (msg: string) => console.warn(`${label} ${msg}`),
      error: (msg: string) => console.error(`${label} ${msg}`),
      debug: (msg: string) => console.debug(`${label} ${msg}`),
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
      console.log(
        `${label} ✅ Registered ${result.collectionsRegistered} collection(s), ${result.singlesRegistered} single(s) from migration metadata`
      );
    }
    return registered;
  } catch (err) {
    // Metadata registration failed - log but don't block startup
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
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
  try {
    const { container } = await import("../di/container");

    // Check if permissionSeedService is available
    if (!container.has("permissionSeedService")) {
      console.warn(
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
      console.log(
        `${label} ✅ Seeded ${allNewIds.length} permission(s) for migration collections and singles`
      );
    }
  } catch (err) {
    // Permission seeding failed - log but don't block startup
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
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
    const dir = await bootMigrationsDir();
    if (!dir) return 0;
    const { configResult, migrationsDir } = dir;

    console.log(`${label} Checking for pending migrations...`);

    // Import migrateCore and related dependencies
    const { migrateCore } = await import("../cli/commands/migrate");
    const { validateDatabaseEnv } = await import("../cli/utils/adapter");
    const { container } = await import("../di/container");

    // Validate database environment
    const dbValidation = validateDatabaseEnv();
    if (!dbValidation.valid) {
      console.warn(
        `${label} Database environment invalid. Run \`nextly migrate\` manually.`,
        ...dbValidation.errors.map(e => `  - ${e}`)
      );
      return 0;
    }

    // Get adapter from DI (consistent with reloadDynamicTables)
    const drizzleAdapter = container.get<DrizzleAdapter | undefined>("adapter");

    if (!drizzleAdapter) {
      console.warn(
        `${label} Adapter not available. Run \`nextly migrate\` manually.`
      );
      return 0;
    }

    // Create a logger compatible with migrateCore's CommandContext["logger"]
    const logger = {
      header: (msg: string) => console.log(`${label} ${msg}`),
      info: (msg: string) => console.log(`${label} ${msg}`),
      success: (msg: string) => console.log(`${label} ✅ ${msg}`),
      warn: (msg: string) => console.warn(`${label} ⚠️  ${msg}`),
      error: (msg: string) => console.error(`${label} ❌ ${msg}`),
      debug: (msg: string) => console.debug(`${label} ${msg}`),
      keyValue: (key: string, value: string | number | boolean) =>
        console.log(`${label} ${key}: ${value}`),
      divider: () => console.log(`${label} ---`),
      newline: () => console.log(),
      item: (msg: string) => console.log(`${label} • ${msg}`),
      table: (_headers: string[], _rows: (string | number | boolean)[][]) => {},
      spinner: (msg: string) => {
        console.log(`${label} ${msg}`);
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
      logger: { warn: m => console.warn(m) },
    });
    const result = await migrateAtDevBoot({
      migrateCore,
      adapter: drizzleAdapter,
      extensionSchema,
      plugins: configResult.config.plugins ?? [],
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
      label,
    });

    // Both streams count: a boot that ran only plugin modules still applied
    // something, and saying otherwise sends the reader looking for a run
    // that did nothing.
    const applied = result.applied + result.pluginModulesApplied;
    if (applied > 0) {
      console.log(`${label} Applied ${applied} migration(s)`);
    } else {
      console.log(`${label} No pending migrations`);
    }
    return (
      result.metadata.collectionsRegistered + result.metadata.singlesRegistered
    );
  } catch (err) {
    // Migration check/apply failed - log but don't block startup
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
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
 * modules come from `pluginMigrationArgs`, the helper the CLI and the
 * production boot read them from: `migrateCore` refuses every plugin table
 * whose plugin it is not told ships migrations, so a boot passing none would
 * stop applying the app's own files the moment a plugin declared a table.
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
  plugins: readonly PluginDefinition[];
  migrationsDir: string;
  logger: TLogger;
  ttlSeconds?: number;
  knownJunctions?: ReadonlySet<string>;
  label: string;
}): Promise<TResult> {
  const { adapter, label } = args;
  // Loaded here, as every heavy dependency of this file is, so importing the
  // boot does not load the migration engine.
  const { pluginMigrationArgs } = await import(
    "../domains/schema/migrate/plugin/run-plugin-migrations"
  );
  const { ensureSchemaEventsTable } = await import(
    "../domains/schema/events/schema-events-ddl"
  );
  return args.migrateCore({
    extensionSchema: args.extensionSchema,
    ...(await pluginMigrationArgs(args.plugins)),
    dialect: adapter.dialect,
    db: adapter.getDrizzle(),
    adapter,
    migrationsDir: args.migrationsDir,
    logger: args.logger,
    lockMode: "fail-fast",
    ttlSeconds: args.ttlSeconds,
    knownJunctions: args.knownJunctions,
    // The development boot lets the core reconcile make destructive changes.
    allowDestructive: true,
    ensureLedger: async () => {
      try {
        await ensureSchemaEventsTable(adapter);
      } catch (err) {
        // A ledger that cannot be created is reported, and the run goes on:
        // recording an event then fails with the database's own reason.
        console.warn(
          `${label} Ledger bootstrap failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
  });
}
