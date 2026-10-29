/**
 * Migrate Status Command
 *
 * Implements the `nextly migrate:status` command for displaying migration status.
 *
 * **Runtime restriction (F11):** This module is CLI-only. Do NOT
 * import it from runtime code (init/, route-handler/, dispatcher/, api/,
 * actions/, direct-api/, routeHandler.ts, next.ts). Enforced by ESLint
 * (`no-restricted-imports`); see docs/guides/production-migrations.mdx.
 *
 * @module cli/commands/migrate-status
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # Show migration status
 * nextly migrate:status
 *
 * # Output as JSON (for CI/scripting)
 * nextly migrate:status --json
 *
 * # Show verbose output with error details
 * nextly migrate:status --verbose
 * ```
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import {
  pluginOfLedgerRow,
  scopeLedgerRows,
} from "../../domains/schema/events/ledger-scope";
import { newestEventsByFilename } from "../../domains/schema/events/newest-event";
import {
  SchemaEventsRepository,
  type SchemaEventRow,
} from "../../domains/schema/events/schema-events-repository";
import { attemptUnfinished } from "../../domains/schema/migrate/drift-reconcile";
import {
  migrationChecksum,
  compareModuleNames,
  orderedMigrations,
  qualifiedFilename,
} from "../../domains/schema/migrate/plugin/plugin-migration";
import {
  findRegistryDisagreements,
  registryDisagreementLines,
  type RegistryDisagreements,
} from "../../domains/schema/migrate/registry-consistency";
import { resolveDeclaredSchema } from "../../domains/schema/migrate/resolved-schema";
import { marksNoTransaction } from "../../domains/schema/migrate/split-sql";
import { describeError } from "../../errors/index";
import type { PluginDefinition } from "../../plugins/plugin-context";
import type {
  MigrationErrorJson,
  MigrationRecordStatus,
} from "../../schemas/dynamic-collections/types";
import {
  databaseEnvError,
  databaseUnreachable,
  exitWithError,
} from "../errors";
import { createContext, type CommandContext } from "../program";
import {
  createCliAdapter,
  validateDatabaseEnv,
  getDialectDisplayName,
  type CLIDatabaseAdapter,
  type SupportedDialect,
} from "../utils/adapter";
import { loadConfig, type LoadConfigResult } from "../utils/config-loader";
import { formatCount } from "../utils/logger";
import {
  discoverMigrationGroups,
  selectVariant,
  getSortedBaseNames,
} from "../utils/migration-discovery";
import { installRegistryResolver } from "../utils/registry-resolver";

import {
  NO_TRANSACTION_ROLLBACK_NOTE,
  PARTIAL_ROLLBACK_NOTE,
} from "./plugin-module-rollback";

/**
 * Options specific to the migrate:status command
 */
export interface MigrateStatusCommandOptions {
  /**
   * Output as JSON for scripting/CI
   * @default false
   */
  json?: boolean;
  /**
   * List <name>'s migration rows instead of the app's
   */
  plugin?: string;
}

/**
 * Combined options (global + command-specific)
 */
interface ResolvedMigrateStatusOptions extends MigrateStatusCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

/**
 * Parsed migration file data
 */
interface ParsedMigration {
  /** Migration file name (without extension) */
  name: string;
  /** Full file path */
  filePath: string;
  /** SHA-256 checksum of file content */
  checksum: string;
  /**
   * False when the file's first line is `-- nextly:no-transaction`. Absent,
   * it runs in a transaction.
   */
  transaction?: boolean;
  /** Collection slugs (if present in file header) */
  collections: string[];
  /** Timestamp extracted from filename */
  timestamp: string;
}

/**
 * What a migration's status is judged from: its ledger key, the checksum of
 * what would run, and whether it runs outside a transaction. An app file and
 * a plugin module both reduce to this, so one function compares either with
 * the ledger (`buildMigrationStatuses`).
 */
export type MigrationEntry = Pick<
  ParsedMigration,
  "name" | "checksum" | "transaction"
>;

/**
 * Database migration record (F11 schema). Mirrors `nextly_migrations`.
 */
interface MigrationRecord {
  id: string;
  filename: string;
  sha256: string;
  /**
   * `unfinished` for an attempt that recorded no outcome (`attemptUnfinished`):
   * its process stopped, or is still running.
   */
  status: MigrationRecordStatus | "unfinished";
  appliedBy: string | null;
  durationMs: number | null;
  errorJson: MigrationErrorJson | null;
  appliedAt: Date;
}

/**
 * Combined status of a migration (file + database state).
 *
 * F11 adds two new states:
 * - `applied (modified)`: hash mismatch — file edited after apply.
 * - `applied (file missing)`: DB row exists but `.sql` file is gone.
 */
interface MigrationStatus {
  filename: string;
  status:
    | "applied"
    | "applied (modified)"
    | "applied (file missing)"
    | "pending"
    | "failed"
    | "unfinished";
  appliedAt: Date | null;
  durationMs: number | null;
  errorJson: MigrationErrorJson | null;
  checksumMismatch: boolean;
  /**
   * Present when the file is marked to run outside a transaction, so a
   * failure part-way leaves what ran before it applied.
   */
  outsideTransaction?: true;
}

/**
 * Collection with pending schema changes
 */
interface CollectionPendingChange {
  slug: string;
  name: string;
  migrationStatus: string;
  lastMigrationId: string | null;
}

/**
 * Result of the status command for JSON output
 */
interface MigrateStatusResult {
  migrations: MigrationStatus[];
  /** Applied migrations whose latest rollback attempt failed. */
  failedRollbacks: FailedRollback[];
  collections: CollectionPendingChange[];
  /**
   * Where the registry and the tables disagree; null when the database has
   * no registry yet.
   */
  registry: RegistryDisagreements | null;
  /**
   * Why the registry could not be compared with the tables, when it could
   * not; `registry` is then null.
   */
  registryError?: string;
  summary: {
    applied: number;
    pending: number;
    failed: number;
    unfinished: number;
    collectionsWithPendingChanges: number;
  };
}

/**
 * Under `--json`, the one document the command prints when it stops on `error`, as before; the
 * error shape itself goes to standard error.
 */
function printJsonError(
  options: { json?: boolean },
  doing: string,
  error: unknown
): void {
  if (!options.json) return;
  console.log(
    JSON.stringify({ error: `${doing}: ${describeError(error)}` }, null, 2)
  );
}

/**
 * Execute the migrate:status command
 *
 * @param options - Combined global and command options
 * @param context - Command context with logger
 */
export async function runMigrateStatus(
  options: ResolvedMigrateStatusOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  if (!options.json) {
    logger.header("Migrate Status");
  }

  logger.debug("Validating database environment...");
  const dbValidation = validateDatabaseEnv();

  if (!dbValidation.valid) {
    if (options.json) {
      console.log(
        JSON.stringify({ error: dbValidation.errors.join(", ") }, null, 2)
      );
    }
    exitWithError(logger, databaseEnvError(dbValidation));
  }

  const dialect = dbValidation.dialect!;
  logger.debug(`Database dialect: ${dialect}`);

  logger.debug("Loading configuration...");

  let configResult: LoadConfigResult;
  try {
    configResult = await loadConfig({
      configPath: options.config,
      cwd: options.cwd,
      debug: options.verbose,
    });
  } catch (error) {
    printJsonError(options, "Failed to load config", error);
    exitWithError(logger, error);
  }

  if (!options.json) {
    if (configResult.configPath) {
      logger.debug(`Loaded config from ${configResult.configPath}`);
    } else {
      logger.debug("No config file found, using defaults");
    }
    logger.keyValue("Dialect", getDialectDisplayName(dialect));
  }

  logger.debug(`Connecting to ${getDialectDisplayName(dialect)}...`);

  let adapter: CLIDatabaseAdapter;
  try {
    adapter = await createCliAdapter({
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
      logger: options.verbose ? logger : undefined,
    });
    logger.debug("Database connected");
  } catch (error) {
    printJsonError(options, "Failed to connect to database", error);
    exitWithError(logger, databaseUnreachable(dialect, error));
  }

  try {
    const cwd = options.cwd ?? process.cwd();
    const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);

    logger.debug(`Scanning migrations in ${migrationsDir}...`);

    const migrationFiles = await migrationEntries({
      plugin: options.plugin,
      plugins: configResult.config.plugins ?? [],
      migrationsDir,
      dialect,
    });
    logger.debug(`Found ${migrationFiles.length} migration file(s)`);

    const ledger = await readStatusLedger(
      adapter as unknown as DrizzleAdapter,
      dialect,
      options.plugin
    );
    const appliedMigrations = ledger.applied;
    logger.debug(`${appliedMigrations.length} migration(s) in database`);

    const migrationStatuses = buildMigrationStatuses(
      migrationFiles,
      appliedMigrations
    );

    const failedRollbacks = failedRollbacksSinceApply(
      appliedMigrations,
      ledger.rollbacks
    );

    const pendingCollections = await getCollectionsWithPendingChanges(
      adapter as unknown as DrizzleAdapter,
      dialect
    );

    const { registry, registryError } = await compareRegistry(
      adapter as unknown as DrizzleAdapter,
      dialect,
      cwd,
      configResult,
      logger
    );

    // F11: include the new status variants in the applied bucket so the
    // summary count reflects "actually-applied rows" regardless of whether
    // the file was modified or missing post-apply.
    const summary = {
      applied: migrationStatuses.filter(
        m =>
          m.status === "applied" ||
          m.status === "applied (modified)" ||
          m.status === "applied (file missing)"
      ).length,
      pending: migrationStatuses.filter(m => m.status === "pending").length,
      failed: migrationStatuses.filter(m => m.status === "failed").length,
      unfinished: migrationStatuses.filter(m => m.status === "unfinished")
        .length,
      collectionsWithPendingChanges: pendingCollections.length,
    };

    if (options.json) {
      const result: MigrateStatusResult = {
        migrations: migrationStatuses,
        failedRollbacks,
        collections: pendingCollections,
        registry,
        ...(registryError !== undefined ? { registryError } : {}),
        summary,
      };
      console.log(JSON.stringify(result, null, 2));
    } else {
      displayStatus(migrationStatuses, pendingCollections, summary, context);
      displayFailedRollbacks(failedRollbacks, context);
      displayRegistryDisagreements(registry, registryError, context);
    }
  } finally {
    await adapter.disconnect();
  }
}

/**
 * The migrations a status run lists: the app's files under its migrations
 * directory, or with `plugin` the modules that plugin ships.
 *
 * A plugin's migrations are modules in its definition, not files under the
 * app's directory, so they are read from there; a module no run has applied
 * yet then reads as pending, as an app file without a ledger row does.
 */
export async function migrationEntries(args: {
  plugin?: string;
  plugins: readonly PluginDefinition[];
  migrationsDir: string;
  dialect: SupportedDialect;
}): Promise<MigrationEntry[]> {
  return args.plugin
    ? pluginModuleEntries(args.plugins, args.plugin)
    : discoverMigrations(args.migrationsDir, args.dialect);
}

async function discoverMigrations(
  migrationsDir: string,
  dialect?: SupportedDialect
): Promise<ParsedMigration[]> {
  // Use shared migration discovery to group dialect variants
  const groups = await discoverMigrationGroups(migrationsDir);
  const migrations: ParsedMigration[] = [];

  // Process each migration group in sorted order
  for (const baseName of getSortedBaseNames(groups)) {
    const group = groups.get(baseName)!;
    const selectedFile = selectVariant(group.variants, dialect);

    if (!selectedFile) {
      continue;
    }

    const filePath = resolve(migrationsDir, selectedFile);

    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = parseMigrationFile(baseName, filePath, content);
      migrations.push(parsed);
    } catch {
      // Skip files that can't be read
    }
  }

  return migrations;
}

function parseMigrationFile(
  name: string,
  filePath: string,
  content: string
): ParsedMigration {
  const checksum = createHash("sha256").update(content).digest("hex");

  const collectionsMatch = content.match(/^-- Collections?:\s*(.+)$/m);
  const collections = collectionsMatch
    ? collectionsMatch[1].split(",").map(c => c.trim())
    : [];

  const timestampMatch = name.match(/^(\d{8}_\d{6})/);
  const timestamp = timestampMatch?.[1] ?? name;

  return {
    name,
    filePath,
    checksum,
    transaction: !marksNoTransaction(content),
    collections,
    timestamp,
  };
}

/**
 * What a status run reads from the ledger (`nextly_schema_events`): each
 * migration's recorded state (`ledgerRecords`), and the rollbacks that failed.
 *
 * A ledger that is not there yet belongs to an install no migrate has run on,
 * so nothing is recorded. A ledger that is there and cannot be read is a
 * fault, and is raised: turning it into an empty ledger listed every applied
 * migration as pending, which is the report most likely to be acted on.
 */
export async function readStatusLedger(
  adapter: Pick<DrizzleAdapter, "getDrizzle" | "tableExists">,
  dialect: SupportedDialect,
  plugin?: string
): Promise<{ applied: MigrationRecord[]; rollbacks: SchemaEventRow[] }> {
  if (!(await adapter.tableExists("nextly_schema_events"))) {
    return { applied: [], rollbacks: [] };
  }
  const repo = new SchemaEventsRepository(adapter.getDrizzle(), dialect);
  return {
    applied: ledgerRecords(await repo.listFileApplies(), plugin),
    rollbacks: await repo.listFailedRollbacks(),
  };
}

/** An applied migration whose latest rollback attempt failed. */
export interface FailedRollback {
  filename: string;
  failedAt: Date;
  note: string | null;
  /**
   * The DOWN may have committed part of its statements: on MySQL, or where
   * it ran outside a transaction (`outsideTransaction`).
   */
  possiblyPartial: boolean;
  /** The DOWN ran outside a transaction, as its migration is marked to. */
  outsideTransaction: boolean;
}

/**
 * The applied migrations whose most recent rollback failed after they were
 * applied. The failure does not change the migration's applied state — on
 * PostgreSQL and SQLite the DOWN was rolled back whole — but on MySQL part
 * of it may have committed, and the operator needs to know either way that
 * the schema was touched since.
 */
export function failedRollbacksSinceApply(
  applied: readonly MigrationRecord[],
  rollbacks: SchemaEventRow[]
): FailedRollback[] {
  const newestFailure = newestEventsByFilename(rollbacks);
  const failures: FailedRollback[] = [];
  for (const record of applied) {
    if (record.status !== "applied") continue;
    const failure = newestFailure.get(record.filename);
    if (failure === undefined || failure.startedAt <= record.appliedAt) {
      continue;
    }
    failures.push({
      filename: record.filename,
      failedAt: failure.startedAt,
      note: failure.note,
      possiblyPartial:
        failure.note?.startsWith(PARTIAL_ROLLBACK_NOTE) === true ||
        failure.note?.startsWith(NO_TRANSACTION_ROLLBACK_NOTE) === true,
      outsideTransaction:
        failure.note?.startsWith(NO_TRANSACTION_ROLLBACK_NOTE) === true,
    });
  }
  return failures;
}

/** Warns about each applied migration whose rollback failed. */
function displayFailedRollbacks(
  failures: readonly FailedRollback[],
  context: CommandContext
): void {
  for (const failure of failures) {
    const failed = `${failure.filename}: a rollback failed at ${formatDate(failure.failedAt)}`;
    const compare =
      "It is still recorded as applied; compare the schema with the migration before running migrate or migrate:down again.";
    context.logger.warn(
      failure.outsideTransaction
        ? `${failed}. Its DOWN ran outside a transaction, so the statements before the failing one stayed applied. ${compare}`
        : failure.possiblyPartial
          ? `${failed}, and MySQL may have committed part of its DOWN. ${compare}`
          : `${failed} and was undone; it is still applied.`
    );
  }
}

/**
 * Each migration's current state in the ledger: the NEWEST `file_apply`
 * event per filename, kept when it is `applied`, or an attempt that did not
 * finish (`attemptUnfinished`: `failed`, or still `in_progress`).
 *
 * Newest per filename by `newestEventsByFilename`, the rule `migrate`,
 * `migrate:down` and `plugins uninstall` read the ledger by. A rollback is
 * recorded as a `rolled_back` event after the `applied` one, and the older
 * `applied` row stays in the ledger, so only the newest event says whether a
 * migration is applied now.
 *
 * Plugin rows belong to their own migration stream: excluded unless
 * `plugin` names one, so the app's listing never reports them as
 * "applied (file missing)".
 */
export function ledgerRecords(
  rows: SchemaEventRow[],
  plugin?: string
): MigrationRecord[] {
  const records: MigrationRecord[] = [];
  for (const r of newestEventsByFilename(
    scopeLedgerRows(rows, plugin)
  ).values()) {
    // An attempt that never finished is listed as one, not as pending:
    // `nextly migrate` may refuse it until it is finished or cleared.
    if (r.status !== "applied" && !attemptUnfinished(r)) continue;
    records.push({
      id: r.id,
      filename: r.filename ?? "",
      sha256: r.sha256 ?? "",
      status:
        r.status === "applied"
          ? "applied"
          : r.status === "failed"
            ? "failed"
            : "unfinished",
      appliedBy: null,
      durationMs: r.durationMs ?? null,
      errorJson: null,
      appliedAt: r.startedAt,
    });
  }
  return records;
}

// F11: small coercion helpers for adapter-returned `Record<string, unknown>`.
// Avoids the `String(unknown)` no-base-to-string lint trip when the column
// might (in theory) come back as an object.
function coerceString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

function coerceStringOrNull(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return null;
}

async function getCollectionsWithPendingChanges(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<CollectionPendingChange[]> {
  let query: string;

  switch (dialect) {
    case "postgresql":
      query = `
        SELECT "slug", "name", "migration_status", "last_migration_id"
        FROM "dynamic_collections"
        WHERE "migration_status" != 'applied'
        ORDER BY "name" ASC
      `;
      break;
    case "mysql":
      query = `
        SELECT \`slug\`, \`name\`, \`migration_status\`, \`last_migration_id\`
        FROM \`dynamic_collections\`
        WHERE \`migration_status\` != 'applied'
        ORDER BY \`name\` ASC
      `;
      break;
    case "sqlite":
      query = `
        SELECT "slug", "name", "migration_status", "last_migration_id"
        FROM "dynamic_collections"
        WHERE "migration_status" != 'applied'
        ORDER BY "name" ASC
      `;
      break;
    default:
      return [];
  }

  try {
    const results = await adapter.executeQuery<Record<string, unknown>>(query);

    return results.map(row => ({
      slug: coerceString(row.slug),
      name: coerceString(row.name),
      migrationStatus: coerceString(row.migration_status),
      lastMigrationId: coerceStringOrNull(row.last_migration_id),
    }));
  } catch {
    return [];
  }
}

// F11: derive the per-row status from file-vs-record state. Three new
// outcomes vs the pre-F11 model:
// - `applied (modified)`: hash mismatch. File edited after apply.
// - `applied (file missing)`: DB has the row but the .sql is gone.
//   `nextly migrate` will treat the latter as MIGRATION_MISSING (exit 3),
//   but `migrate:status` keeps surfacing it as a row so operators can
//   investigate and either restore the file or contact whoever deleted it.

/**
 * The modules plugin `plugin` ships (`--plugin <name>`), in the order they
 * run, as the entries their status is judged from.
 *
 * Each is keyed by its ledger filename (`qualifiedFilename`) and carries the
 * checksum of its content as it is now, the value the runner compares an
 * applied module with, so a module changed since it ran reads as modified.
 * A plugin the config does not list ships nothing, and each of its recorded
 * rows reads as applied with its module missing.
 */
export function pluginModuleEntries(
  plugins: readonly PluginDefinition[],
  plugin: string
): MigrationEntry[] {
  const definition = plugins.find(p => p.name === plugin);
  return orderedMigrations(
    definition?.contributes?.schema?.migrations ?? []
  ).map(module => ({
    name: qualifiedFilename(plugin, module.name),
    checksum: migrationChecksum(module),
    transaction: module.transaction !== false,
  }));
}

export function buildMigrationStatuses(
  files: readonly MigrationEntry[],
  applied: MigrationRecord[]
): MigrationStatus[] {
  const stripSql = (f: string): string => f.replace(/\.sql$/i, "");
  const appliedMap = new Map(applied.map(m => [stripSql(m.filename), m]));
  const statuses: MigrationStatus[] = [];

  for (const file of files) {
    const record = appliedMap.get(stripSql(file.name));
    const marked =
      file.transaction === false ? { outsideTransaction: true as const } : {};

    if (record) {
      const checksumMismatch = record.sha256 !== file.checksum;
      let status: MigrationStatus["status"];
      if (record.status !== "applied") {
        status = record.status;
      } else if (checksumMismatch) {
        status = "applied (modified)";
      } else {
        status = "applied";
      }

      statuses.push({
        filename: file.name,
        status,
        appliedAt: record.appliedAt,
        durationMs: record.durationMs,
        errorJson: record.errorJson,
        checksumMismatch,
        ...marked,
      });

      appliedMap.delete(stripSql(file.name));
    } else {
      statuses.push({
        filename: file.name,
        status: "pending",
        appliedAt: null,
        durationMs: null,
        errorJson: null,
        checksumMismatch: false,
        ...marked,
      });
    }
  }

  for (const [filename, record] of appliedMap) {
    statuses.push({
      filename,
      status:
        record.status === "applied" ? "applied (file missing)" : record.status,
      appliedAt: record.appliedAt,
      durationMs: record.durationMs,
      errorJson: record.errorJson,
      checksumMismatch: false,
    });
  }

  return statuses.sort((a, b) =>
    compareStatusFilenames(a.filename, b.filename)
  );
}

/**
 * The order statuses are listed in: the app's files first, by name, then each
 * plugin's modules, grouped by plugin, in the order the runner applies them
 * (`compareModuleNames`). One comparison of whole filenames listed a plugin's
 * modules in an order of its own, so `10_more` read as after `1_init` here
 * while it runs before it.
 */
function compareStatusFilenames(a: string, b: string): number {
  const pluginA = pluginOfLedgerRow(a);
  const pluginB = pluginOfLedgerRow(b);
  if (pluginA === null || pluginB === null) {
    if (pluginA !== pluginB) return pluginA === null ? -1 : 1;
    return a.localeCompare(b);
  }
  if (pluginA !== pluginB) return pluginA.localeCompare(pluginB);
  const prefix = qualifiedFilename(pluginA, "").length;
  return compareModuleNames(a.slice(prefix), b.slice(prefix));
}

function displayStatus(
  migrations: MigrationStatus[],
  collections: CollectionPendingChange[],
  summary: MigrateStatusResult["summary"],
  context: CommandContext
): void {
  const { logger } = context;

  if (migrations.length === 0) {
    logger.newline();
    logger.info("No migrations found.");
    logger.info(
      'Run `nextly migrate:create --name="<migration-name>"` to create a migration.'
    );
  } else {
    logger.newline();

    // F11: dropped Batch column (forward-only model has no batches);
    // added Duration so operators can spot slow migrations at a glance.
    const headers = ["Migration", "Status", "Applied At", "Duration"];
    const rows: (string | number | boolean)[][] = migrations.map(m => {
      const statusDisplay = `${formatStatusForDisplay(m.status)}${
        m.outsideTransaction ? " (no transaction)" : ""
      }`;
      return [
        m.filename,
        statusDisplay,
        m.appliedAt ? formatDate(m.appliedAt) : "-",
        m.durationMs !== null ? `${m.durationMs}ms` : "-",
      ];
    });

    logger.table(headers, rows);
    for (const hint of statusHints(migrations)) logger.info(hint);
    if (context.options.verbose) logVerboseDetails(migrations, logger);

    logger.newline();
    const line = summaryLine(summary);
    if (line !== undefined) logger.info(line);
  }

  if (collections.length > 0) logPendingCollections(collections, logger);
}

/** The notes under the table that explain a status some row shows. */
function statusHints(migrations: readonly MigrationStatus[]): string[] {
  const hints: string[] = [];
  if (migrations.some(m => m.status === "unfinished")) {
    hints.push(
      "(unfinished): its last attempt recorded no outcome: the process running it stopped, or is still running. `nextly migrate` refuses one that runs outside a transaction, or any on MySQL, until it is finished by hand and recorded, or reversed and cleared with `nextly migrate:resolve --failed-cleanup <file>`."
    );
  }
  if (migrations.some(m => m.outsideTransaction && m.status === "pending")) {
    hints.push(
      "(no transaction): marked -- nextly:no-transaction (a plugin module: transaction: false), so it runs outside a transaction; if a statement fails, the statements before it stay applied."
    );
  }
  return hints;
}

/** `--verbose`: each failure's recorded error, and each edited migration. */
function logVerboseDetails(
  migrations: readonly MigrationStatus[],
  logger: CommandContext["logger"]
): void {
  const failedMigrations = migrations.filter(
    m => m.status === "failed" && m.errorJson
  );
  if (failedMigrations.length > 0) {
    logger.newline();
    logger.error("Error Details:");
    for (const m of failedMigrations) {
      // F11: render the structured error_json so operators see SQLSTATE
      // and the failing statement, not just an opaque message.
      const e = m.errorJson;
      logger.error(`  ${m.filename}: ${e?.message ?? "unknown error"}`);
      if (e?.sqlState) logger.error(`    sqlState: ${e.sqlState}`);
      if (e?.statement) logger.error(`    statement: ${e.statement}`);
    }
  }

  const modifiedMigrations = migrations.filter(m => m.checksumMismatch);
  if (modifiedMigrations.length > 0) {
    logger.newline();
    logger.warn("Modified Migrations (checksum mismatch):");
    for (const m of modifiedMigrations) {
      logger.warn(`  ${m.filename}`);
    }
  }
}

/** The summary line, naming each non-zero count, or undefined for none. */
export function summaryLine(
  summary: MigrateStatusResult["summary"]
): string | undefined {
  const parts = (
    [
      [summary.applied, "applied"],
      [summary.pending, "pending"],
      [summary.failed, "failed"],
      [summary.unfinished, "unfinished"],
    ] as const
  )
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`);
  return parts.length > 0 ? `Summary: ${parts.join(", ")}` : undefined;
}

/** The collections whose schema changed with no migration for it yet. */
function logPendingCollections(
  collections: readonly CollectionPendingChange[],
  logger: CommandContext["logger"]
): void {
  logger.newline();
  logger.divider();
  logger.newline();
  logger.info("Collections with Pending Changes");
  logger.newline();

  const collHeaders = ["Collection", "Slug", "Status"];
  const collRows: (string | number | boolean)[][] = collections.map(c => [
    c.name,
    c.slug,
    c.migrationStatus,
  ]);

  logger.table(collHeaders, collRows);

  logger.newline();
  logger.info(
    `${formatCount(collections.length, "collection")} with pending schema changes.`
  );
  logger.info(
    'Run `nextly migrate:create --name="<migration-name>"` to generate migrations.'
  );
}

// F11: render the status union as a human-friendly string. Title-cased
// for table display; matches the colour intent (green = applied, yellow
// = applied (modified), red = applied (file missing) / failed). The
// underlying logger doesn't take colours here; we just title-case the text.
function formatStatusForDisplay(status: MigrationStatus["status"]): string {
  switch (status) {
    case "applied":
      return "Applied";
    case "applied (modified)":
      return "Applied (modified)";
    case "applied (file missing)":
      return "Applied (file missing)";
    case "pending":
      return "Pending";
    case "failed":
      return "Failed";
    case "unfinished":
      return "Unfinished";
  }
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * The registry rows against the tables they name, and the declared entities
 * against the rows: the comparison `nextly migrate` makes when it finishes.
 *
 * A comparison that cannot run is reported, not raised, so the migration
 * listing above it still prints: it is the part of this command a deploy
 * script reads first. The registry services read their tables by name, so the
 * resolver a CLI run has no boot to install is installed here.
 */
async function compareRegistry(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  cwd: string,
  configResult: LoadConfigResult,
  logger: CommandContext["logger"]
): Promise<{
  registry: RegistryDisagreements | null;
  registryError?: string;
}> {
  try {
    installRegistryResolver(adapter);
    const { entities } = await resolveDeclaredSchema({
      projectRoot: cwd,
      config: configResult.config,
      deferredExtends: configResult.deferredExtends,
    });
    return {
      registry: await findRegistryDisagreements({
        adapter,
        dialect,
        declared: entities,
        logger,
      }),
    };
  } catch (error) {
    return { registry: null, registryError: describeError(error) };
  }
}

/** Warns about each place the registry and the tables disagree. */
function displayRegistryDisagreements(
  registry: RegistryDisagreements | null,
  registryError: string | undefined,
  context: CommandContext
): void {
  if (registryError !== undefined) {
    context.logger.warn(
      `Could not compare the registry with the tables: ${registryError}`
    );
    return;
  }
  const lines = registryDisagreementLines(registry);
  if (lines.length === 0) return;
  const { logger } = context;
  logger.newline();
  logger.divider();
  logger.newline();
  logger.info("Registry and Tables");
  logger.newline();
  for (const line of lines) logger.warn(line);
}

/**
 * Register the migrate:status command with the program
 *
 * @param program - Commander program instance
 */
export function registerMigrateStatusCommand(program: Command): void {
  program
    .command("migrate:status")
    .description("Show current migration status")
    .option("--json", "Output as JSON for scripting/CI", false)
    .option("--plugin <name>", "List <name>'s migrations instead of the app's")
    .action(async (cmdOptions: MigrateStatusCommandOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);

      const resolvedOptions: ResolvedMigrateStatusOptions = {
        ...cmdOptions,
        config: globalOpts.config,
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
        cwd: globalOpts.cwd,
      };

      try {
        await runMigrateStatus(resolvedOptions, context);
      } catch (error) {
        if (resolvedOptions.json) {
          console.log(JSON.stringify({ error: describeError(error) }, null, 2));
        }
        exitWithError(context.logger, error);
      }
    });
}
