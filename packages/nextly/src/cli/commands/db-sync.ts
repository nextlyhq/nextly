/**
 * db:sync Command
 *
 * Implements the `nextly db:sync` command (aliased as `nextly sync`).
 * Loads configuration, syncs collections, and generates schema/type files.
 *
 * Renamed from the former `nextly dev` command in Task 11. The `nextly dev`
 * name is now reserved for the wrapper CLI (Sub-task 3) that spawns next dev
 * and handles schema change prompts. This one-shot utility handles:
 *
 * - First-time setup (permissions seeded automatically; demo content via admin UI)
 * - Config-file watching (`--watch` re-syncs on nextly.config.ts changes)
 * - Type generation (`--types` emits payload-types.ts)
 *
 * ## Auto-Sync Mode (Development Only)
 *
 * In development mode (NODE_ENV !== 'production'), this command automatically
 * syncs schema changes to the database without creating migration files.
 * Dev databases are treated as sandboxes where schema changes are
 * auto-applied without migration files.
 *
 * **WARNING:** Auto-sync may cause data loss when tables are recreated.
 * Use `--no-auto-sync` to disable this behavior and use migrations instead.
 *
 * This entry module owns command registration and the top-level `runDbSync`
 * orchestration. The underlying sync, schema push, display, and watch
 * implementations live in sibling modules:
 *
 * - `dev-server.ts` - core table bootstrapping, schema push, auto-sync
 * - `dev-build.ts` - config-driven registry sync, permission/user seeding
 * - `dev-display.ts` - user-facing output formatting
 * - `dev-watcher.ts` - debounced watch-mode re-sync
 *
 * @module cli/commands/db-sync
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # Basic usage - sync once with auto-sync
 * nextly db:sync
 *
 * # Short alias
 * nextly sync
 *
 * # Watch for config changes with auto-sync
 * nextly db:sync --watch
 *
 * # Skip type generation
 * nextly db:sync --no-types
 *
 * # Disable auto-sync (use migrations)
 * nextly db:sync --no-auto-sync
 *
 * # Force auto-sync without warnings
 * nextly db:sync --force
 *
 * # Custom config path
 * nextly db:sync --config ./custom/nextly.config.ts
 * ```
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { Command } from "commander";

import { getDialectTables } from "../../database/index";
import { SchemaRegistry } from "../../database/schema-registry";
import {
  createContext,
  type CommandContext,
  type GlobalOptions,
} from "../program";
import {
  createAdapter,
  validateDatabaseEnv,
  getDialectDisplayName,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import {
  loadConfig,
  watchConfig,
  clearConfigCache,
  type LoadConfigResult,
} from "../utils/config-loader";
import { formatDuration } from "../utils/logger";

import {
  performPermissionSeeding,
  syncCollections,
  syncComponents,
  syncSingles,
  syncUserFields,
} from "./dev-build";
import { ensureCoreTables } from "./dev-server";
import { createDebouncedSync } from "./dev-watcher";

// ============================================================================
// Types
// ============================================================================

/**
 * Options specific to the dev command
 */
export interface DbSyncCommandOptions {
  /**
   * Watch for config file changes
   * @default false
   */
  watch?: boolean;

  /**
   * Generate TypeScript types (payload-types.ts)
   * @default false (types are not generated unless explicitly requested)
   */
  types?: boolean;

  /**
   * Generate Drizzle schema files to src/db/schemas/dynamic/
   * @default false (schemas are not generated unless explicitly requested)
   */
  schemas?: boolean;

  /**
   * Enable auto-sync of schema changes to database
   * In development mode, this is enabled by default.
   * Use --no-auto-sync to disable and require migrations.
   * @default true (in development mode)
   */
  autoSync?: boolean;

  /**
   * Force auto-sync without data loss warnings
   * @default false
   */
  force?: boolean;

  /**
   * Run database seeders after sync
   * Seeds permissions and super admin user
   * @default false
   */
  seed?: boolean;

  /**
   * Remove orphaned code-first entities from the database.
   * Entities that exist in the DB with source='code' but are no longer
   * defined in the config will be deleted (registry entry + data table).
   * @default false
   */
  removeOrphaned?: boolean;
}

/**
 * Combined options (global + dev-specific)
 *
 * Exported so sibling modules (dev-server, dev-build, dev-watcher, dev-display)
 * can type function signatures consistently.
 */
export interface ResolvedDevOptions extends DbSyncCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

// ============================================================================
// Dev Command Implementation
// ============================================================================

/**
 * Execute the dev command
 *
 * @param options - Combined global and command options
 * @param context - Command context with logger
 */
export async function runDbSync(
  options: ResolvedDevOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const startTime = Date.now();

  logger.header("Nextly Dev");

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

  logger.debug(`Database dialect: ${dbValidation.dialect}`);

  // Step 2: Load configuration
  logger.info("Loading configuration...");

  let configResult: LoadConfigResult;
  try {
    configResult = await loadConfig({
      configPath: options.config,
      cwd: options.cwd,
      watch: options.watch,
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

  const collectionCount = configResult.config.collections.length;
  const singleCount = configResult.config.singles.length;
  const componentCount = configResult.config.components.length;
  const userFieldCount = configResult.config.users?.fields?.length ?? 0;
  logger.keyValue("Collections", collectionCount);
  logger.keyValue("Singles", singleCount);
  logger.keyValue("Components", componentCount);
  logger.keyValue("User Fields (code)", userFieldCount);

  // Step 3: Connect to database (needed for seeding even without collections)
  logger.newline();
  logger.info(
    `Connecting to ${getDialectDisplayName(dbValidation.dialect!)}...`
  );

  let adapter: CLIDatabaseAdapter;
  try {
    adapter = await createAdapter({
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
      logger: options.verbose ? logger : undefined,
    });
    logger.success("Database connected");

    // Immediately set up SchemaRegistry with static system tables so that
    // queries to system tables (users, dynamic_collections, etc.) work via
    // the Drizzle query API path. This MUST happen before any sync or seed
    // operations that query these tables.
    const dialect = (adapter as unknown as DrizzleAdapter).getCapabilities()
      .dialect;
    const earlyRegistry = new SchemaRegistry(dialect);
    const staticSchemas = getDialectTables(dialect);
    earlyRegistry.registerStaticSchemas(staticSchemas);
    (adapter as unknown as DrizzleAdapter).setTableResolver(earlyRegistry);
    logger.debug("Schema registry initialized with static tables");
  } catch (error) {
    logger.error(
      `Failed to connect to database: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  try {
    // Step 3.5: Ensure core tables exist.
    // For fresh databases, the system tables (users, roles, permissions,
    // dynamic_collections, etc.) must exist before any sync or query.
    // Uses drizzle-kit pushSchema() to create ALL tables from the Drizzle
    // schema definitions, guaranteeing they match 100%.
    await ensureCoreTables(adapter, options, context);

    // Step 4: Sync collections (only if there are collections to sync)
    if (collectionCount > 0 || options.removeOrphaned) {
      await syncCollections(configResult, adapter, options, context);
    } else {
      logger.warn("No collections defined in config");
      logger.info("Add collections to your nextly.config.ts to get started.");
    }

    // Step 5: Sync singles (only if there are singles to sync)
    if (singleCount > 0 || options.removeOrphaned) {
      await syncSingles(configResult, adapter, options, context);
    }

    // Step 5.5: Sync components (only if there are components to sync)
    if (componentCount > 0 || options.removeOrphaned) {
      await syncComponents(configResult, adapter, options, context);
    }

    // Step 5.6: Sync user_ext table (always — handles both code and UI fields)
    await syncUserFields(configResult, adapter, options, context);

    // Step 5.7: Seed permissions for collections and singles (always, idempotent).
    // After task 24 phase 3 this is the only seeding `db:sync` performs:
    // demo content seeding moved to a Payload-style admin-triggered POST
    // route in the project itself (src/app/admin/api/seed/route.ts).
    await performPermissionSeeding(adapter, options, context);

    // Step 7: Watch mode (only makes sense with collections or singles)
    if (options.watch && (collectionCount > 0 || singleCount > 0)) {
      logger.newline();
      logger.divider();
      logger.info("Watching for config changes... (press Ctrl+C to stop)");
      logger.newline();

      // Create debounced sync function to handle rapid file changes
      const debouncedSync = createDebouncedSync(adapter, options, context);

      // Register watch callback. Synchronous on purpose - debouncedSync
      // schedules its own async work; the callback itself has nothing to
      // await, so flagging it async triggered
      // @typescript-eslint/require-await + no-misused-promises.
      watchConfig(newConfigResult => {
        debouncedSync(newConfigResult);
      });

      // Keep process alive
      await new Promise(() => {
        // This promise never resolves - keeps the process running
        // User must press Ctrl+C to exit
      });
    } else {
      // One-time sync complete
      const duration = Date.now() - startTime;
      logger.newline();
      logger.divider();
      logger.success(`Dev sync completed in ${formatDuration(duration)}`);
    }
  } finally {
    // Cleanup on exit (only for non-watch mode)
    if (!options.watch) {
      await adapter.disconnect();
      clearConfigCache();
    }
  }
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Register the dev command with the program
 *
 * @param program - Commander program instance
 */
// What: registers `nextly db:sync` (with `nextly sync` as a shorter alias).
// Why: this command used to be `nextly dev`. Task 11 renamed it so the
// `nextly dev` name can be reused in Sub-task 3 for the new wrapper CLI
// that spawns `next dev` and owns schema change prompts. Task 24 phase 3
// also dropped the `--seed` flag — demo seeding is now Payload-style and
// runs from the project's auth-gated POST route.
export function registerDbSyncCommand(program: Command): void {
  program
    .command("db:sync")
    .alias("sync")
    .description("Sync database schema with nextly.config.ts.")
    .option("-w, --watch", "Watch for config file changes", false)
    .option("--types", "Generate TypeScript types (payload-types.ts)", false)
    .option(
      "--schemas",
      "Generate Drizzle schema files to src/db/schemas/dynamic/",
      false
    )
    .option(
      "--no-auto-sync",
      "Disable auto-sync of schema changes (use migrations instead)"
    )
    .option("-f, --force", "Force auto-sync without data loss warnings", false)
    .option(
      "--remove-orphaned",
      "Remove code-first collections/singles/components that no longer exist in config",
      false
    )
    // Task 11: migrate collection ownership between code and UI sources.
    // --promote moves a UI-owned collection to code; --demote does the
    // reverse. Either flag bypasses the normal sync flow and runs the
    // dedicated handler. See conflict-detector for the reason these exist.
    .option(
      "--promote <slug>",
      "Move a UI-owned collection to code (prints TS snippet, removes UI record)"
    )
    .option(
      "--demote <slug>",
      "Move a code-owned collection to UI (writes to dynamic_collections)"
    )
    // Task 11: CI / Docker escape hatch matching Prisma's --accept-data-loss
    // convention. Sets NEXTLY_ACCEPT_DATA_LOSS=1 for the rest of the run so
    // non-TTY destructive prompts auto-confirm instead of refusing.
    .option(
      "--accept-data-loss",
      "Apply destructive schema changes without prompting in non-interactive contexts (dangerous)",
      false
    )
    .action(
      async (
        cmdOptions: DbSyncCommandOptions & {
          promote?: string;
          demote?: string;
          acceptDataLoss?: boolean;
        },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const context = createContext(globalOpts);

        // Surface the flag as an env var so downstream modules (the
        // schema-change prompt, the auto-sync path) pick it up without
        // needing to thread the option through every function call.
        if (cmdOptions.acceptDataLoss) {
          process.env.NEXTLY_ACCEPT_DATA_LOSS = "1";
        }

        // Promote / demote short-circuit the full db:sync flow because
        // they operate on a single slug and do not need the normal
        // multi-collection sync pipeline.
        if (cmdOptions.promote) {
          try {
            const { runPromote } = await import("./db-sync-promote");
            await runPromote(cmdOptions.promote, context);
            return;
          } catch (error) {
            context.logger.error(
              error instanceof Error ? error.message : String(error)
            );
            process.exit(1);
          }
        }

        if (cmdOptions.demote) {
          try {
            const { runDemote } = await import("./db-sync-demote");
            await runDemote(cmdOptions.demote, context);
            return;
          } catch (error) {
            context.logger.error(
              error instanceof Error ? error.message : String(error)
            );
            process.exit(1);
          }
        }

        const resolvedOptions: ResolvedDevOptions = {
          ...cmdOptions,
          config: globalOpts.config,
          verbose: globalOpts.verbose,
          quiet: globalOpts.quiet,
          cwd: globalOpts.cwd,
        };

        try {
          await runDbSync(resolvedOptions, context);
        } catch (error) {
          context.logger.error(
            error instanceof Error ? error.message : String(error)
          );
          process.exit(1);
        }
      }
    );
}
