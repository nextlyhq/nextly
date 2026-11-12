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
 * # Consent to deleting every table, for a run with no terminal
 * nextly migrate:fresh --accept-data-loss
 *
 * # Run seeders after migrations (placeholder)
 * nextly migrate:fresh --seed
 *
 * # Custom config path
 * nextly migrate:fresh --config ./custom/nextly.config.ts
 * ```
 */

import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";
import { sql, type SQL } from "drizzle-orm";

import { getDialectTables } from "../../database/index";
import type { SeederResult } from "../../database/seeders/index";
import { MIGRATION_LOCK_TABLE as FIELD_GROUP_LOCK_TABLE } from "../../domains/field-groups/migration/session";
// F8 PR 2: was `DrizzlePushService` (legacy). Switched to the freshPushSchema
// helper which has the same dialect-aware behavior but is self-contained
// (no class state, no preview/apply duality).
import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import {
  ACCEPT_DATA_LOSS_ENV,
  judgeDataLoss,
} from "../../domains/schema/migrate/data-loss-consent";
import { declaredNamesOf } from "../../domains/schema/migrate/resolved-schema";
import { freshPushSchema } from "../../domains/schema/pipeline/fresh-push";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { PG_CLASS_IS_THE_RELATION_THE_WRITES_HIT } from "../../domains/schema/pipeline/pg-visible-relation";
import {
  EARLIER_MIGRATE_LOCK_TABLE,
  SCHEMA_LOCK_TABLE,
} from "../../domains/schema/pipeline/schema-lock";
import { describeError, immediateMessage } from "../../errors/index";
import { NextlyError } from "../../errors/nextly-error";
import { reportDryRun } from "../dry-run";
import { exitWithError } from "../errors";
import { CliError } from "../errors/cli-error";
import type { CommandContext } from "../program";
import {
  createCliAdapter,
  openDryRunAdapter,
  getDialectDisplayName,
  type CLIDatabaseAdapter,
  type SupportedDialect,
} from "../utils/adapter";
import {
  requireDatabaseEnv,
  loadConfigOrExit,
} from "../utils/command-prerequisites";
import {
  readDataLossConsent,
  requireConsented,
  type AcceptDataLossOption,
} from "../utils/data-loss-consent";
import { formatDuration, formatCount } from "../utils/logger";
import {
  discoverMigrationGroups,
  getSortedBaseNames,
} from "../utils/migration-discovery";
import { askYesInTerminal } from "../utils/prompt-cancelled";

import { commandRun } from "./command-run";
import { migrateExitCode, runMigrate } from "./migrate";

// ============================================================================
// Types
// ============================================================================

/**
 * Options specific to the migrate:fresh command
 */
export interface MigrateFreshCommandOptions {
  /**
   * The data-loss consent, in the form without targets: the command deletes
   * every table, so a list of them is refused.
   */
  acceptDataLoss?: AcceptDataLossOption;

  /**
   * The earlier spelling of the consent, honoured with a deprecation notice.
   * @default false
   */
  force?: boolean;

  /**
   * Run seeders after migrations.
   * @default false
   */
  seed?: boolean;

  /**
   * `--dry-run`: name every table a real run drops and each migration it runs
   * again, from the database opened read-only, and change nothing. It drops
   * nothing, so it asks for no consent.
   */
  dryRun?: boolean;

  /**
   * Refused whenever it is given: it never consents to deleting data.
   */
  yes?: boolean;
}

/**
 * Combined options (global + command-specific)
 */
interface ResolvedMigrateFreshOptions extends MigrateFreshCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
  /**
   * How long a held schema lock is waited for, in milliseconds, before the
   * run stops naming its holder. Absent, the lock's own wait (about a minute).
   */
  lockWaitMs?: number;
}

/**
 * The tables the schema lock keeps its rows in, which the drop leaves in
 * place. The run holds a row in each of them while it drops and re-applies;
 * dropping one would end that hold part way through, and another run could
 * then start against a half-reset database.
 */
const LOCK_TABLES: ReadonlySet<string> = new Set([
  SCHEMA_LOCK_TABLE,
  EARLIER_MIGRATE_LOCK_TABLE,
  FIELD_GROUP_LOCK_TABLE,
]);

/** What the claim names as its holder, for another run's refusal to report. */
const FRESH_LOCK_COMMAND = "nextly migrate:fresh";

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

  // `--yes` is refused before anything is read or reached, whatever else is
  // given, so a run that meant it as consent changes nothing.
  if (options.yes) exitWithError(logger, yesIsNotConsent());

  // Step 1: Validate database environment
  logger.debug("Validating database environment...");
  const dbValidation = requireDatabaseEnv(logger);

  const dialect = dbValidation.dialect;
  logger.debug(`Database dialect: ${dialect}`);

  // Step 2: Load configuration
  logger.info("Loading configuration...");

  const configResult = await loadConfigOrExit(
    {
      configPath: options.config,
      cwd: options.cwd,
      debug: options.verbose,
    },
    logger
  );

  if (configResult.configPath) {
    logger.success(`Loaded config from ${configResult.configPath}`);
  } else {
    logger.warn("No config file found, using defaults");
  }

  logger.keyValue("Dialect", getDialectDisplayName(dialect));

  if (options.dryRun === true) {
    await previewMigrateFresh(options, dbValidation, configResult, context);
    return;
  }

  // Step 3: Show warning and get confirmation
  logger.newline();
  logger.warn("This command will DROP ALL TABLES in your database.");
  logger.warn("All data will be permanently lost.");

  // The data-loss consent decides, before the database is touched: covered,
  // the run proceeds; where a person can be asked, it asks; otherwise it
  // refuses at once rather than waiting on input nobody will give. A no at
  // the prompt ends the run with exit 1, as a refusal does. What it deletes
  // is every table, which no list of tables can be said to cover.
  try {
    const verdict = await judgeDataLoss({
      deletions: [
        { kind: "unnamed", description: "every table in the database" },
      ],
      consent: readDataLossConsent({
        flag: options.acceptDataLoss,
        honours: ["migrate:fresh --force"],
        earlierFlags: options.force ? ["migrate:fresh --force"] : [],
        warn: message => logger.warn(message),
      }),
      interactive: canPrompt(),
      // A yes deletes; Ctrl+C ends the run with exit 130 (`askYesInTerminal`).
      ask: question => askYesInTerminal(`${question} (yes/no): `),
      print: line => logger.warn(line),
    });
    requireConsented(verdict);
  } catch (error) {
    exitWithError(logger, error);
  }

  // Step 4: Connect to database
  logger.newline();
  logger.info(`Connecting to ${getDialectDisplayName(dialect)}...`);

  let adapter: CLIDatabaseAdapter;
  try {
    adapter = await createCliAdapter({
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
      logger: options.verbose ? logger : undefined,
    });
    logger.success("Database connected");
  } catch (error) {
    exitWithError(logger, error);
  }

  try {
    // Steps 5 to 8 run under the schema lock, taken once the consent above is
    // given so no lock is held while a prompt waits. Held from the first drop
    // to the last re-applied statement, no other run sees the database empty
    // or half rebuilt; the `nextly migrate` run inside it is this run's own
    // and takes the same claim rather than waiting on it.
    const outcome = await withMigrateLock(
      adapter as unknown as DrizzleAdapter,
      dialect,
      () => dropAndReapply(adapter, dialect, options, context),
      {
        command: FRESH_LOCK_COMMAND,
        mode: "wait",
        waitMs: options.lockWaitMs,
        ttlSeconds: configResult.config.db.migrateLockTtlSeconds,
        releaseOnInterrupt: true,
        logger: {
          warn: message => logger.warn(message),
          info: message => logger.info(message),
        },
      }
    );
    // Only a wait given `isSettled` ends without running, and this one is not.
    if (!outcome.ran) {
      throw NextlyError.internal({
        logContext: { reason: "migrate:fresh ended without running" },
      });
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

/**
 * What `migrate:fresh` would do, named and not done: each table it drops, as
 * `discoverTables` finds them for the real run, then each migration file it
 * runs again, in the order `nextly migrate` runs them.
 */
async function previewMigrateFresh(
  options: ResolvedMigrateFreshOptions,
  dbValidation: ReturnType<typeof requireDatabaseEnv>,
  configResult: Awaited<ReturnType<typeof loadConfigOrExit>>,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const opened = await openDryRunAdapter({
    dialect: dbValidation.dialect,
    databaseUrl: dbValidation.databaseUrl,
    logger: options.verbose ? logger : undefined,
  });
  // A database that is not there is one a real run makes and finds empty, so
  // it has no tables to drop and every migration still to run.
  const adapter = "missing" in opened ? undefined : opened;
  try {
    const tables =
      adapter === undefined
        ? []
        : await tablesToDrop(
            adapter as unknown as DrizzleAdapter,
            dbValidation.dialect
          );
    const cwd = options.cwd ?? process.cwd();
    const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);
    // The files listed are the ones the real run's `nextly migrate` runs:
    // read for this dialect and the declared schema, which leaves old Schema
    // Builder files out.
    const migrations = getSortedBaseNames(
      await discoverMigrationGroups(
        migrationsDir,
        dbValidation.dialect,
        await declaredNamesOf(
          { ...configResult, projectRoot: cwd },
          { orNone: true }
        )
      )
    );
    reportDryRun(logger, {
      changes: [
        ...tables.map(table => ({
          action: "remove" as const,
          target: `table ${table}`,
        })),
        {
          action: "run" as const,
          target: "the core tables' setup, as nextly migrate does",
        },
        ...migrations.map(name => ({
          action: "run" as const,
          target: `migration ${name}`,
        })),
        // The order a real run takes them in: on MySQL, a reconciliation pass
        // that fills what a migration set is missing, before the seeders.
        ...(options.seed && dbValidation.dialect === "mysql"
          ? [
              {
                action: "run" as const,
                target:
                  "the MySQL schema reconciliation that adds tables or columns the migrations left out",
              },
            ]
          : []),
        ...(options.seed
          ? [{ action: "run" as const, target: "the seeders" }]
          : []),
      ],
      notes: [
        "A real run also applies the configured plugins' migration modules, which a dry run does not list.",
      ],
    });
  } finally {
    await adapter?.disconnect();
  }
}

/**
 * Drop every table but the lock's own, re-apply every migration, and seed
 * when asked: the part of the command the schema lock is held for.
 */
async function dropAndReapply(
  adapter: CLIDatabaseAdapter,
  dialect: SupportedDialect,
  options: ResolvedMigrateFreshOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
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
  //
  // A failure is thrown rather than ending the process where it happens, so
  // the schema lock is released before the command exits with it.
  await runMigrate(
    {
      config: options.config,
      verbose: options.verbose,
      quiet: options.quiet,
      cwd: options.cwd,
      throwOnFailure: true,
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
}

// ============================================================================
// Table Discovery and Dropping
// ============================================================================

/**
 * The tables `migrate:fresh` drops: every table but the lock's own, whose
 * rows this run holds (`LOCK_TABLES`). A dry run names exactly these.
 */
async function tablesToDrop(
  adapter: StatementRunner,
  dialect: SupportedDialect
): Promise<string[]> {
  return (await discoverTables(adapter, dialect)).filter(
    table => !LOCK_TABLES.has(table)
  );
}

/**
 * Drop all tables from the database
 */
async function dropAllTables(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  context: CommandContext
): Promise<MigrateFreshResult> {
  const { logger } = context;

  const tables = await tablesToDrop(adapter, dialect);

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
 * The only thing these three helpers ask of an adapter.
 *
 * Narrower than `DrizzleAdapter` on purpose: a parameter that demands the whole
 * adapter forces every caller — a test most of all — to produce one, and the
 * usual way to do that is a cast that switches type checking off for the
 * argument. Naming the surface instead lets a double be checked against exactly
 * what the function uses, so a change to that surface breaks the double rather
 * than slipping past a cast.
 */
export type SqlRunner = Pick<DrizzleAdapter, "executeQuery">;

/**
 * What `discoverTables` asks of an adapter: a Drizzle statement, executed.
 *
 * Separate from `SqlRunner` because the two need different things — the FK
 * toggles send a bare `SET`, this one composes a catalog query — and a
 * parameter that demanded both would force every double to provide a surface
 * its subject never touches.
 */
export type StatementRunner = Pick<DrizzleAdapter, "queryStatement">;

/**
 * Discover all user tables in the database.
 *
 * Exported for the same reason `disableForeignKeyChecks` is: what it asks the
 * database decides what this command destroys, and that is worth a test that
 * does not have to drive the whole command to reach it.
 */
export async function discoverTables(
  adapter: StatementRunner,
  dialect: SupportedDialect
): Promise<string[]> {
  let query: SQL;

  switch (dialect) {
    case "postgresql":
      // 🔴 Exactly the relations an UNQUALIFIED name resolves to, because that
      // is what `dropTable` below emits — `DROP TABLE "name"` with no schema on
      // it. Any other predicate asks a different question from the one the drop
      // answers, and on a `search_path` of `tenant, public` the two come apart
      // in both directions: tables the drop WOULD reach go unlisted and survive
      // a reset, while tables it would never reach are listed and handed to it.
      //
      // The predicate is the schema pipeline's, not a second one written here.
      // Two spellings of "which relation does this name resolve to" can be
      // corrected apart, and then this destructive command and the schema reads
      // disagree about which table they mean. It is aliased `t`, which is why
      // `pg_class` is too.
      //
      // System schemas are excluded by name because `pg_catalog` sits on every
      // search path implicitly, so its tables resolve as visible as well.
      query = sql`
        SELECT ${sql.identifier("t")}.${sql.identifier("relname")} AS ${sql.identifier("tablename")}
        FROM ${sql.identifier("pg_class")} ${sql.identifier("t")}
        JOIN ${sql.identifier("pg_namespace")} ${sql.identifier("n")}
          ON ${sql.identifier("n")}.${sql.identifier("oid")} = ${sql.identifier("t")}.${sql.identifier("relnamespace")}
        WHERE ${sql.identifier("t")}.${sql.identifier("relkind")} IN ('r', 'p')
          AND ${sql.identifier("n")}.${sql.identifier("nspname")}
              NOT IN ('pg_catalog', 'information_schema')
          AND ${PG_CLASS_IS_THE_RELATION_THE_WRITES_HIT}
        ORDER BY ${sql.identifier("t")}.${sql.identifier("relname")}`;
      break;

    case "mysql":
      // Scoped to the connected database, which is MySQL's whole namespace —
      // it has no search path, so there is no resolution question to ask.
      query = sql`
        SELECT ${sql.identifier("TABLE_NAME")} AS ${sql.identifier("tablename")}
        FROM ${sql.identifier("information_schema")}.${sql.identifier("TABLES")}
        WHERE ${sql.identifier("TABLE_SCHEMA")} = DATABASE()
          AND ${sql.identifier("TABLE_TYPE")} = 'BASE TABLE'
        ORDER BY ${sql.identifier("TABLE_NAME")}`;
      break;

    case "sqlite":
      // One file, one namespace; `sqlite_%` is the engine's own bookkeeping.
      query = sql`
        SELECT ${sql.identifier("name")} AS ${sql.identifier("tablename")}
        FROM ${sql.identifier("sqlite_master")}
        WHERE ${sql.identifier("type")} = 'table'
          AND ${sql.identifier("name")} NOT LIKE 'sqlite_%'
        ORDER BY ${sql.identifier("name")}`;
      break;

    default:
      throw new Error(`Unsupported dialect: ${String(dialect)}`);
  }

  try {
    const results = await adapter.queryStatement<{ tablename: string }>(query);
    return results.map(row => row.tablename);
  } catch {
    // Database might be empty or inaccessible
    return [];
  }
}

/**
 * True when an error is Postgres's "permission denied to set parameter"
 * rejection for `session_replication_role`. Managed Postgres (Neon, RDS,
 * Supabase) forbids that superuser-only GUC.
 */
function isReplicationRolePermissionError(err: unknown): boolean {
  const msg = describeError(err);
  return /permission denied to set parameter/i.test(msg);
}

/**
 * Best-effort `SET session_replication_role`. On self-hosted Postgres where
 * the role is a superuser this disables triggers during the drop; on managed
 * Postgres it's rejected with "permission denied to set parameter" — which we
 * swallow, because the drop path uses `DROP TABLE ... CASCADE` that resolves
 * FK dependencies without it. Any OTHER error (e.g. a dropped connection) is
 * propagated so real failures still surface.
 */
async function bestEffortReplicationRole(
  adapter: SqlRunner,
  value: "replica" | "origin"
): Promise<void> {
  try {
    await adapter.executeQuery(`SET session_replication_role = '${value}'`);
  } catch (err) {
    if (isReplicationRolePermissionError(err)) return;
    throw err;
  }
}

/**
 * Disable foreign key checks to allow dropping tables with dependencies.
 * Exported for unit testing the managed-Postgres best-effort path.
 */
export async function disableForeignKeyChecks(
  adapter: SqlRunner,
  dialect: SupportedDialect
): Promise<void> {
  switch (dialect) {
    case "postgresql":
      // Best-effort — see bestEffortReplicationRole. Not required for the drop
      // itself (DROP TABLE ... CASCADE handles FK deps); attempting it only
      // helps on self-hosted superuser setups.
      await bestEffortReplicationRole(adapter, "replica");
      return;

    case "mysql":
      await adapter.executeQuery("SET FOREIGN_KEY_CHECKS = 0");
      return;

    case "sqlite":
      await adapter.executeQuery("PRAGMA foreign_keys = OFF");
      return;

    default:
      throw new Error(`Unsupported dialect: ${String(dialect)}`);
  }
}

/**
 * Re-enable foreign key checks after dropping tables.
 * Exported for unit testing the managed-Postgres best-effort path.
 */
export async function enableForeignKeyChecks(
  adapter: SqlRunner,
  dialect: SupportedDialect
): Promise<void> {
  switch (dialect) {
    case "postgresql":
      await bestEffortReplicationRole(adapter, "origin");
      return;

    case "mysql":
      await adapter.executeQuery("SET FOREIGN_KEY_CHECKS = 1");
      return;

    case "sqlite":
      await adapter.executeQuery("PRAGMA foreign_keys = ON");
      return;

    default:
      throw new Error(`Unsupported dialect: ${String(dialect)}`);
  }
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

/**
 * The refusal of `migrate:fresh --yes`: it answers other commands' questions,
 * and deleting every table takes the data-loss consent, never `--yes`.
 */
function yesIsNotConsent(): CliError {
  return new CliError("INPUT_REFUSED", {
    what: `--yes does not consent to deleting data: give --accept-data-loss (or ${ACCEPT_DATA_LOSS_ENV}).`,
    why: "Nothing was changed. migrate:fresh deletes every table, which only the data-loss consent allows.",
    next: `Run \`nextly migrate:fresh --accept-data-loss\` (or set ${ACCEPT_DATA_LOSS_ENV}=1) in place of --yes.`,
    context: { reason: "yes-is-not-consent" },
  });
}

// ============================================================================
// Command Action
// ============================================================================

/**
 * The action of `nextly migrate:fresh`, loaded when it runs.
 */
export async function migrateFreshAction(
  cmdOptions: MigrateFreshCommandOptions,
  cmd: Command
): Promise<void> {
  const { context, options } = commandRun(cmdOptions, cmd);
  const resolvedOptions: ResolvedMigrateFreshOptions = options;

  try {
    await runMigrateFresh(resolvedOptions, context);
  } catch (error) {
    // The status `nextly migrate` ends with, for a failure of the re-apply.
    exitWithError(context.logger, error, migrateExitCode(error));
  }
}

export { registerMigrateFreshCommand } from "./migrate-fresh.command";

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
    // Classify on the immediate message; a wrapped failure whose cause chain
    // mentions a known drift phrase is not itself known drift.
    const message = describeError(error);
    if (isKnownMysqlReconcileDriftError(immediateMessage(error))) {
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

  // Loaded when seeding runs, not imported at the top: the seeders reach the
  // service layer, several hundred modules a reset without seeding never
  // needs.
  const { seedAll } = await import("../../database/seeders/index");
  let result: SeederResult;
  try {
    result = await seedAll(adapter as unknown as DrizzleAdapter, {
      silent: true, // We'll handle logging ourselves
      skipSuperAdmin: true,
    });
  } catch (error) {
    logger.error(`Seeding failed: ${describeError(error)}`);
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
