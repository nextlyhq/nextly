/**
 * db:sync Command
 *
 * Implements the `nextly db:sync` command (aliased as `nextly sync`).
 * Loads configuration, syncs collections, and generates schema/type files.
 *
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
 * # Auto-confirm destructive column drops (non-interactive runs)
 * nextly db:sync --accept-data-loss
 *
 * # Custom config path
 * nextly db:sync --config ./custom/nextly.config.ts
 * ```
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { getDialectTables } from "../../database/index";
import { SchemaRegistry } from "../../database/schema-registry";
import { withMigrationExcluded } from "../../domains/field-groups/migration/sync-guard";
import { registerComponentSchemas } from "../../domains/field-groups/services/register-field-group-schemas";
import { getFieldGroupRegistryAliases } from "../../domains/field-groups/storage/registry-schemas";
import { runWithFieldTypes } from "../../domains/schema/field-types/field-type-scope";
import { describeError } from "../../errors/index";
import { assertPluginFieldDeclarations } from "../../shared/lib/assert-plugin-field-declarations";
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
import { hasSchemaToSync } from "../utils/has-schema";
import { formatDuration } from "../utils/logger";

import {
  ensureLocalizedCompanions,
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
   * Generate Zod validation schema files to src/db/schemas/zod/.
   * Drizzle `.ts` schema generation was removed (orphan output, unused by the
   * runtime), so this flag no longer writes Drizzle schemas.
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
    logger.error(`Failed to load config: ${describeError(error)}`);
    process.exit(1);
  }

  if (configResult.configPath) {
    logger.success(`Loaded config from ${configResult.configPath}`);
  } else {
    logger.warn("No config file found, using defaults");
  }

  const collectionCount = configResult.config.collections.length;
  const singleCount = configResult.config.singles.length;
  const componentCount = configResult.config.fieldGroups.length;
  const userFieldCount = configResult.config.users?.fields?.length ?? 0;
  logger.keyValue("Collections", collectionCount);
  logger.keyValue("Singles", singleCount);
  logger.keyValue("Field groups", componentCount);
  logger.keyValue("User Fields (code)", userFieldCount);

  // Step 3: Connect to database (needed for seeding even without collections)
  logger.newline();
  logger.info(
    `Connecting to ${getDialectDisplayName(dbValidation.dialect!)}...`
  );

  let adapter: CLIDatabaseAdapter;
  // Held beyond the connect block so component schemas can be added once the core tables
  // are known to exist — `dynamic_components` has to be readable before it can be listed.
  let schemaRegistry: SchemaRegistry;
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
    schemaRegistry = new SchemaRegistry(dialect);
    // Both spellings of the field-group registry: the schema registry keys a
    // table by the physical name its Drizzle object carries, so a database
    // whose storage migration has run has no handle for its registry otherwise.
    schemaRegistry.registerStaticSchemas({
      ...getDialectTables(dialect),
      ...getFieldGroupRegistryAliases(dialect),
    });
    (adapter as unknown as DrizzleAdapter).setTableResolver(schemaRegistry);
    logger.debug("Schema registry initialized with static tables");
  } catch (error) {
    logger.error(`Failed to connect to database: ${describeError(error)}`);
    process.exit(1);
  }

  try {
    // Step 3.5: Ensure core tables exist.
    // For fresh databases, the system tables (users, roles, permissions,
    // dynamic_collections, etc.) must exist before any sync or query.
    // Uses drizzle-kit pushSchema() to create ALL tables from the Drizzle
    // schema definitions, guaranteeing they match 100%.
    await ensureCoreTables(adapter, options, context);

    // Step 3.55: Refuse while a field group storage migration is in flight.
    //
    // Mid-run the database is in a shape neither the old config nor the new one
    // describes: some tables carry pre-rename names, some post-rename, and the
    // registry pointers move one step at a time. Everything below reconciles the
    // config against that, and `--remove-orphaned` deletes what it cannot
    // account for. Placed after the core tables so the marker's own table is
    // guaranteed to exist, and before anything that reads or changes schema.
    // Held across the sync rather than sampled before it. A migration starting
    // just after a point-in-time check renames tables underneath work that has
    // already decided what exists, and `--remove-orphaned` deletes what it
    // cannot account for. Watch mode is deliberately outside: it never returns,
    // and each debounced re-sync takes the exclusion for itself.

    // Step 4-5.5: Sync collections, singles and components.
    //
    // These run even when the config declares none of that entity type: removing the LAST
    // collection/single/component is what strands its table, so a zero count is exactly when
    // the orphan scan has something to report.
    // The config validators do not run on this path — `loadConfig` registers
    // plugin field types but nothing afterwards checks the declarations that
    // use them, and the syncs below serialize those fields and materialize
    // their columns. Only the field types' own rules run, so this cannot newly
    // refuse a schema that syncs fine today.
    // Pinned to the types this config registered, like every re-sync. In watch
    // mode `loadConfig` starts the file watcher before returning, so a save
    // during connection, core-table setup, or this first sync would rebuild the
    // live registry while these calls are still materializing the config they
    // started from. Component registration is inside the scope because it
    // builds the `comp_` runtime tables from the same storage mappings: left
    // outside, it would shape them from a newer config than the sync that then
    // addresses them.
    await withMigrationExcluded(
      {
        adapter: adapter as unknown as DrizzleAdapter,
        logger,
        label: "db:sync",
        mayCreateLock: options.autoSync !== false,
        // A sync is idempotent and was never mutually exclusive with another sync, so dropping the
        // claim on an interrupt costs nothing a rerun does not fix.
        releaseOnInterrupt: true,
      },
      async () =>
        await runWithFieldTypes(configResult.fieldTypes, async () => {
          // Step 3.6: Register the runtime schema of every component in the database. The registry
          // built above holds STATIC system tables only, so `comp_` tables are unaddressable by
          // the ORM until this runs — and the orphan cleanup below has to delete rows from them.
          // Reads from `dynamic_components` rather than the config so components already removed
          // from code are still reachable.
          await registerComponentSchemas({
            adapter: adapter as unknown as DrizzleAdapter,
            registry: schemaRegistry,
            dialect: (adapter as unknown as DrizzleAdapter).getCapabilities()
              .dialect,
            logger,
          });

          assertPluginFieldDeclarations(configResult.config);

          // Before the pushes, so an entity gaining localization has its existing content copied
          // into the companion while the main table still carries it. The drop the push then
          // applies is a cleanup rather than a loss.
          //
          // Inside the pinned scope for the same reason the pass after the syncs is: a companion
          // holds the localized subset of the same fields and has to resolve plugin types against
          // the config being materialized.
          if (options.autoSync !== false) {
            await ensureLocalizedCompanions(
              configResult.config,
              adapter,
              context,
              "beforeApply"
            );
          }

          await syncCollections(configResult, adapter, options, context);
          await syncSingles(configResult, adapter, options, context);
          await syncComponents(configResult, adapter, options, context);

          // Step 5.6: Create the `_locales` companion of every localized entity, which
          // the push pipeline does not manage. Runs after all three syncs because the
          // companion references its main table. Without this, `db:sync` left the
          // registry saying "localized" with no table to hold translations until the
          // app next booted, and writes in that window overwrote the default language.
          //
          // Gated on the same flag as the rest of the schema push: this issues DDL and
          // can copy rows, so `--no-auto-sync` — chosen precisely to keep physical
          // schema changes in migration files — must suppress it too.
          //
          // Inside the pinned scope with the syncs it follows: a companion holds the
          // localized subset of the same fields, so it has to resolve plugin types
          // against the config the main tables were just materialized from.
          if (options.autoSync !== false) {
            await ensureLocalizedCompanions(
              configResult.config,
              adapter,
              context
            );
          }

          if (collectionCount === 0) {
            logger.warn("No collections defined in config");
            logger.info(
              "Add collections to your nextly.config.ts to get started."
            );
          }

          // Step 5.6: Sync user_ext table (always — handles both code and UI fields)
          await syncUserFields(configResult, adapter, options, context);

          // Step 5.7: Seed permissions for collections and singles (always, idempotent).
          // demo content seeding moved to a Payload-style admin-triggered POST
          // route in the project itself (src/app/admin/api/seed/route.ts).
          await performPermissionSeeding(adapter, options, context);
        })
    );

    // Step 7: Watch mode. Gated on any entity kind this command syncs, not just
    // collections and singles: `loadConfig({ watch: true })` has already opened
    // the file watcher, so a user-fields-only project stayed alive with no
    // callback registered and never re-synced `user_ext` on a later edit.
    if (options.watch && hasSchemaToSync(configResult.config)) {
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
      "Generate Zod validation schema files to src/db/schemas/zod/",
      false
    )
    .option(
      "--no-auto-sync",
      "Disable auto-sync of schema changes (use migrations instead)"
    )
    // Deprecated no-op: the schema pipeline handles destructive ops via
    // interactive prompts (or --accept-data-loss / NEXTLY_ACCEPT_DATA_LOSS=1
    // in non-interactive runs). Kept registered so existing scripts passing
    // it keep working; the runtime emits a deprecation warning instead.
    .option(
      "-f, --force",
      "(deprecated, no effect) Destructive ops are prompted; use --accept-data-loss for non-interactive runs",
      false
    )
    .option(
      "--remove-orphaned",
      "Remove code-first collections/singles/components that no longer exist in config",
      false
    )
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
    // Sets NEXTLY_ACCEPT_DATA_LOSS=1 for the rest of the run so the prompt
    // dispatcher auto-confirms destructive column drops instead of refusing
    // in non-TTY runs. Only drops: renames and type changes still need a
    // terminal to answer their prompts.
    .option(
      "--accept-data-loss",
      "Auto-confirm destructive column drops without prompting (dangerous; other destructive changes still prompt)",
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
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();
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
            context.logger.error(describeError(error));
            process.exit(1);
          }
        }

        if (cmdOptions.demote) {
          try {
            const { runDemote } = await import("./db-sync-demote");
            await runDemote(cmdOptions.demote, context);
            return;
          } catch (error) {
            context.logger.error(describeError(error));
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
          context.logger.error(describeError(error));
          process.exit(1);
        }
      }
    );
}
