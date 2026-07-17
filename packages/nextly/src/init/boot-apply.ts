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

const callerLabel = (caller?: string): string =>
  caller ? `[Nextly:${caller}]` : "[Nextly]";

export async function runBootTimeApplyIfDev(opts?: {
  caller?: string;
}): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  if (process.env.NEXTLY_DISABLE_BOOT_APPLY === "1") return;

  const label = callerLabel(opts?.caller);
  try {
    // Step 1: Apply pending SQL migrations first
    await applyPendingMigrations(label);

    // Step 1.5: Register collections from migration metadata
    // This bridges the gap for visual approach where config has empty collections
    // but migrations define the schema. Reads snapshot files and populates
    // dynamic_collections and dynamic_singles tables.
    await registerMigrationMetadata(label);

    // Step 1.6: Reload dynamic tables into schema registry
    // After migration metadata is registered, we need to reload the dynamic
    // tables so the schema registry picks up the newly registered collections.
    // Without this, queries against migration-created collections fail because
    // the registry was loaded before the metadata was inserted.
    await reloadDynamicTables(label);

    // Step 2: Apply code-first schema changes
    const { reloadNextlyConfig } = await import("./reload-config");
    await reloadNextlyConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `${label} Boot-time schema apply failed: ${msg}. ` +
        `The dev server still works against the live DB schema, ` +
        `but code-first edits won't be applied until next restart, ` +
        `HMR fires, or you run \`nextly db:sync\`.`
    );
  }
}

/**
 * Reload dynamic tables into the schema registry after migration metadata registration.
 *
 * After registerMigrationMetadata() inserts rows into dynamic_collections/dynamic_singles,
 * the schema registry needs to be reloaded so those collections become queryable.
 *
 * This is called AFTER migration metadata is registered because the initial schema
 * registry load (during registerServices) happens before migration metadata exists.
 */
async function reloadDynamicTables(label: string): Promise<void> {
  try {
    const { container } = await import("../di/container");
    const { loadDynamicTables } = await import("../di/load-dynamic-tables");
    const { generateRuntimeSchema } = await import(
      "../domains/schema/services/runtime-schema-generator"
    );

    // Get services from container
    const adapter = container.get("adapter");
    const schemaRegistry = container.get("schemaRegistry");

    if (!schemaRegistry) {
      console.warn(
        `${label} Schema registry not available for reload. Collections from migrations may not be queryable.`
      );
      return;
    }

    if (!adapter) {
      console.warn(
        `${label} Adapter not available for reload. Collections from migrations may not be queryable.`
      );
      return;
    }

    // Get dialect using adapter's getCapabilities method
    const getCapabilities = (
      adapter as {
        getCapabilities: () => { dialect: "postgresql" | "mysql" | "sqlite" };
      }
    ).getCapabilities;
    const dialect = getCapabilities().dialect;

    // Reload collections
    await loadDynamicTables(
      adapter as Parameters<typeof loadDynamicTables>[0],
      "dynamic_collections",
      ((tableName, fields, hasStatus) => {
        const { table } = generateRuntimeSchema(
          tableName,
          fields as Parameters<typeof generateRuntimeSchema>[1],
          dialect,
          { status: hasStatus === true }
        );
        (
          schemaRegistry as {
            registerDynamicSchema: (tableName: string, table: unknown) => void;
          }
        ).registerDynamicSchema(tableName, table);
      }) as Parameters<typeof loadDynamicTables>[2]
    );

    // Reload singles
    await loadDynamicTables(
      adapter as Parameters<typeof loadDynamicTables>[0],
      "dynamic_singles",
      ((tableName, fields, hasStatus) => {
        const { table } = generateRuntimeSchema(
          tableName,
          fields as Parameters<typeof generateRuntimeSchema>[1],
          dialect,
          { status: hasStatus === true }
        );
        (
          schemaRegistry as {
            registerDynamicSchema: (tableName: string, table: unknown) => void;
          }
        ).registerDynamicSchema(tableName, table);
      }) as Parameters<typeof loadDynamicTables>[2]
    );

    console.log(
      `${label} ✅ Schema registry reloaded with migration collections`
    );
  } catch (err) {
    // Schema registry reload failed - log but don't block startup
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `${label} Schema registry reload failed: ${msg}. ` +
        `Collections from migrations may not be queryable.`
    );
  }
}

/**
 * Register collections from migration metadata at boot time (development only).
 *
 * This bridges the gap for visual approach templates where:
 * - SQL migrations create the physical tables (via applyPendingMigrations)
 * - Migration snapshots define the schema metadata
 * - This function registers that metadata in dynamic_collections/dynamic_singles tables
 *
 * Without this, the collections registry stays empty because visual.config.ts has
 * empty collections array (by design - users create collections via Admin Panel).
 */
async function registerMigrationMetadata(label: string): Promise<void> {
  try {
    const fs = await import("fs");
    const path = await import("path");

    // Check for migrations directory
    const migrationsDir = path.join(process.cwd(), "migrations");

    if (!fs.existsSync(migrationsDir)) {
      return; // No migrations directory, skip
    }

    // Check if meta directory exists
    const metaDir = path.join(migrationsDir, "meta");
    if (!fs.existsSync(metaDir)) {
      return; // No metadata, skip
    }

    // Import the registration function
    const { registerFromMigrations } = await import(
      "../domains/schema/migrate/metadata-register"
    );

    // Get the adapter from DI - same method as applyPendingMigrations
    const { getService } = await import("../di/register");
    const drizzleAdapter = getService("adapter");

    if (!drizzleAdapter) {
      console.warn(
        `${label} Adapter not available for migration metadata registration. Run \`nextly migrate\` manually.`
      );
      return;
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

    if (result.collectionsRegistered > 0 || result.singlesRegistered > 0) {
      console.log(
        `${label} ✅ Registered ${result.collectionsRegistered} collection(s), ${result.singlesRegistered} single(s) from migration metadata`
      );

      // Seed permissions for newly registered collections and singles
      // Migration-created collections need permissions just like code-first ones
      await seedPermissionsForMigrationCollections(label);
    }
  } catch (err) {
    // Metadata registration failed - log but don't block startup
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `${label} Migration metadata registration skipped: ${msg}. ` +
        `Collections from migrations may not be available.`
    );
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
async function applyPendingMigrations(label: string): Promise<void> {
  try {
    const fs = await import("fs");
    const path = await import("path");

    // Check for migrations directory
    const migrationsDir = path.join(process.cwd(), "migrations");

    if (!fs.existsSync(migrationsDir)) {
      return; // No migrations directory, skip
    }

    console.log(`${label} Checking for pending migrations...`);

    // Import migrateCore and related dependencies
    const { migrateCore } = await import("../cli/commands/migrate");
    const { validateDatabaseEnv } = await import("../cli/utils/adapter");
    const { getService } = await import("../di/register");

    // Validate database environment
    const dbValidation = validateDatabaseEnv();
    if (!dbValidation.valid) {
      console.warn(
        `${label} Database environment invalid. Run \`nextly migrate\` manually.`,
        ...dbValidation.errors.map(e => `  - ${e}`)
      );
      return;
    }

    // Get adapter from DI
    const drizzleAdapter = getService("adapter");

    if (!drizzleAdapter) {
      console.warn(
        `${label} Adapter not available. Run \`nextly migrate\` manually.`
      );
      return;
    }

    // Get db instance from adapter
    const db = (
      drizzleAdapter as { getDrizzle?: () => unknown }
    ).getDrizzle?.();

    if (!db) {
      console.warn(
        `${label} Database instance not available. Run \`nextly migrate\` manually.`
      );
      return;
    }

    // Import config for migrations directory and lock TTL
    const { loadConfig } = await import("../cli/utils/config-loader");
    const configResult = await loadConfig({ cwd: process.cwd() });
    const appMigrationsDir = path.join(
      process.cwd(),
      configResult.config.db.migrationsDir
    );

    // Import getSchemaEventsDdl for ledger bootstrap
    const { getSchemaEventsDdl } = await import(
      "../domains/schema/events/schema-events-ddl"
    );

    // Operator-set override; never in CI config (spec §4.6.1).
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    const allowCoreDestructive =
      process.env.NEXTLY_ALLOW_CORE_DESTRUCTIVE === "1";

    // Get dialect from adapter
    const adapterDialect = (
      drizzleAdapter as { dialect: "postgresql" | "mysql" | "sqlite" }
    ).dialect;

    // Create a CLI adapter wrapper for migrateCore
    const cliAdapter = {
      dialect: adapterDialect,
      connect: () => Promise.resolve(),
      disconnect: () =>
        (drizzleAdapter as { disconnect: () => Promise<void> }).disconnect(),
      isConnected: () => true,
      getCapabilities: () => ({
        dialect: adapterDialect,
      }),
      // Delegate executeQuery to drizzleAdapter if available (needed for ledger bootstrap)
      executeQuery:
        drizzleAdapter &&
        typeof (drizzleAdapter as { executeQuery?: unknown }).executeQuery ===
          "function"
          ? (sql: string, params?: unknown[]) =>
              (
                drizzleAdapter as {
                  executeQuery: (
                    sql: string,
                    params?: unknown[]
                  ) => Promise<unknown>;
                }
              ).executeQuery(sql, params)
          : undefined,
    };

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
    const result = await migrateCore({
      dialect: adapterDialect,
      db,
      adapter: cliAdapter,
      migrationsDir: appMigrationsDir,
      logger,
      lockMode: "fail-fast",
      ttlSeconds: configResult.config.db.migrateLockTtlSeconds,
      allowDestructive: allowCoreDestructive,
      ensureLedger: async () => {
        const adapter = drizzleAdapter as {
          executeQuery?: (sql: string, params?: unknown[]) => Promise<unknown>;
          tableExists?: (name: string) => Promise<boolean>;
        };
        // Check if required methods are available
        if (
          typeof adapter.executeQuery === "function" &&
          typeof adapter.tableExists === "function"
        ) {
          try {
            const hasLedger = await adapter.tableExists("nextly_schema_events");
            if (!hasLedger) {
              for (const stmt of getSchemaEventsDdl(adapterDialect)) {
                await adapter.executeQuery(stmt);
              }
            }
          } catch (err) {
            // Ledger bootstrap failed - log but don't block migration
            console.warn(
              `${label} Ledger bootstrap failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        } else {
          // Methods not available - skip ledger bootstrap
          console.debug(
            `${label} Ledger bootstrap skipped - adapter methods not available`
          );
        }
      },
    });

    if (result.applied > 0) {
      console.log(`${label} Applied ${result.applied} migration(s)`);
    } else {
      console.log(`${label} No pending migrations`);
    }
  } catch (err) {
    // Migration check/apply failed - log but don't block startup
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `${label} Migration auto-apply skipped: ${msg}. ` +
        `Run \`nextly migrate\` manually if needed.`
    );
  }
}
