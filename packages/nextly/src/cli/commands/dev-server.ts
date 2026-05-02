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

import type { FieldConfig } from "../../collections/fields/types/index";
import { getDialectTables } from "../../database/index";
import { SchemaRegistry } from "../../database/schema-registry";
import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables";
// F8 PR 1: per-call factory pattern (matches reload-config.ts) so the
// MySQL `databaseName` can be threaded through to drizzle-kit.pushSchema.
// The DI-bound `applyDesiredSchema` from pipeline/index.ts throws on
// MySQL because it has no caller-supplied URL. Once F8 PR 2/3 collapses
// the two paths, this can collapse back to a single import.
import { createApplyDesiredSchema } from "../../domains/schema/pipeline/apply";
import { RealClassifier } from "../../domains/schema/pipeline/classifier/classifier";
import { extractDatabaseNameFromUrl } from "../../domains/schema/pipeline/database-url";
// F8 PR 2: ensureCoreTables now uses the freshPushSchema helper for
// the static-tables push. The legacy DrizzlePushService import is gone.
import { freshPushSchema } from "../../domains/schema/pipeline/fresh-push";
import { RealPreCleanupExecutor } from "../../domains/schema/pipeline/pre-cleanup/executor";
import { ClackTerminalPromptDispatcher } from "../../domains/schema/pipeline/prompt-dispatcher/clack-terminal";
import { noopPreRenameExecutor } from "../../domains/schema/pipeline/pushschema-pipeline-stubs";
import { PushSchemaPipeline } from "../../domains/schema/pipeline/pushschema-pipeline";
import { RegexRenameDetector } from "../../domains/schema/pipeline/rename-detector";
import type {
  DesiredCollection,
  DesiredSchema,
  DesiredSingle,
} from "../../domains/schema/pipeline/types";
import { DrizzleStatementExecutor } from "../../domains/schema/services/drizzle-statement-executor";
import { generateRuntimeSchema } from "../../domains/schema/services/runtime-schema-generator";
// F8 PR 1: SchemaPushService dropped from this module. The env check
// (was getEnvironment().isProduction) is now an inline NODE_ENV read.
// The legacy fallback sync path is deleted (dead code post-Option E).
// addMissingColumnsForFields is extracted to utils/missing-columns.ts.
import { addMissingColumnsForFields } from "../../domains/schema/utils/missing-columns";
import { getProductionNotifier } from "../../runtime/notifications/index";
import { reconcileSingleTables } from "../../domains/singles/services/reconcile-single-tables";
import { resolveSingleTableName } from "../../domains/singles/services/resolve-single-table-name";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import type { CollectionSyncResultWithValidation } from "../../services/collections/collection-sync-service";
import {
  type ComponentRegistryService,
  type SyncComponentResult,
} from "../../services/components/component-registry-service";
import type { Logger as ServiceLogger } from "../../services/shared/types";
import {
  type SingleRegistryService,
  type SyncSingleResult,
} from "../../services/singles/single-registry-service";
import type { CommandContext } from "../program";
import type { CLIDatabaseAdapter } from "../utils/adapter";
import type { LoadConfigResult } from "../utils/config-loader";
import { formatDuration } from "../utils/logger";

import type { ResolvedDevOptions } from "./db-sync";

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

  // F8 PR 2: use the freshPushSchema helper for the static-tables push.
  // No diff, no prompts, no journal — this is fresh-DB setup, not a user
  // schema change. Behavior matches the legacy DrizzlePushService.apply
  // verbatim (PG: pushSchema().apply; SQLite: manual statement loop;
  // MySQL: generateMigration path).
  try {
    const db = drizzleAdapter.getDrizzle();
    const staticSchemas = getDialectTables(dialect);
    const result = await freshPushSchema(dialect, db, staticSchemas);

    if (result.statementsExecuted.length > 0) {
      logger.debug(
        `[schema] Created ${result.statementsExecuted.length} tables via pushSchema`
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
          "../../services/system/system-table-service"
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

  // F8 PR 1: --force is no longer load-bearing. Pre-pipeline, --force
  // routed through SchemaPushService.syncSchema and controlled drop+
  // recreate behavior. The new pipeline owns destructive-op handling
  // via the Classifier + PromptDispatcher: ambiguous renames trigger
  // confirmations, real drops require explicit prompts. The flag is
  // kept on the CLI surface for backward compatibility but emits a
  // deprecation warning so users know it has no effect today.
  if (options.force) {
    logger.warn(
      "[schema] --force has no effect with the new pipeline. " +
        "Destructive ops are handled by interactive prompts; non-interactive " +
        "runs use NEXTLY_ACCEPT_DATA_LOSS=1 instead."
    );
  }

  // Production guard: never auto-apply schema in production. Users must
  // explicitly run `nextly migrate:generate` + `nextly migrate:run`. F8
  // PR 1 inlined this check (was SchemaPushService.getEnvironment()).
  if (process.env.NODE_ENV === "production") {
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

  const start = Date.now();
  const drizzleAdapter = adapter as unknown as DrizzleAdapter;
  const dialect = drizzleAdapter.getCapabilities().dialect;

  // Build a SchemaRegistry with static + dynamic tables. Even though the
  // pipeline runs its own diff/apply, the SchemaRegistry is still needed
  // here to wire `setTableResolver` so adapter CRUD on dynamic tables
  // works for the rest of this CLI invocation (seed scripts, etc.).
  const schemaRegistry = new SchemaRegistry(dialect);
  const staticSchemas = getDialectTables(dialect);
  schemaRegistry.registerStaticSchemas(staticSchemas);

  // F8 PR 1: collections flow through the F2 applyDesiredSchema pipeline
  // (rename detection + classifier + pre-cleanup + pushSchema, all inside
  // a transaction on PG/SQLite). Build the desired-collections bucket
  // alongside the runtime-schema registration for the resolver.
  const desiredCollections: Record<string, DesiredCollection> = {};
  for (const collection of config.collections) {
    const baseTableName =
      collection.dbName ?? collection.slug.replace(/-/g, "_");
    const tableName = baseTableName.startsWith("dc_")
      ? baseTableName
      : `dc_${baseTableName}`;

    const fields = (collection.fields ?? []) as FieldDefinition[];
    desiredCollections[collection.slug] = {
      slug: collection.slug,
      tableName,
      fields: fields as DesiredCollection["fields"],
    };

    // Register in the live SchemaRegistry so subsequent adapter queries in
    // the same CLI run can resolve the dynamic tables via Drizzle.
    if (fields.length > 0) {
      const { table } = generateRuntimeSchema(tableName, fields, dialect);
      schemaRegistry.registerDynamicSchema(tableName, table);
    }
  }

  // Build the desired-singles bucket the same way collections are built.
  // Without this, the pipeline never introspects single_* tables and
  // treats them as "not managed" — renames become drop+add and new fields
  // never propagate on `nextly dev` restart.
  const { resolveSingleTableName } = await import(
    "../../domains/singles/services/resolve-single-table-name"
  );
  const desiredSingles: Record<string, DesiredSingle> = {};
  for (const single of config.singles ?? []) {
    if (!single.slug) continue;
    const singleTableName = resolveSingleTableName({
      slug: single.slug,
      dbName: single.dbName,
    });
    const singleFields = (single.fields ?? []) as FieldDefinition[];
    desiredSingles[single.slug] = {
      slug: single.slug,
      tableName: singleTableName,
      fields: singleFields as DesiredSingle["fields"],
    };
    if (singleFields.length > 0) {
      const { table } = generateRuntimeSchema(singleTableName, singleFields, dialect);
      schemaRegistry.registerDynamicSchema(singleTableName, table);
    }
  }

  const desired: DesiredSchema = {
    collections: desiredCollections,
    singles: desiredSingles,
    components: {},
  };

  // Per-call factory so MySQL `databaseName` flows into PushSchemaPipeline.
  // Mirrors the pattern in init/reload-config.ts. The DI-bound entry point
  // in pipeline/index.ts can't auto-extract `databaseName` from the
  // connection URL, so MySQL boots crash there with a "MySQL requires
  // databaseName" error. This local factory closes the gap until F8 PR 2/3
  // collapses the two paths.
  const db = drizzleAdapter.getDrizzle();
  const databaseName =
    dialect === "mysql"
      ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
      : undefined;

  // F8 PR 5: construct the journal inline — db-sync runs in CLI
  // context where DI is not yet initialized. The service writes
  // directly to nextly_migration_journal once that table exists
  // (created earlier by ensureCoreTables).
  const { DrizzleMigrationJournal } = await import(
    "../../domains/schema/journal/migration-journal"
  );
  const cliMigrationJournal = new DrizzleMigrationJournal({
    db,
    dialect,
    logger: {
      debug: msg => logger.debug(msg),
      info: msg => logger.info(msg),
      warn: msg => logger.warn(msg),
      error: msg => logger.error(msg),
    },
  });

  const apply = createApplyDesiredSchema({
    applyPipeline: (desiredArg, sourceArg, channelArg) => {
      const pipeline = new PushSchemaPipeline({
        executor: new DrizzleStatementExecutor(dialect, db),
        renameDetector: new RegexRenameDetector(),
        classifier: new RealClassifier(),
        promptDispatcher: new ClackTerminalPromptDispatcher(),
        preRenameExecutor: noopPreRenameExecutor,
        preCleanupExecutor: new RealPreCleanupExecutor(),
        migrationJournal: cliMigrationJournal,
        // F10 PR 3: db-sync CLI applies print a terminal box + write
        // the NDJSON line. Same singleton across CLI invocations.
        notifier: getProductionNotifier(),
      });
      return pipeline.apply({
        desired: desiredArg,
        db,
        dialect,
        source: sourceArg,
        promptChannel: channelArg,
        databaseName,
      });
    },
    // db-sync runs before any UI version-conflict-relevant state — these
    // can be no-op resolvers (matches reload-config.ts).
    readSchemaVersionForSlug: () => Promise.resolve(null),
    readNewSchemaVersionsForSlugs: () => Promise.resolve({}),
  });

  let result: Awaited<ReturnType<typeof apply>>;
  try {
    // 'code' is correct for db-sync flows: this is a config-driven apply,
    // same family as a code-first HMR cycle. The pipeline's terminal
    // PromptDispatcher is reached only when there's a real ambiguity
    // (drop+add pairs flagged as rename candidates) — db-sync runs in a
    // TTY so that's safe.
    result = await apply(desired, "code", { promptChannel: "terminal" });
  } catch (error) {
    // Catastrophic failures (DB connection lost, etc.) reach here. The
    // pipeline's typed errors come back as { success: false } — those are
    // handled below.
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Auto-sync failed: ${msg}`);
    throw error;
  }

  if (!result.success) {
    logger.error(
      `Auto-sync failed (${result.error.code}): ${result.error.message}`
    );
    throw new Error(`Schema apply failed: ${result.error.message}`);
  }

  if (result.statementsExecuted > 0) {
    logger.info(
      `[schema] Applied ${result.statementsExecuted} schema change(s) via pipeline`
    );
  } else {
    logger.debug("[schema] Database schema is in sync");
  }

  // Set table resolver so adapter CRUD uses Drizzle query API
  drizzleAdapter.setTableResolver(schemaRegistry);

  // Update dynamic_collections.migration_status for every collection whose
  // physical table now exists. Mirrors pre-pipeline behavior so admin UI
  // reads stay consistent.
  //
  // F8 PR 1: use the already-computed tableName from desiredCollections
  // so collections with a custom `dbName` resolve correctly. The pre-
  // pipeline code recomputed `dc_<slug>` here unconditionally, which
  // ignored `dbName` overrides. Now we honor them.
  for (const collection of config.collections) {
    try {
      const tableName =
        desiredCollections[collection.slug]?.tableName ??
        `dc_${collection.slug.replace(/-/g, "_")}`;
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
      // Ignore errors updating migration status — non-critical metadata.
    }
  }

  logger.success(
    `Schema synced via pipeline in ${formatDuration(Date.now() - start)}`
  );
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
    "../../domains/dynamic-collections/services/dynamic-collection-schema-service"
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
        // Table exists — add missing columns via the extracted util
        // (F8 PR 1; was SchemaPushService.addMissingColumnsForFields).
        // Behavior preserved: NOT NULL is silently stripped on every
        // added column to avoid violating constraints on existing rows.

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

        const addedColumns = await addMissingColumnsForFields(
          drizzleAdapter,
          serviceLogger,
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
    "../../domains/dynamic-collections/services/dynamic-collection-schema-service"
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
    "../../services/components/component-schema-service"
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
        // Table exists — add missing columns via the extracted util
        // (F8 PR 1; was SchemaPushService.addMissingColumnsForFields).
        const addedColumns = await addMissingColumnsForFields(
          drizzleAdapter,
          serviceLogger,
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
