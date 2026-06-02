/**
 * Migrate Fresh Command
 *
 * Implements the `nextly migrate:fresh` command for dropping all tables
 * and re-running all migrations from scratch.
 *
 * **Runtime restriction (F11):** This module is CLI-only. Do NOT
 * import it from runtime code (init/, route-handler/, dispatcher/, api/,
 * actions/, direct-api/, routeHandler.ts, next.ts). Enforced by ESLint
 * (`no-restricted-imports`); see docs/guides/production-migrations.mdx.
 * `migrate:fresh` is a destructive local-dev convenience and never
 * appropriate for production use.
 *
 * @module cli/commands/migrate-fresh
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # Drop all tables and re-run migrations (with confirmation)
 * nextly migrate:fresh
 *
 * # Skip confirmation prompt
 * nextly migrate:fresh --force
 *
 * # Run seeders after migrations (placeholder)
 * nextly migrate:fresh --seed
 *
 * # Custom config path
 * nextly migrate:fresh --config ./custom/nextly.config.ts
 * ```
 */

import { createInterface } from "node:readline";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { getDialectTables } from "../../database/index";
import { seedAll, type SeederResult } from "../../database/seeders/index";
// F8 PR 2: was `DrizzlePushService` (legacy). Switched to the freshPushSchema
// helper which has the same dialect-aware behavior but is self-contained
// (no class state, no preview/apply duality).
import { freshPushSchema } from "../../domains/schema/pipeline/fresh-push";
import type { SupportedDialect } from "../../domains/schema/services/schema-generator";
import { createContext, type CommandContext } from "../program";
import {
  createAdapter,
  validateDatabaseEnv,
  getDialectDisplayName,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { loadConfig, type LoadConfigResult } from "../utils/config-loader";
import { formatDuration, formatCount } from "../utils/logger";

import { runMigrate } from "./migrate";

// ============================================================================
// Types
// ============================================================================

/**
 * Options specific to the migrate:fresh command
 */
export interface MigrateFreshCommandOptions {
  /**
   * Skip confirmation prompt.
   * @default false
   */
  force?: boolean;

  /**
   * Run seeders after migrations.
   * @default false
   */
  seed?: boolean;
}

/**
 * Combined options (global + command-specific)
 */
interface ResolvedMigrateFreshOptions extends MigrateFreshCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

/**
 * Result of the fresh command
 */
interface MigrateFreshResult {
  /** Number of tables dropped */
  tablesDropped: number;
  /** Names of dropped tables */
  droppedTables: string[];
  /** Duration of drop operation in milliseconds */
  dropDurationMs: number;
  /** Whether migrations were run */
  migrationsRun: boolean;
}

// ============================================================================
// Migrate Fresh Command Implementation
// ============================================================================

/**
 * Execute the migrate:fresh command
 *
 * @param options - Combined global and command options
 * @param context - Command context with logger
 */
export async function runMigrateFresh(
  options: ResolvedMigrateFreshOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const startTime = Date.now();

  logger.header("Migrate Fresh");

  // Step 1: Validate database environment
  logger.debug("Validating database environment...");
  const dbValidation = validateDatabaseEnv();

  if (!dbValidation.valid) {
    for (const error of dbValidation.errors) {
      logger.error(error);
    }
    logger.newline();
    logger.info(
      "Set DATABASE_URL and optionally DB_DIALECT environment variables."
    );
    process.exit(1);
  }

  const dialect = dbValidation.dialect!;
  logger.debug(`Database dialect: ${dialect}`);

  // Step 2: Load configuration
  logger.info("Loading configuration...");

  let configResult: LoadConfigResult;
  try {
    configResult = await loadConfig({
      configPath: options.config,
      cwd: options.cwd,
      debug: options.verbose,
    });
  } catch (error) {
    logger.error(
      `Failed to load config: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  if (configResult.configPath) {
    logger.success(`Loaded config from ${configResult.configPath}`);
  } else {
    logger.warn("No config file found, using defaults");
  }

  logger.keyValue("Dialect", getDialectDisplayName(dialect));

  // Step 3: Show warning and get confirmation
  logger.newline();
  logger.warn("This command will DROP ALL TABLES in your database.");
  logger.warn("All data will be permanently lost.");

  if (!options.force) {
    const confirmed = await confirmDestructiveAction(
      "Are you sure you want to proceed? (yes/no): "
    );

    if (!confirmed) {
      logger.newline();
      logger.info("Operation cancelled.");
      process.exit(0);
    }
  } else {
    logger.debug("Skipping confirmation (--force flag used)");
  }

  // Step 4: Connect to database
  logger.newline();
  logger.info(`Connecting to ${getDialectDisplayName(dialect)}...`);

  let adapter: CLIDatabaseAdapter;
  try {
    adapter = await createAdapter({
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
      logger: options.verbose ? logger : undefined,
    });
    logger.success("Database connected");
  } catch (error) {
    logger.error(
      `Failed to connect to database: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  try {
    // Step 5: Discover and drop all tables
    logger.newline();
    logger.info("Discovering tables...");

    const dropStartTime = Date.now();
    const result = await dropAllTables(
      adapter as unknown as DrizzleAdapter,
      dialect,
      context
    );

    const dropDuration = Date.now() - dropStartTime;

    if (result.tablesDropped === 0) {
      logger.info("No tables found to drop.");
    } else {
      logger.success(
        `Dropped ${formatCount(result.tablesDropped, "table")} in ${formatDuration(dropDuration)}`
      );
    }

    // Step 6: Re-run all migrations (or push schema for SQLite)
    logger.newline();
    logger.divider();
    logger.newline();

    logger.info("Running all migrations...");
    logger.newline();

    // All dialects reconcile through the consolidated migrate path:
    // Phase 1 creates core tables from getDialectTables (single source of
    // truth) + bootstraps the nextly_schema_events ledger; Phase 2 applies
    // user migration files. (The old SQLite "push hardcoded DDL directly"
    // special-case created legacy nextly_migrations/content_schema_events
    // tables that then tripped the Phase 0 legacy-bookkeeping gate.)
    await runMigrate(
      {
        config: options.config,
        verbose: options.verbose,
        quiet: options.quiet,
        cwd: options.cwd,
      },
      context
    );

    // Step 7: Run a MySQL schema reconciliation pass before seeding.
    // This protects migrate:fresh --seed from historical MySQL migration drift
    // where a migration set may be missing a subset of tables/columns.
    if (options.seed && dialect === "mysql") {
      await reconcileMysqlSchema(adapter as unknown as DrizzleAdapter, context);
    }

    // Step 8: Run seeders if requested
    if (options.seed) {
      await performSeeding(adapter, options, context);
    }

    // Step 9: Display final summary
    const totalDuration = Date.now() - startTime;
    logger.newline();
    logger.divider();
    logger.success(
      `Fresh migration completed in ${formatDuration(totalDuration)}`
    );
  } finally {
    await adapter.disconnect();
  }
}

// ============================================================================
// Table Discovery and Dropping
// ============================================================================

/**
 * Drop all tables from the database
 */
async function dropAllTables(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  context: CommandContext
): Promise<MigrateFreshResult> {
  const { logger } = context;

  // Get list of all tables
  const tables = await discoverTables(adapter, dialect);

  if (tables.length === 0) {
    return {
      tablesDropped: 0,
      droppedTables: [],
      dropDurationMs: 0,
      migrationsRun: false,
    };
  }

  logger.debug(`Found ${tables.length} table(s): ${tables.join(", ")}`);

  const startTime = Date.now();

  // Disable foreign key constraints before dropping
  await disableForeignKeyChecks(adapter, dialect);

  try {
    // Drop each table
    for (const table of tables) {
      logger.debug(`Dropping table: ${table}`);
      await dropTable(adapter, dialect, table);
    }
  } finally {
    // Re-enable foreign key constraints
    await enableForeignKeyChecks(adapter, dialect);
  }

  return {
    tablesDropped: tables.length,
    droppedTables: tables,
    dropDurationMs: Date.now() - startTime,
    migrationsRun: false,
  };
}

/**
 * Discover all user tables in the database
 */
async function discoverTables(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<string[]> {
  let query: string;

  switch (dialect) {
    case "postgresql":
      // Get all tables from public schema, excluding system tables
      query = `
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `;
      break;

    case "mysql":
      // Get all tables from current database
      query = `
        SELECT TABLE_NAME as tablename
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
      `;
      break;

    case "sqlite":
      // Get all tables from sqlite_master
      query = `
        SELECT name as tablename
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `;
      break;

    default:
      throw new Error(`Unsupported dialect: ${String(dialect)}`);
  }

  try {
    const results = await adapter.executeQuery<{ tablename: string }>(query);
    return results.map(row => row.tablename);
  } catch {
    // Database might be empty or inaccessible
    return [];
  }
}

/**
 * Disable foreign key checks to allow dropping tables with dependencies
 */
async function disableForeignKeyChecks(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<void> {
  let query: string;

  switch (dialect) {
    case "postgresql":
      // PostgreSQL: Use session_replication_role to disable triggers
      // This disables all triggers including FK checks
      query = "SET session_replication_role = 'replica'";
      break;

    case "mysql":
      query = "SET FOREIGN_KEY_CHECKS = 0";
      break;

    case "sqlite":
      query = "PRAGMA foreign_keys = OFF";
      break;

    default:
      throw new Error(`Unsupported dialect: ${String(dialect)}`);
  }

  await adapter.executeQuery(query);
}

/**
 * Re-enable foreign key checks after dropping tables
 */
async function enableForeignKeyChecks(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<void> {
  let query: string;

  switch (dialect) {
    case "postgresql":
      query = "SET session_replication_role = 'origin'";
      break;

    case "mysql":
      query = "SET FOREIGN_KEY_CHECKS = 1";
      break;

    case "sqlite":
      query = "PRAGMA foreign_keys = ON";
      break;

    default:
      throw new Error(`Unsupported dialect: ${String(dialect)}`);
  }

  await adapter.executeQuery(query);
}

/**
 * Drop a single table
 */
async function dropTable(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  tableName: string
): Promise<void> {
  let query: string;

  // Properly quote the table name based on dialect
  switch (dialect) {
    case "postgresql":
      query = `DROP TABLE IF EXISTS "${tableName}" CASCADE`;
      break;

    case "sqlite":
      // SQLite doesn't support CASCADE on DROP TABLE
      // Foreign key constraints are handled by disabling FK checks before dropping
      query = `DROP TABLE IF EXISTS "${tableName}"`;
      break;

    case "mysql":
      query = `DROP TABLE IF EXISTS \`${tableName}\``;
      break;

    default:
      throw new Error(`Unsupported dialect: ${String(dialect)}`);
  }

  await adapter.executeQuery(query);
}

// ============================================================================
// Confirmation Helper
// ============================================================================

/**
 * Prompt user for confirmation of destructive action
 */
async function confirmDestructiveAction(prompt: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      const normalizedAnswer = answer.toLowerCase().trim();
      resolve(normalizedAnswer === "yes" || normalizedAnswer === "y");
    });
  });
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Register the migrate:fresh command with the program
 *
 * @param program - Commander program instance
 */
export function registerMigrateFreshCommand(program: Command): void {
  program
    .command("migrate:fresh")
    .description("Drop all tables and re-run all migrations")
    .option("-f, --force", "Skip confirmation prompt", false)
    .option("--seed", "Run seeders after migrations", false)
    .action(async (cmdOptions: MigrateFreshCommandOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);

      const resolvedOptions: ResolvedMigrateFreshOptions = {
        ...cmdOptions,
        config: globalOpts.config,
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
        cwd: globalOpts.cwd,
      };

      try {
        await runMigrateFresh(resolvedOptions, context);
      } catch (error) {
        context.logger.error(
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}

// ============================================================================
// Seeding
// ============================================================================

/**
 * Reconcile MySQL schema against current Drizzle table definitions.
 *
 * This is intentionally scoped to `migrate:fresh --seed` because seeding
 * requires core tables to exist. If migrations miss a table due to legacy
 * drift, this pass creates the missing objects before seeders run.
 */
async function reconcileMysqlSchema(
  adapter: DrizzleAdapter,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  logger.newline();
  logger.info("Reconciling MySQL schema before seeding...");

  try {
    const db = adapter.getDrizzle();
    const staticSchemas = getDialectTables("mysql");
    const result = await freshPushSchema("mysql", db, staticSchemas);

    if (result.statementsExecuted.length > 0) {
      logger.debug(
        `[schema] Applied ${result.statementsExecuted.length} reconciliation statement(s)`
      );
    } else {
      logger.debug("[schema] No reconciliation changes needed");
    }
  } catch (error) {
    // Reconciliation is a safety net for historical MySQL drift. Do not
    // block migrate:fresh --seed if drizzle-kit emits duplicate/constraint
    // alteration errors after migrations have already created the schema.
    const message = error instanceof Error ? error.message : String(error);
    if (isKnownMysqlReconcileDriftError(message)) {
      logger.debug(
        "[schema] Skipping known MySQL reconciliation drift (media FK already reconciled)"
      );
    } else {
      logger.warn(`MySQL schema reconciliation skipped: ${message}`);
      logger.debug(
        "Continuing with seeders after non-fatal reconciliation error"
      );
    }
  }
}

/**
 * Identify known non-fatal MySQL reconciliation drift errors.
 */
function isKnownMysqlReconcileDriftError(message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("alter table `media` add constraint") &&
    (normalized.includes("media_uploaded_by_users_id_fk") ||
      normalized.includes("media_folder_id_media_folders_id_fk"))
  );
}

/**
 * Run database seeders
 */
async function performSeeding(
  adapter: CLIDatabaseAdapter,
  options: ResolvedMigrateFreshOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  logger.newline();
  logger.info("Running database seeders...");

  let result: SeederResult;
  try {
    result = await seedAll(adapter as unknown as DrizzleAdapter, {
      silent: true, // We'll handle logging ourselves
      skipSuperAdmin: true,
    });
  } catch (error) {
    logger.error(
      `Seeding failed: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }

  // Display seeding results
  displaySeedingResults(result, options, context);
}

/**
 * Display seeding results
 */
function displaySeedingResults(
  result: SeederResult,
  options: ResolvedMigrateFreshOptions,
  context: CommandContext
): void {
  const { logger } = context;

  if (result.success) {
    // Check if this was a fresh seed or everything was already seeded
    const isAlreadySeeded = result.created === 0 && result.skipped > 0;

    if (isAlreadySeeded) {
      // Database was already seeded - just show a brief message
      logger.success("Database already seeded (skipped)");
      if (options.verbose) {
        logger.debug(`${result.skipped} seed entries already exist`);
      }
    } else if (result.created > 0) {
      // Fresh seed - show full details
      const parts: string[] = [];
      parts.push(`${result.created} created`);
      if (result.skipped > 0) {
        parts.push(`${result.skipped} skipped`);
      }

      const summary = ` (${parts.join(", ")})`;
      logger.success(`Seeding completed${summary}`);
    } else {
      // Nothing to seed
      logger.success("Seeding completed (nothing to seed)");
    }
  } else {
    logger.error(`Seeding failed with ${result.errors} error(s)`);
    if (result.errorMessages && options.verbose) {
      for (const msg of result.errorMessages) {
        logger.item(msg, 1);
      }
    }
  }
}

