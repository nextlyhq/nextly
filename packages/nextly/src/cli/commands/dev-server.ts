/**
 * Dev Command — Server / Schema Push Operations
 *
 * Database bootstrapping and schema push operations extracted from
 * `dev.ts`. This module owns the "server-side" work: ensuring core
 * tables exist, pushing dynamic schemas, and creating data tables for
 * singles/components.
 *
 * @module cli/commands/dev-server
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import type { FieldConfig } from "../../collections/fields/types/index.js";
import { getDialectTables } from "../../database/index.js";
import { SchemaRegistry } from "../../database/schema-registry.js";
import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables.js";
import { DrizzlePushService } from "../../domains/schema/services/drizzle-push-service.js";
import { generateRuntimeSchema } from "../../domains/schema/services/runtime-schema-generator.js";
import {
  SchemaPushService,
  type SchemaPushResult,
} from "../../domains/schema/services/schema-push-service.js";
import { reconcileSingleTables } from "../../domains/singles/services/reconcile-single-tables.js";
import { resolveSingleTableName } from "../../domains/singles/services/resolve-single-table-name.js";
import type { FieldDefinition } from "../../schemas/dynamic-collections.js";
import type { CollectionSyncResultWithValidation } from "../../services/collections/collection-sync-service.js";
import {
  type ComponentRegistryService,
  type SyncComponentResult,
} from "../../services/components/component-registry-service.js";
import type { Logger as ServiceLogger } from "../../services/shared/types.js";
import {
  type SingleRegistryService,
  type SyncSingleResult,
} from "../../services/singles/single-registry-service.js";
import type { CommandContext } from "../program.js";
import type { CLIDatabaseAdapter } from "../utils/adapter.js";
import type { LoadConfigResult } from "../utils/config-loader.js";
import { formatDuration } from "../utils/logger.js";

import type { ResolvedDevOptions } from "./db-sync.js";

// ============================================================================
// Core Table Creation
// ============================================================================

/**
 * Ensure core database tables exist before seeding.
 *
 * On a fresh database the auth tables (users, roles, permissions, etc.) and
 * system tables (dynamic_collections, nextly_migrations, etc.) may not exist
 * yet. For PostgreSQL/MySQL these are created by the bundled migrations. For
 * SQLite they are created via direct CREATE TABLE statements since SQLite
 * does not ship a bundled initial migration for the base schema.
 *
 * This step is only needed when `--seed` is passed, because seeding requires
 * these tables to exist.
 */
export async function ensureCoreTables(
  adapter: CLIDatabaseAdapter,
  _options: ResolvedDevOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const drizzleAdapter = adapter as unknown as DrizzleAdapter;
  const dialect = drizzleAdapter.getCapabilities().dialect;

  // Quick check: if the "users" table already exists, core tables are present
  try {
    const usersExists = await drizzleAdapter.tableExists("users");
    if (usersExists) {
      logger.debug("Core tables already exist, skipping ensureCoreTables");
      return;
    }
  } catch {
    // tableExists may fail if the DB is completely empty — continue with creation
  }

  logger.newline();
  logger.info("Creating core database tables...");

  // Use drizzle-kit pushSchema() to create ALL tables from the Drizzle schema
  // definitions. This guarantees the physical tables match the schema 100%,
  // unlike hand-written CREATE TABLE statements which can drift.
  // This ensures physical tables match the Drizzle schema definitions exactly.
  try {
    const db = drizzleAdapter.getDrizzle();
    const staticSchemas = getDialectTables(dialect);
    const pushService = new DrizzlePushService(dialect, db);
    const result = await pushService.apply(staticSchemas);

    if (result.statementsToExecute.length > 0) {
      logger.debug(
        `[schema] Created ${result.statementsToExecute.length} tables via pushSchema`
      );
    }
    logger.success("Core tables created");
  } catch (pushError) {
    // pushSchema failed (e.g., TTY prompt needed, or drizzle-kit error).
    // Fall back to raw SQL for SQLite, or error for PG/MySQL.
    const pushMsg =
      pushError instanceof Error ? pushError.message : String(pushError);
    logger.debug(`pushSchema failed: ${pushMsg}`);

    if (dialect === "sqlite") {
      logger.debug("Falling back to raw SQL table creation for SQLite...");
      const statements = generateSqliteCoreTableStatements();
      for (const statement of statements) {
        try {
          await drizzleAdapter.executeQuery(statement);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (!msg.includes("already exists")) {
            logger.debug(`Table creation statement failed: ${msg}`);
          }
        }
      }

      // Also create system tables (dynamic_collections, etc.)
      try {
        const { SystemTableService } = await import(
          "../../services/system/system-table-service.js"
        );
        const serviceLogger: ServiceLogger = {
          info: (m: string) => logger.debug(m),
          warn: (m: string) => logger.warn(m),
          error: (m: string) => logger.error(m),
          debug: (m: string) => logger.debug(m),
        };
        const systemTableService = new SystemTableService(
          drizzleAdapter,
          serviceLogger
        );
        await systemTableService.ensureSystemTables();
      } catch (sysError) {
        const msg =
          sysError instanceof Error ? sysError.message : String(sysError);
        logger.debug(`System table creation: ${msg}`);
      }

      logger.success("Core tables created (fallback)");
    } else {
      logger.error(
        "Core tables not found. Please run `nextly migrate` first to create the database schema."
      );
      process.exit(1);
    }
  }
}

// ============================================================================
// Collection Schema Auto-Sync (Push Mode)
// ============================================================================

/**
 * Perform auto-sync of schema changes to database
 *
 * This implements the "push mode" synchronization where schema changes
 * are applied directly to the database without creating migration files.
 *
 * Only runs in development mode (NODE_ENV !== 'production').
 */
export async function performAutoSync(
  config: LoadConfigResult["config"],
  adapter: CLIDatabaseAdapter,
  syncResult: CollectionSyncResultWithValidation,
  options: ResolvedDevOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  // Create service logger
  const serviceLogger: ServiceLogger = {
    info: (msg: string) => logger.debug(msg),
    warn: (msg: string) => logger.warn(msg),
    error: (msg: string) => logger.error(msg),
    debug: (msg: string) => logger.debug(msg),
  };

  const pushService = new SchemaPushService(
    adapter as unknown as DrizzleAdapter,
    serviceLogger
  );

  // Check environment
  const env = pushService.getEnvironment();

  if (env.isProduction) {
    const pendingCollections = [
      ...syncResult.sync.created,
      ...syncResult.sync.updated,
    ];

    if (pendingCollections.length > 0) {
      logger.newline();
      logger.error("Cannot auto-sync schema in production mode.");
      logger.info(
        "Run `nextly migrate:generate` to create migrations, then `nextly migrate:run` to apply."
      );
      process.exit(1);
    }
    return;
  }

  // ── Drizzle Push Path ──────────────────────────────────────────────
  // Build a SchemaRegistry with all collections (static + dynamic),
  // generate Drizzle table objects, and call pushSchema() to sync DB.
  // This replaces the per-table raw SQL approach with a single pushSchema call.
  // Falls back to legacy sync if pushSchema fails (e.g., no TTY for prompts).
  const drizzleAdapter = adapter as unknown as DrizzleAdapter;
  const dialect = drizzleAdapter.getCapabilities().dialect;

  try {
    const schemaRegistry = new SchemaRegistry(dialect);

    // Register static system tables (users, accounts, dynamic_collections, etc.)
    const staticSchemas = getDialectTables(dialect);
    schemaRegistry.registerStaticSchemas(staticSchemas);

    // Generate Drizzle table objects for ALL collections in config
    for (const collection of config.collections) {
      const baseTableName =
        collection.dbName ?? collection.slug.replace(/-/g, "_");
      const tableName = baseTableName.startsWith("dc_")
        ? baseTableName
        : `dc_${baseTableName}`;

      const fields = (collection.fields ?? []) as FieldDefinition[];
      if (fields.length > 0) {
        const { table } = generateRuntimeSchema(tableName, fields, dialect);
        schemaRegistry.registerDynamicSchema(tableName, table);
      }
    }

    // Call pushSchema() to sync all schemas with database
    // This runs in the terminal (nextly dev) so TTY is available for prompts
    const db = drizzleAdapter.getDrizzle();
    const drizzlePush = new DrizzlePushService(dialect, db);
    const allSchemas = schemaRegistry.getAllSchemas();

    const pushResult = await drizzlePush.apply(allSchemas);

    if (pushResult.statementsToExecute.length > 0) {
      logger.info(
        `[schema] Applied ${pushResult.statementsToExecute.length} schema changes via Drizzle push`
      );
      for (const stmt of pushResult.statementsToExecute) {
        logger.debug(`  ${stmt}`);
      }
    } else {
      logger.debug("[schema] Database schema is in sync");
    }

    if (pushResult.warnings.length > 0) {
      for (const warning of pushResult.warnings) {
        logger.warn(`[schema] ${warning}`);
      }
    }

    // Set table resolver so adapter CRUD uses Drizzle query API
    drizzleAdapter.setTableResolver(schemaRegistry);

    // Update migration status for all synced collections
    for (const collection of config.collections) {
      try {
        const tableName = `dc_${collection.slug.replace(/-/g, "_")}`;
        const tableExists = await drizzleAdapter.tableExists(tableName);
        if (tableExists) {
          await drizzleAdapter.update(
            "dynamic_collections",
            {
              migration_status: "applied",
              updated_at: new Date().toISOString(),
            },
            { and: [{ column: "slug", op: "=", value: collection.slug }] }
          );
        }
      } catch {
        // Ignore errors updating migration status
      }
    }

    logger.success("Schema synced via Drizzle push");
    return;
  } catch (error) {
    // pushSchema failed - fall back to legacy per-table sync
    // Common reason: TTY prompt needed for rename ambiguity
    logger.warn(
      `[schema] Drizzle push failed: ${error instanceof Error ? error.message : String(error)}`
    );
    logger.info("[schema] Falling back to legacy per-table sync...");
  }

  // ── Legacy Sync Path (fallback) ────────────────────────────────────
  // Get collections that need schema sync (created or updated)
  const collectionsToSync = [
    ...syncResult.sync.created,
    ...syncResult.sync.updated,
  ];

  // Also check for unchanged collections that might be missing their tables
  // This can happen when the collection registry is synced but the table wasn't created
  for (const slug of syncResult.sync.unchanged) {
    const collection = config.collections.find(c => c.slug === slug);
    if (collection) {
      // Check if the table exists
      const tableName = `dc_${slug.replace(/-/g, "_")}`;
      try {
        const tableExists = await (
          adapter as unknown as DrizzleAdapter
        ).tableExists(tableName);
        logger.info(`Checking table ${tableName}: exists=${tableExists}`);
        if (!tableExists) {
          logger.info(`Table ${tableName} doesn't exist, adding to sync list`);
          collectionsToSync.push(slug);
        }
      } catch (error) {
        logger.warn(
          `Failed to check if table ${tableName} exists: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  if (collectionsToSync.length === 0) {
    logger.debug("No schema changes to sync");
    return;
  }

  logger.newline();
  logger.info("Auto-syncing schema changes to database...");

  // Warn about data loss only when --force is used (which drops & recreates tables)
  if (options.force) {
    logger.warn("⚠️  Auto-sync may cause data loss. Tables will be recreated.");
    logger.info("Use --no-auto-sync to disable.");
    logger.newline();
  }

  // Perform the sync
  let pushResult: SchemaPushResult;
  try {
    pushResult = await pushService.syncSchema(config, collectionsToSync, {
      force: options.force,
      cwd: options.cwd ?? process.cwd(),
    });
  } catch (error) {
    logger.error(
      `Auto-sync failed: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }

  // Update migration status for successfully synced collections
  // CRITICAL: Verify table exists before marking as 'applied' to prevent
  // the race condition where status is set but table wasn't actually created
  if (pushResult.synced.length > 0) {
    const drizzleAdapterInner = adapter as unknown as DrizzleAdapter;

    for (const syncInfo of pushResult.synced) {
      try {
        // Verify table actually exists before marking as 'applied'
        const tableActuallyExists = await drizzleAdapterInner.tableExists(
          syncInfo.tableName
        );

        const newStatus = tableActuallyExists ? "applied" : "failed";

        // Use raw update to avoid re-fetch issues with registry service
        await drizzleAdapterInner.update(
          "dynamic_collections",
          {
            migration_status: newStatus,
            updated_at: new Date().toISOString(),
          },
          { and: [{ column: "slug", op: "=", value: syncInfo.slug }] }
        );

        if (tableActuallyExists) {
          logger.debug(
            `Updated migration status for ${syncInfo.slug} to 'applied'`
          );
        } else {
          logger.error(
            `Schema push reported success for ${syncInfo.slug} but table '${syncInfo.tableName}' does not exist - marked as 'failed'`
          );
        }
      } catch (statusError) {
        logger.debug(
          `Could not update migration status for ${syncInfo.slug}: ${
            statusError instanceof Error
              ? statusError.message
              : String(statusError)
          }`
        );
      }
    }
  }

  // Display auto-sync results
  displayAutoSyncResults(pushResult, options, context);
}

/**
 * Display auto-sync results
 */
export function displayAutoSyncResults(
  result: SchemaPushResult,
  options: ResolvedDevOptions,
  context: CommandContext
): void {
  const { logger } = context;

  if (result.synced.length > 0) {
    const dataLossCount = result.synced.filter(s => s.dataLoss).length;
    const syncedNames = result.synced.map(s => s.slug).join(", ");

    if (dataLossCount > 0) {
      logger.warn(
        `Synced ${result.synced.length} table(s) with data loss: ${syncedNames}`
      );
    } else {
      logger.success(`Synced ${result.synced.length} table(s): ${syncedNames}`);
    }

    if (options.verbose) {
      for (const sync of result.synced) {
        const status = sync.dataLoss ? "(recreated)" : "(created)";
        logger.item(`${sync.tableName} ${status}`, 1);
      }
    }
  }

  if (result.skipped.length > 0 && options.verbose) {
    logger.debug(`Skipped ${result.skipped.length} collection(s):`);
    for (const skip of result.skipped) {
      logger.item(`${skip.slug}: ${skip.reason}`, 1);
    }
  }

  if (result.errors.length > 0) {
    logger.newline();
    logger.error(`${result.errors.length} auto-sync error(s):`);
    for (const err of result.errors) {
      logger.item(`${err.slug}: ${err.error}`, 1);
    }
  }

  if (result.warnings.length > 0 && options.verbose) {
    for (const warning of result.warnings) {
      logger.warn(warning);
    }
  }

  logger.debug(`Auto-sync completed in ${formatDuration(result.durationMs)}`);
}

// ============================================================================
// Singles Auto-Sync (Table Creation)
// ============================================================================

/**
 * Register a newly-DDL'd Single table with the live schema resolver.
 *
 * Why: the adapter's `TableResolver` is built once at boot from the current
 * contents of `dynamic_singles`. If DDL creates a new physical table after
 * that snapshot (auto-sync on first run, reconcile on later boots, UI-create
 * from the admin panel), the resolver still doesn't know about it and any
 * subsequent query fails with "Table '...' not found in schema registry.
 * Ensure setTableResolver() has been called during boot."
 *
 * Mirrors the pattern in `single-dispatcher.ts` (UI-create path), which
 * calls `resolver.registerDynamicSchema(tableName, runtimeTable)` right
 * after successful DDL. Keeping the logic in one helper avoids drift
 * between the three places that create single tables: sync, reconcile, and
 * UI-create.
 *
 * Non-fatal: if the resolver isn't available (e.g. DI not yet wired), we
 * log and continue. The next boot will rebuild the resolver from the
 * registry row that was just written, so the table becomes visible then.
 */
function registerSingleTableInResolver(
  adapter: DrizzleAdapter,
  tableName: string,
  fields: FieldDefinition[],
  logger: CommandContext["logger"]
): void {
  try {
    const dialect = adapter.getCapabilities().dialect;
    const { table } = generateRuntimeSchema(tableName, fields, dialect);
    const resolver = (
      adapter as unknown as {
        tableResolver?: {
          registerDynamicSchema?: (name: string, t: unknown) => void;
        };
      }
    ).tableResolver;
    if (resolver && typeof resolver.registerDynamicSchema === "function") {
      resolver.registerDynamicSchema(tableName, table);
      logger.debug(`Registered runtime schema for ${tableName}`);
    }
  } catch (err) {
    // Deliberately swallow: subsequent queries in this boot may fail but
    // the next restart rebuilds the resolver from the registry rows.
    logger.debug(
      `Could not register runtime schema for ${tableName}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Perform auto-sync for Singles: create data tables and update migration status
 */
export async function performSinglesAutoSync(
  config: LoadConfigResult["config"],
  adapter: CLIDatabaseAdapter,
  singleRegistry: SingleRegistryService,
  syncResult: SyncSingleResult,
  _options: ResolvedDevOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  // Get Singles that need table creation (created or updated)
  const singlesToSync = [...syncResult.created, ...syncResult.updated];

  if (singlesToSync.length === 0) {
    return;
  }

  logger.newline();
  logger.info(`Auto-syncing ${singlesToSync.length} single table(s)...`);

  // Import the schema service for generating migration SQL
  const { DynamicCollectionSchemaService } = await import(
    "../../domains/dynamic-collections/services/dynamic-collection-schema-service.js"
  );
  const schemaService = new DynamicCollectionSchemaService();

  const synced: string[] = [];
  const errors: Array<{ slug: string; error: string }> = [];

  // Cast adapter once for table existence checks
  const drizzleAdapter = adapter as unknown as DrizzleAdapter;

  const serviceLogger: ServiceLogger = {
    info: (msg: string) => logger.debug(msg),
    warn: (msg: string) => logger.warn(msg),
    error: (msg: string) => logger.error(msg),
    debug: (msg: string) => logger.debug(msg),
  };

  for (const slug of singlesToSync) {
    // Get the Single config to get fields - needed for tableName in catch block
    const singleConfig = config.singles.find(s => s.slug === slug);
    if (!singleConfig) {
      errors.push({ slug, error: "Single config not found" });
      continue;
    }

    // Route through the canonical resolver so DDL and the dynamic_singles
    // registry row always agree on the physical table name, regardless of
    // whether the single config specifies dbName explicitly.
    // Defined outside the try block so it's accessible in catch for verification.
    const tableName = resolveSingleTableName({
      slug,
      dbName: singleConfig.dbName,
    });

    try {
      const tableAlreadyExists = await drizzleAdapter.tableExists(tableName);

      if (tableAlreadyExists) {
        // Table exists — add missing columns via ALTER TABLE (non-destructive)
        const pushService = new SchemaPushService(
          drizzleAdapter,
          serviceLogger
        );

        // Ensure system columns (title, slug) exist — they may be missing
        // on tables created before the fix that added them to the schema.
        // Singles always need title/slug for createDefaultDocument().
        const systemFields = [];
        const hasTitleField = (
          singleConfig.fields as Array<{ name?: string }>
        ).some(f => f.name === "title");
        if (!hasTitleField) {
          systemFields.push({ name: "title", type: "text" });
        }
        const hasSlugField = (
          singleConfig.fields as Array<{ name?: string }>
        ).some(f => f.name === "slug");
        if (!hasSlugField) {
          systemFields.push({ name: "slug", type: "text" });
        }

        const addedColumns = await pushService.addMissingColumnsForFields(
          tableName,
          [...systemFields, ...singleConfig.fields] as unknown as FieldConfig[],
          { timestamps: true }
        );

        if (addedColumns.length > 0) {
          logger.info(
            `Added columns to ${tableName}: ${addedColumns.join(", ")}`
          );
        }

        await singleRegistry.updateMigrationStatus(slug, "applied");
        synced.push(slug);
      } else {
        // Table doesn't exist — create it
        const migrationSQL = schemaService.generateMigrationSQL(
          tableName,
          singleConfig.fields as unknown as FieldDefinition[],
          { isSingle: true }
        );

        const statements = migrationSQL
          .split("--> statement-breakpoint")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0);

        for (const statement of statements) {
          const cleanStatement = statement
            .split("\n")
            .filter((line: string) => !line.trim().startsWith("--"))
            .join("\n")
            .trim();

          if (cleanStatement) {
            await drizzleAdapter.executeQuery(cleanStatement);
          }
        }

        const tableActuallyExists = await drizzleAdapter.tableExists(tableName);

        if (tableActuallyExists) {
          // Register in the live resolver so subsequent queries in the
          // same boot can reach the table without a restart.
          registerSingleTableInResolver(
            drizzleAdapter,
            tableName,
            singleConfig.fields as unknown as FieldDefinition[],
            logger
          );
          await singleRegistry.updateMigrationStatus(slug, "applied");
          synced.push(slug);
          logger.debug(`Created table and set status to 'applied' for ${slug}`);
        } else {
          await singleRegistry.updateMigrationStatus(slug, "failed");
          errors.push({
            slug,
            error: `Table creation SQL executed but table '${tableName}' does not exist`,
          });
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      try {
        await singleRegistry.updateMigrationStatus(slug, "failed");
      } catch {
        // Ignore status update error
      }
      errors.push({ slug, error: errorMsg });
    }
  }

  // Display results
  if (synced.length > 0) {
    logger.success(
      `Synced ${synced.length} single table(s): ${synced.join(", ")}`
    );
  }

  if (errors.length > 0) {
    logger.warn(`${errors.length} single auto-sync error(s):`);
    for (const err of errors) {
      logger.item(`${err.slug}: ${err.error}`, 1);
    }
  }
}

// ============================================================================
// Singles Reconcile (Startup Safety Net)
// ============================================================================

/**
 * Reconcile single tables against the registry.
 *
 * Ensures "registry row implies physical table exists" holds on every dev
 * startup. Runs unconditionally after `performSinglesAutoSync`, which only
 * iterates over newly created/updated singles. This catches the gaps:
 *
 * 1. DB reset while registry metadata was preserved (table rows dropped).
 * 2. Manually dropped tables.
 * 3. Aborted migrations that committed the registry row but failed DDL.
 * 4. Visual-Schema-Builder-created singles whose tables are missing on
 *    restart (code-first sync never sees them).
 *
 * The create path mirrors `performSinglesAutoSync`: build migration SQL
 * via `DynamicCollectionSchemaService`, execute statements one at a time,
 * verify the table now exists, update migration status.
 */
export async function performSinglesReconcile(
  config: LoadConfigResult["config"],
  adapter: CLIDatabaseAdapter,
  singleRegistry: SingleRegistryService,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const drizzleAdapter = adapter as unknown as DrizzleAdapter;

  // Load the schema service lazily so the import cost is paid only when
  // we have work to do.
  const { DynamicCollectionSchemaService } = await import(
    "../../domains/dynamic-collections/services/dynamic-collection-schema-service.js"
  );
  const schemaService = new DynamicCollectionSchemaService();

  const reconciledSlugs: string[] = [];

  await reconcileSingleTables({
    registeredSingles: async () => {
      const records = await singleRegistry.getAllSingles();
      return records.map(r => ({ slug: r.slug, tableName: r.tableName }));
    },
    existingTableNames: async () => {
      const tables = await drizzleAdapter.listTables();
      return new Set(tables);
    },
    createTable: async single => {
      // Prefer code-first config (source of truth) but fall back to the
      // registry's stored fields for UI-created singles.
      const codeFirstConfig = config.singles?.find(s => s.slug === single.slug);
      let fields: FieldDefinition[];
      if (codeFirstConfig) {
        fields = codeFirstConfig.fields as unknown as FieldDefinition[];
      } else {
        const record = await singleRegistry.getSingleBySlug(single.slug);
        if (!record) {
          throw new Error(
            `Cannot reconcile "${single.slug}": registry row disappeared between list and fetch`
          );
        }
        fields = record.fields as unknown as FieldDefinition[];
      }

      const migrationSQL = schemaService.generateMigrationSQL(
        single.tableName,
        fields,
        { isSingle: true }
      );

      const statements = migrationSQL
        .split("--> statement-breakpoint")
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);

      for (const statement of statements) {
        const cleanStatement = statement
          .split("\n")
          .filter((line: string) => !line.trim().startsWith("--"))
          .join("\n")
          .trim();
        if (cleanStatement) {
          await drizzleAdapter.executeQuery(cleanStatement);
        }
      }

      const tableExists = await drizzleAdapter.tableExists(single.tableName);
      if (tableExists) {
        // Register in the live resolver so the very next query in this
        // boot (e.g. the user's nextly.seed.ts calling updateGlobal) can
        // resolve the table without waiting for a restart.
        registerSingleTableInResolver(
          drizzleAdapter,
          single.tableName,
          fields,
          logger
        );
        await singleRegistry.updateMigrationStatus(single.slug, "applied");
        reconciledSlugs.push(single.slug);
        logger.info(
          `Reconciled missing single table: ${single.slug} -> ${single.tableName}`
        );
      } else {
        await singleRegistry.updateMigrationStatus(single.slug, "failed");
        throw new Error(
          `Reconcile ran DDL for "${single.slug}" but table "${single.tableName}" still missing`
        );
      }
    },
  });

  if (reconciledSlugs.length > 0) {
    logger.success(
      `Reconciled ${reconciledSlugs.length} missing single table(s): ${reconciledSlugs.join(", ")}`
    );
  }
}

// ============================================================================
// Components Auto-Sync (Table Creation)
// ============================================================================

/**
 * Perform auto-sync for Components: create data tables and update migration status
 */
export async function performComponentsAutoSync(
  config: LoadConfigResult["config"],
  adapter: CLIDatabaseAdapter,
  componentRegistry: ComponentRegistryService,
  syncResult: SyncComponentResult,
  _options: ResolvedDevOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  // Get Components that need table creation (created or updated)
  const componentsToSync = [...syncResult.created, ...syncResult.updated];

  if (componentsToSync.length === 0) {
    return;
  }

  logger.newline();
  logger.info(`Auto-syncing ${componentsToSync.length} component table(s)...`);

  // Import the component schema service for generating migration SQL
  const { ComponentSchemaService } = await import(
    "../../services/components/component-schema-service.js"
  );
  const dialect = (adapter as unknown as DrizzleAdapter).getCapabilities()
    .dialect;
  const schemaService = new ComponentSchemaService(dialect);

  const synced: string[] = [];
  const errors: Array<{ slug: string; error: string }> = [];

  // Cast adapter once for table existence checks
  const drizzleAdapter = adapter as unknown as DrizzleAdapter;

  const serviceLogger: ServiceLogger = {
    info: (msg: string) => logger.debug(msg),
    warn: (msg: string) => logger.warn(msg),
    error: (msg: string) => logger.error(msg),
    debug: (msg: string) => logger.debug(msg),
  };

  for (const slug of componentsToSync) {
    // Get the Component config to get fields
    const componentConfig = config.components.find(c => c.slug === slug);
    if (!componentConfig) {
      errors.push({ slug, error: "Component config not found" });
      continue;
    }

    // Generate table name using the same convention as the registry (comp_ prefix)
    const tableName =
      componentConfig.dbName ??
      `comp_${slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")}`;

    try {
      const tableAlreadyExists = await drizzleAdapter.tableExists(tableName);

      if (tableAlreadyExists) {
        // Table exists — add missing columns via ALTER TABLE (non-destructive)
        const pushService = new SchemaPushService(
          drizzleAdapter,
          serviceLogger
        );
        const addedColumns = await pushService.addMissingColumnsForFields(
          tableName,
          componentConfig.fields,
          { timestamps: true }
        );

        if (addedColumns.length > 0) {
          logger.info(
            `Added columns to ${tableName}: ${addedColumns.join(", ")}`
          );
        }

        await componentRegistry.updateMigrationStatus(slug, "applied");
        synced.push(slug);
      } else {
        // Table doesn't exist — create it
        const migrationSQL = schemaService.generateMigrationSQL(
          tableName,
          componentConfig.fields
        );

        const statements = migrationSQL
          .split("--> statement-breakpoint")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0);

        for (const statement of statements) {
          const cleanStatement = statement
            .split("\n")
            .filter((line: string) => !line.trim().startsWith("--"))
            .join("\n")
            .trim();

          if (cleanStatement) {
            await drizzleAdapter.executeQuery(cleanStatement);
          }
        }

        const tableActuallyExists = await drizzleAdapter.tableExists(tableName);

        if (tableActuallyExists) {
          await componentRegistry.updateMigrationStatus(slug, "applied");
          synced.push(slug);
          logger.debug(`Created table and set status to 'applied' for ${slug}`);
        } else {
          await componentRegistry.updateMigrationStatus(slug, "failed");
          errors.push({
            slug,
            error: `Table creation SQL executed but table '${tableName}' does not exist`,
          });
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      try {
        await componentRegistry.updateMigrationStatus(slug, "failed");
      } catch {
        // Ignore status update error
      }
      errors.push({ slug, error: errorMsg });
    }
  }

  // Display results
  if (synced.length > 0) {
    logger.success(
      `Synced ${synced.length} component table(s): ${synced.join(", ")}`
    );
  }

  if (errors.length > 0) {
    logger.warn(`${errors.length} component auto-sync error(s):`);
    for (const err of errors) {
      logger.item(`${err.slug}: ${err.error}`, 1);
    }
  }
}
