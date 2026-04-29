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
import { readdir, readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { Command } from "commander";

import type { SupportedDialect } from "../../domains/schema/services/schema-generator.js";
import type {
  MigrationErrorJson,
  MigrationRecordStatus,
} from "../../schemas/dynamic-collections/types.js";
import { createContext, type CommandContext } from "../program.js";
import {
  createAdapter,
  validateDatabaseEnv,
  getDialectDisplayName,
  type CLIDatabaseAdapter,
} from "../utils/adapter.js";
import { loadConfig, type LoadConfigResult } from "../utils/config-loader.js";
import { formatCount } from "../utils/logger.js";

/**
 * Options specific to the migrate:status command
 */
export interface MigrateStatusCommandOptions {
  /**
   * Output as JSON for scripting/CI
   * @default false
   */
  json?: boolean;
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
  /** Collection slugs (if present in file header) */
  collections: string[];
  /** Timestamp extracted from filename */
  timestamp: string;
}

/**
 * Database migration record (F11 schema). Mirrors `nextly_migrations`.
 */
interface MigrationRecord {
  id: string;
  filename: string;
  sha256: string;
  status: MigrationRecordStatus;
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
    | "failed";
  appliedAt: Date | null;
  durationMs: number | null;
  errorJson: MigrationErrorJson | null;
  checksumMismatch: boolean;
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
  collections: CollectionPendingChange[];
  summary: {
    applied: number;
    pending: number;
    failed: number;
    collectionsWithPendingChanges: number;
  };
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
      process.exit(1);
    }
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

  logger.debug("Loading configuration...");

  let configResult: LoadConfigResult;
  try {
    configResult = await loadConfig({
      configPath: options.config,
      cwd: options.cwd,
      debug: options.verbose,
    });
  } catch (error) {
    const errorMsg = `Failed to load config: ${error instanceof Error ? error.message : String(error)}`;
    if (options.json) {
      console.log(JSON.stringify({ error: errorMsg }, null, 2));
      process.exit(1);
    }
    logger.error(errorMsg);
    process.exit(1);
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
    adapter = await createAdapter({
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
      logger: options.verbose ? logger : undefined,
    });
    logger.debug("Database connected");
  } catch (error) {
    const errorMsg = `Failed to connect to database: ${error instanceof Error ? error.message : String(error)}`;
    if (options.json) {
      console.log(JSON.stringify({ error: errorMsg }, null, 2));
      process.exit(1);
    }
    logger.error(errorMsg);
    process.exit(1);
  }

  try {
    logger.debug("Checking migrations table...");
    await ensureMigrationsTable(adapter as unknown as DrizzleAdapter, dialect);

    const cwd = options.cwd ?? process.cwd();
    const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);

    logger.debug(`Scanning migrations in ${migrationsDir}...`);

    const migrationFiles = await discoverMigrations(migrationsDir);
    logger.debug(`Found ${migrationFiles.length} migration file(s)`);

    const appliedMigrations = await getAppliedMigrations(
      adapter as unknown as DrizzleAdapter,
      dialect
    );
    logger.debug(`${appliedMigrations.length} migration(s) in database`);

    const migrationStatuses = buildMigrationStatuses(
      migrationFiles,
      appliedMigrations
    );

    const pendingCollections = await getCollectionsWithPendingChanges(
      adapter as unknown as DrizzleAdapter,
      dialect
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
      collectionsWithPendingChanges: pendingCollections.length,
    };

    if (options.json) {
      const result: MigrateStatusResult = {
        migrations: migrationStatuses,
        collections: pendingCollections,
        summary,
      };
      console.log(JSON.stringify(result, null, 2));
    } else {
      displayStatus(migrationStatuses, pendingCollections, summary, context);
    }
  } finally {
    await adapter.disconnect();
  }
}

async function discoverMigrations(
  migrationsDir: string
): Promise<ParsedMigration[]> {
  let files: string[];

  try {
    files = await readdir(migrationsDir);
  } catch {
    return [];
  }

  const sqlFiles = files
    .filter(f => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const migrations: ParsedMigration[] = [];

  for (const file of sqlFiles) {
    const filePath = resolve(migrationsDir, file);
    const name = basename(file, ".sql");

    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = parseMigrationFile(name, filePath, content);
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
    collections,
    timestamp,
  };
}

// F11: kept in sync with `cli/commands/migrate.ts:ensureMigrationsTable`.
// This is a duplicated helper today; both call sites need the new schema
// in lockstep. A shared helper extraction is a follow-up cleanup (out of
// PR 1 scope to keep diff focused).
//
// MIRROR: keep this in sync with `migrate.ts:ensureMigrationsTable`
// AND with `database/migrations/<dialect>/20260429_000000_000_initial_journal.sql`
// AND with `migrate-fresh.ts:generateSqliteCreateStatements`.
async function ensureMigrationsTable(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<void> {
  let createTableSql: string;

  switch (dialect) {
    case "postgresql":
      createTableSql = `
        CREATE TABLE IF NOT EXISTS "nextly_migrations" (
          "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "filename"     TEXT NOT NULL UNIQUE,
          "sha256"       CHAR(64) NOT NULL,
          "applied_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "applied_by"   TEXT,
          "duration_ms"  INTEGER,
          "status"       TEXT NOT NULL CHECK ("status" IN ('applied', 'failed')),
          "error_json"   JSONB,
          "rollback_sql" TEXT
        );
        CREATE INDEX IF NOT EXISTS "nextly_migrations_applied_at_idx"
          ON "nextly_migrations" ("applied_at");
      `;
      break;
    case "mysql":
      createTableSql = `
        CREATE TABLE IF NOT EXISTS \`nextly_migrations\` (
          \`id\`           VARCHAR(36) PRIMARY KEY,
          \`filename\`     VARCHAR(512) NOT NULL UNIQUE,
          \`sha256\`       CHAR(64) NOT NULL,
          \`applied_at\`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`applied_by\`   VARCHAR(255),
          \`duration_ms\`  INTEGER,
          \`status\`       VARCHAR(20) NOT NULL CHECK (\`status\` IN ('applied', 'failed')),
          \`error_json\`   JSON,
          \`rollback_sql\` TEXT,
          INDEX \`nextly_migrations_applied_at_idx\` (\`applied_at\`)
        )
      `;
      break;
    case "sqlite":
      createTableSql = `
        CREATE TABLE IF NOT EXISTS "nextly_migrations" (
          "id"           TEXT PRIMARY KEY,
          "filename"     TEXT NOT NULL UNIQUE,
          "sha256"       TEXT NOT NULL,
          "applied_at"   INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
          "applied_by"   TEXT,
          "duration_ms"  INTEGER,
          "status"       TEXT NOT NULL CHECK ("status" IN ('applied', 'failed')),
          "error_json"   TEXT,
          "rollback_sql" TEXT
        );
        CREATE INDEX IF NOT EXISTS "nextly_migrations_applied_at_idx"
          ON "nextly_migrations" ("applied_at");
      `;
      break;
    default:
      throw new Error(`Unsupported dialect: ${dialect as string}`);
  }

  await adapter.executeQuery(createTableSql);
}

// F11: parses the structured error_json column. SQLite stores TEXT;
// PG/MySQL return parsed objects (or string-encoded depending on driver).
function parseErrorJson(value: unknown): MigrationErrorJson | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value as MigrationErrorJson;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as MigrationErrorJson;
    } catch {
      return { message: value };
    }
  }
  return null;
}

async function getAppliedMigrations(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<MigrationRecord[]> {
  const query =
    dialect === "mysql"
      ? "SELECT * FROM `nextly_migrations` ORDER BY `applied_at` ASC"
      : 'SELECT * FROM "nextly_migrations" ORDER BY "applied_at" ASC';

  try {
    const results = await adapter.executeQuery<Record<string, unknown>>(query);

    return results.map(row => ({
      id: coerceString(row.id),
      filename: coerceString(row.filename),
      sha256: coerceString(row.sha256),
      status: coerceString(row.status) as MigrationRecordStatus,
      appliedBy: coerceStringOrNull(row.applied_by),
      durationMs: coerceNumberOrNull(row.duration_ms),
      errorJson: parseErrorJson(row.error_json),
      appliedAt: coerceDate(row.applied_at),
    }));
  } catch {
    return [];
  }
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

function coerceNumberOrNull(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number")
    return new Date(value);
  return new Date(0);
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
function buildMigrationStatuses(
  files: ParsedMigration[],
  applied: MigrationRecord[]
): MigrationStatus[] {
  const appliedMap = new Map(applied.map(m => [m.filename, m]));
  const statuses: MigrationStatus[] = [];

  for (const file of files) {
    const record = appliedMap.get(file.name);

    if (record) {
      const checksumMismatch = record.sha256 !== file.checksum;
      let status: MigrationStatus["status"];
      if (record.status === "failed") {
        status = "failed";
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
      });

      appliedMap.delete(file.name);
    } else {
      statuses.push({
        filename: file.name,
        status: "pending",
        appliedAt: null,
        durationMs: null,
        errorJson: null,
        checksumMismatch: false,
      });
    }
  }

  for (const [filename, record] of appliedMap) {
    statuses.push({
      filename,
      status: record.status === "failed" ? "failed" : "applied (file missing)",
      appliedAt: record.appliedAt,
      durationMs: record.durationMs,
      errorJson: record.errorJson,
      checksumMismatch: false,
    });
  }

  return statuses.sort((a, b) => a.filename.localeCompare(b.filename));
}

function displayStatus(
  migrations: MigrationStatus[],
  collections: CollectionPendingChange[],
  summary: MigrateStatusResult["summary"],
  context: CommandContext
): void {
  const { logger } = context;
  const verbose = context.options.verbose;

  if (migrations.length === 0) {
    logger.newline();
    logger.info("No migrations found.");
    logger.info("Run `nextly migrate:create` to create a migration.");
  } else {
    logger.newline();

    // F11: dropped Batch column (forward-only model has no batches);
    // added Duration so operators can spot slow migrations at a glance.
    const headers = ["Migration", "Status", "Applied At", "Duration"];
    const rows: (string | number | boolean)[][] = migrations.map(m => {
      const statusDisplay = formatStatusForDisplay(m.status);
      return [
        m.filename,
        statusDisplay,
        m.appliedAt ? formatDate(m.appliedAt) : "-",
        m.durationMs !== null ? `${m.durationMs}ms` : "-",
      ];
    });

    logger.table(headers, rows);

    if (verbose) {
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

    logger.newline();
    const summaryParts: string[] = [];
    if (summary.applied > 0) {
      summaryParts.push(`${summary.applied} applied`);
    }
    if (summary.pending > 0) {
      summaryParts.push(`${summary.pending} pending`);
    }
    if (summary.failed > 0) {
      summaryParts.push(`${summary.failed} failed`);
    }

    if (summaryParts.length > 0) {
      logger.info(`Summary: ${summaryParts.join(", ")}`);
    }
  }

  if (collections.length > 0) {
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
    logger.info("Run `nextly migrate:create` to generate migrations.");
  }
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
 * Register the migrate:status command with the program
 *
 * @param program - Commander program instance
 */
export function registerMigrateStatusCommand(program: Command): void {
  program
    .command("migrate:status")
    .description("Show current migration status")
    .option("--json", "Output as JSON for scripting/CI", false)
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
          console.log(
            JSON.stringify(
              { error: error instanceof Error ? error.message : String(error) },
              null,
              2
            )
          );
        } else {
          context.logger.error(
            error instanceof Error ? error.message : String(error)
          );
        }
        process.exit(1);
      }
    });
}
