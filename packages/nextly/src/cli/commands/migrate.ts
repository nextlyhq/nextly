/**
 * Migrate Command
 *
 * Implements the `nextly migrate` command for running pending database migrations.
 *
 * **Runtime restriction (F11):** This module is CLI-only. Do NOT
 * import it from runtime code (init/, route-handler/, dispatcher/, api/,
 * actions/, direct-api/, routeHandler.ts, next.ts). The deployed
 * Next.js app must not perform schema migrations at boot. Enforced by
 * ESLint (`no-restricted-imports`); see
 * docs/guides/production-migrations.mdx for the deploy-time CLI patterns.
 *
 * @module cli/commands/migrate
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # Run all pending migrations
 * nextly migrate
 *
 * # Preview migrations without executing (dry run)
 * nextly migrate --dry-run
 *
 * # Run only the next 2 migrations
 * nextly migrate --step 2
 *
 * # Custom config path
 * nextly migrate --config ./custom/nextly.config.ts
 * ```
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { Command } from "commander";

import type { SupportedDialect } from "../../domains/schema/services/schema-generator";
import type {
  MigrationErrorJson,
  MigrationRecordStatus,
} from "../../schemas/dynamic-collections/types";
import { createContext, type CommandContext } from "../program";
import {
  createAdapter,
  validateDatabaseEnv,
  getDialectDisplayName,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { loadConfig, type LoadConfigResult } from "../utils/config-loader";
import { formatDuration, formatCount } from "../utils/logger";

/**
 * Options specific to the migrate command
 */
export interface MigrateCommandOptions {
  /**
   * Show what would be migrated without executing.
   * @default false
   */
  dryRun?: boolean;

  /**
   * Run only N migrations.
   */
  step?: number;
}

/**
 * Combined options (global + command-specific)
 */
interface ResolvedMigrateOptions extends MigrateCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

/**
 * Migration source type
 */
type MigrationSource = "core" | "app";

/**
 * Parsed migration file data
 */
interface ParsedMigration {
  /** Migration file name (without extension) */
  name: string;
  /** Full file path */
  filePath: string;
  /** UP SQL statements */
  upSql: string;
  /** DOWN SQL statements */
  downSql: string;
  /** SHA-256 checksum of file content */
  checksum: string;
  /** Original checksum from file header (if present) */
  originalChecksum?: string;
  /** Collection slugs (if present in file header) */
  collections: string[];
  /** Single slugs (if present in file header) */
  singles: string[];
  /** Component slugs (if present in file header) */
  components: string[];
  /** Timestamp extracted from filename */
  timestamp: string;
  /** Source of the migration (core bundled or app) */
  source: MigrationSource;
}

/**
 * Database migration record (F11 schema).
 *
 * Mirrors the row shape of `nextly_migrations` from the F11 spec.
 * `appliedBy`/`durationMs`/`errorJson` may be NULL on rows written by
 * older Nextly builds before F11; new writes always populate them.
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
 * Result of a single migration execution
 */
interface MigrationExecutionResult {
  filename: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Result of the migrate command (F11).
 *
 * Per Q4=A, F11 is forward-only — no `batch` concept (there's no
 * rollback grouping to track).
 */
interface MigrateResult {
  /** Number of migrations applied */
  applied: number;
  /** Number of migrations skipped (already applied) */
  skipped: number;
  /** Number of migrations failed */
  failed: number;
  /** Individual migration results */
  migrations: MigrationExecutionResult[];
  /** Total duration in milliseconds */
  durationMs: number;
  /** Whether this was a dry run */
  isDryRun: boolean;
}

/**
 * Execute the migrate command
 *
 * @param options - Combined global and command options
 * @param context - Command context with logger
 */
export async function runMigrate(
  options: ResolvedMigrateOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const startTime = Date.now();

  logger.header("Migrate");

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

  if (options.dryRun) {
    logger.keyValue("Mode", "Dry Run (no changes will be made)");
  }

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
    logger.debug("Checking migrations table...");
    await ensureMigrationsTable(adapter as unknown as DrizzleAdapter, dialect);

    const cwd = options.cwd ?? process.cwd();
    const appMigrationsDir = resolve(cwd, configResult.config.db.migrationsDir);

    const bundledMigrationsDir = getBundledMigrationsDir(dialect);

    logger.newline();

    const migrationFiles: ParsedMigration[] = [];

    if (bundledMigrationsDir) {
      logger.debug(`Scanning bundled migrations in ${bundledMigrationsDir}...`);
      const bundledMigrations = await discoverMigrations(
        bundledMigrationsDir,
        logger,
        "core"
      );
      if (bundledMigrations.length > 0) {
        logger.debug(
          `Found ${bundledMigrations.length} bundled core migration(s)`
        );
        migrationFiles.push(...bundledMigrations);
      }
    }

    logger.info(`Scanning migrations in ${appMigrationsDir}...`);
    const appMigrations = await discoverMigrations(
      appMigrationsDir,
      logger,
      "app"
    );
    if (appMigrations.length > 0) {
      logger.debug(`Found ${appMigrations.length} app migration(s)`);
      migrationFiles.push(...appMigrations);
    }

    migrationFiles.sort((a, b) => a.name.localeCompare(b.name));

    if (migrationFiles.length === 0) {
      logger.newline();
      logger.info("No migration files found.");
      logger.info("Run `nextly migrate:create` to create a migration.");
      return;
    }

    logger.debug(`Found ${migrationFiles.length} migration file(s)`);

    const appliedMigrations = await getAppliedMigrations(
      adapter as unknown as DrizzleAdapter,
      dialect
    );
    logger.debug(`${appliedMigrations.length} migration(s) already applied`);

    const pendingMigrations = findPendingMigrations(
      migrationFiles,
      appliedMigrations,
      logger
    );

    if (pendingMigrations.length === 0) {
      logger.newline();
      logger.success("Nothing to migrate. Database is up to date.");
      return;
    }

    let migrationsToRun = pendingMigrations;
    if (options.step && options.step > 0) {
      migrationsToRun = pendingMigrations.slice(0, options.step);
      logger.keyValue(
        "Step limit",
        `${migrationsToRun.length} of ${pendingMigrations.length}`
      );
    }

    logger.keyValue(
      "Pending",
      formatCount(migrationsToRun.length, "migration")
    );

    logger.newline();

    const result = await executeMigrations(
      migrationsToRun,
      adapter as unknown as DrizzleAdapter,
      dialect,
      appliedMigrations,
      options,
      context
    );

    displayResults(result, context);

    const duration = Date.now() - startTime;
    logger.newline();
    logger.divider();

    if (result.isDryRun) {
      logger.success(
        `Dry run completed in ${formatDuration(duration)} (no changes made)`
      );
    } else if (result.failed > 0) {
      logger.error(
        `Migration failed after ${formatDuration(duration)}. ${result.applied} applied, ${result.failed} failed.`
      );
      process.exit(1);
    } else {
      logger.success(
        `${formatCount(result.applied, "migration")} applied in ${formatDuration(duration)}`
      );
    }
  } finally {
    await adapter.disconnect();
  }
}

/**
 * Get the path to bundled core migrations for a given dialect.
 * Returns undefined if bundled migrations are not found.
 */
function getBundledMigrationsDir(
  dialect: SupportedDialect
): string | undefined {
  try {
    // With code splitting the migrate code may live either in:
    //   dist/cli/nextly.mjs  (monolithic build)
    //   dist/program-<hash>.mjs  (code-split chunk)
    // So we check candidate paths from closest to furthest.
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFilePath);

    const dialectDir = dialect === "postgresql" ? "postgresql" : dialect;

    // Candidate paths: current dir (chunk lives in dist/), one level up
    // (file lives in dist/cli/), or two levels up (future nesting).
    const candidates = [
      resolve(currentDir, "migrations", dialectDir),
      resolve(currentDir, "..", "migrations", dialectDir),
      resolve(currentDir, "..", "..", "migrations", dialectDir),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

async function discoverMigrations(
  migrationsDir: string,
  logger: CommandContext["logger"],
  source: MigrationSource = "app"
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
      const parsed = parseMigrationFile(name, filePath, content, source);
      migrations.push(parsed);
    } catch (error) {
      logger.warn(
        `Failed to parse migration file ${file}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return migrations;
}

function parseMigrationFile(
  name: string,
  filePath: string,
  content: string,
  source: MigrationSource = "app"
): ParsedMigration {
  const checksum = createHash("sha256").update(content).digest("hex");

  const checksumMatch = content.match(/^-- Checksum:\s*([a-f0-9]+)/m);
  const originalChecksum = checksumMatch?.[1];

  const collectionsMatch = content.match(/^-- Collections?:\s*(.+)$/m);
  const collections = collectionsMatch
    ? collectionsMatch[1]
        .split(",")
        .map(c => c.trim())
        .filter(c => c.length > 0)
    : [];

  const singlesMatch = content.match(/^-- Singles?:\s*(.+)$/m);
  const singles = singlesMatch
    ? singlesMatch[1]
        .split(",")
        .map(s => s.trim())
        .filter(s => s.length > 0)
    : [];

  const componentsMatch = content.match(/^-- Components?:\s*(.+)$/m);
  const components = componentsMatch
    ? componentsMatch[1]
        .split(",")
        .map(c => c.trim())
        .filter(c => c.length > 0)
    : [];

  const timestampMatch = name.match(/^(\d{8}_\d{6})/);
  const timestamp = timestampMatch?.[1] ?? name;

  const { upSql, downSql } = parseSqlSections(content);

  return {
    name,
    filePath,
    upSql,
    downSql,
    checksum,
    originalChecksum,
    collections,
    singles,
    components,
    timestamp,
    source,
  };
}

function parseSqlSections(content: string): { upSql: string; downSql: string } {
  const lines = content.split("\n");

  let upLines: string[] = [];
  const downLines: string[] = [];
  let currentSection: "none" | "up" | "down" = "none";

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine === "-- UP" || trimmedLine.startsWith("-- UP ")) {
      currentSection = "up";
      continue;
    }
    if (trimmedLine === "-- DOWN" || trimmedLine.startsWith("-- DOWN ")) {
      currentSection = "down";
      continue;
    }

    if (currentSection === "up") {
      upLines.push(line);
    } else if (currentSection === "down") {
      downLines.push(line);
    }
  }

  if (upLines.length === 0 && downLines.length === 0) {
    upLines = lines.filter(
      line =>
        !line.trim().startsWith("-- Migration:") &&
        !line.trim().startsWith("-- Generated") &&
        !line.trim().startsWith("-- Dialect:") &&
        !line.trim().startsWith("-- Checksum:") &&
        !line.trim().startsWith("-- Collections:") &&
        !line.trim().startsWith("-- Singles:")
    );
  }

  return {
    upSql: upLines.join("\n").trim(),
    downSql: downLines.join("\n").trim(),
  };
}

// F11: ensureMigrationsTable runs as a safety net on bare DBs that haven't
// applied the bundled `0001_initial_journal.sql` yet. The bundled migration
// runs FIRST in normal flow; this function is idempotent (`IF NOT EXISTS`).
// The CHECK constraint enforces the F11 two-state lifecycle (`'applied'` /
// `'failed'`); rows are inserted only after the apply attempt completes.
//
// MIRROR: keep this in sync with `migrate-status.ts:ensureMigrationsTable`
// AND with `database/migrations/<dialect>/20260429_000000_000_initial_journal.sql`
// AND with `migrate-fresh.ts:generateSqliteCreateStatements`. A future PR
// extracts this into a shared helper; until then, a drift check would
// silently break production migration apply.
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

// F11: small coercion helpers for adapter-returned `Record<string, unknown>`.
// Per `feedback_no_type_workarounds`, we use real type guards instead of
// `String(unknown)` (which trips no-base-to-string on object values).
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

// F11: parse the structured `error_json` column. SQLite stores JSON as TEXT,
// PG returns the parsed object directly via JSONB, MySQL returns a JSON-typed
// value that may come back as a string or object depending on driver.
// This helper normalises all three.
function parseErrorJson(value: unknown): MigrationErrorJson | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value as MigrationErrorJson;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as MigrationErrorJson;
    } catch {
      // Driver gave us something unparseable; surface it as message-only
      // so operators still see SOMETHING in `nextly migrate:status`.
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

// F11: hash mismatch is now a hard fail. Per spec §6.2 + Q9=B, mandatory
// hash verification catches "someone edited an applied migration" before
// any further DDL runs. Operators recover by either reverting the edit or
// writing a NEW corrective migration. Same hard-fail for files referenced
// in the journal but missing from disk (`MIGRATION_MISSING`).
//
// IMPORTANT: only rows with status='applied' count as "already applied"
// for the pending-set computation. Rows with status='failed' are RETURNED
// as pending so the operator can fix the SQL and re-run. The retry path
// in `executeMigrationInTransaction` deletes the prior failed row inside
// the same transaction so the unique(filename) constraint doesn't trip.
//
// Exported as `findPendingMigrationsForTest` so unit tests can exercise
// the retry-of-failed-migration semantics without spinning up a DB.
export function findPendingMigrationsForTest(
  files: ParsedMigration[],
  applied: MigrationRecord[],
  logger: CommandContext["logger"]
): ParsedMigration[] {
  return findPendingMigrations(files, applied, logger);
}

function findPendingMigrations(
  files: ParsedMigration[],
  applied: MigrationRecord[],
  logger: CommandContext["logger"]
): ParsedMigration[] {
  // Only successfully-applied rows block re-application. Failed rows
  // represent recoverable state — the operator typically iterates on the
  // SQL and re-runs `nextly migrate`. Treating failed rows as "already
  // applied" would silently skip the retry; the bug also breaks the spec
  // §6.2 recovery loop. See PR 1 review issue #1.
  const successfullyApplied = applied.filter(m => m.status === "applied");
  const appliedFilenames = new Set(successfullyApplied.map(m => m.filename));
  const appliedHashes = new Map(
    successfullyApplied.map(m => [m.filename, m.sha256])
  );
  const fileNames = new Set(files.map(f => f.name));

  // Check for files in the journal that no longer exist on disk.
  // Only count successfully-applied rows here — a failed row pointing at
  // a now-deleted file is just stale state from a prior failed run, not
  // a missing applied migration.
  for (const record of successfullyApplied) {
    if (!fileNames.has(record.filename)) {
      logger.error(
        `MIGRATION_MISSING: '${record.filename}' was applied previously but is no longer present in the migrations directory. ` +
          `Restore the file from version control before proceeding.`
      );
      process.exit(3);
    }
  }

  const pending: ParsedMigration[] = [];

  for (const file of files) {
    if (appliedFilenames.has(file.name)) {
      const expectedHash = appliedHashes.get(file.name);
      if (expectedHash && expectedHash !== file.checksum) {
        logger.error(
          `MIGRATION_TAMPERED: '${file.name}' has been modified since it was applied. ` +
            `Expected SHA-256: ${expectedHash}; computed: ${file.checksum}. ` +
            `If this change is intentional, write a new corrective migration instead.`
        );
        process.exit(2);
      }
      continue;
    }

    pending.push(file);
  }

  return pending.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// F11: resolve "who/what ran this migration" with a documented precedence
// chain so prod debugging can answer "which CI job applied this row?".
//
// F11 PR 1 review fix #11: explicit `undefined` checks instead of `||`
// so an unusual valid actor name like "0" or "false" doesn't silently
// fall through to the next env var.
function getAppliedBy(): string {
  if (
    process.env.NEXTLY_APPLIED_BY !== undefined &&
    process.env.NEXTLY_APPLIED_BY !== ""
  )
    return process.env.NEXTLY_APPLIED_BY;
  if (process.env.GITHUB_ACTOR !== undefined && process.env.GITHUB_ACTOR !== "")
    return process.env.GITHUB_ACTOR;
  if (process.env.USER !== undefined && process.env.USER !== "")
    return process.env.USER;
  return hostname();
}

async function executeMigrations(
  migrations: ParsedMigration[],
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  _appliedMigrations: MigrationRecord[],
  options: ResolvedMigrateOptions,
  context: CommandContext
): Promise<MigrateResult> {
  const { logger } = context;
  const results: MigrationExecutionResult[] = [];
  const startTime = Date.now();
  const appliedBy = getAppliedBy();

  let applied = 0;
  let failed = 0;

  for (const migration of migrations) {
    const migrationStart = Date.now();

    if (options.dryRun) {
      logger.info(`Would run: ${migration.name}`);

      if (options.verbose) {
        logger.debug("SQL:");
        for (const line of migration.upSql.split("\n").slice(0, 10)) {
          logger.debug(`  ${line}`);
        }
        if (migration.upSql.split("\n").length > 10) {
          logger.debug("  ...");
        }
      }

      results.push({
        filename: migration.name,
        success: true,
        durationMs: Date.now() - migrationStart,
      });
      applied++;
      continue;
    }

    logger.info(`Running: ${migration.name}`);

    try {
      await executeMigrationInTransaction(
        adapter,
        dialect,
        migration,
        appliedBy,
        logger
      );

      const duration = Date.now() - migrationStart;
      logger.success(`  Applied in ${formatDuration(duration)}`);

      results.push({
        filename: migration.name,
        success: true,
        durationMs: duration,
      });
      applied++;
    } catch (error) {
      const duration = Date.now() - migrationStart;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // F11: capture structured error info so operators can debug from
      // `nextly migrate:status` without re-reading driver logs.
      const errorJson: MigrationErrorJson = {
        sqlState: extractSqlState(error),
        message: errorMessage,
        // Per-statement failure tracking is F15 scope (per-statement
        // journaling on `nextly_migration_journal`); F11's transactional
        // PG/SQLite path can't isolate which statement failed inside a tx.
      };

      logger.error(`  Failed: ${errorMessage}`);

      // Best-effort: record the failed migration in the journal so the
      // next `migrate:status` shows it as `failed`. If THIS write also
      // fails (e.g., DB unreachable), we just log and continue — the
      // surrounding `for` loop's `break` ensures we don't try the next.
      //
      // F11 PR 1 review fix #1: delete any prior failed row first so
      // the unique(filename) constraint doesn't block this INSERT when
      // the operator is on their second-or-later attempt.
      try {
        await deleteFailedMigrationRow(adapter, dialect, migration.name);
        await recordMigration(adapter, dialect, {
          id: randomUUID(),
          filename: migration.name,
          sha256: migration.checksum,
          status: "failed",
          appliedBy,
          durationMs: duration,
          errorJson,
        });
      } catch (recordErr) {
        logger.warn(
          `  Could not record failure in nextly_migrations: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`
        );
      }

      results.push({
        filename: migration.name,
        success: false,
        durationMs: duration,
        error: errorMessage,
      });
      failed++;

      break;
    }
  }

  return {
    applied,
    skipped: 0,
    failed,
    migrations: results,
    durationMs: Date.now() - startTime,
    isDryRun: options.dryRun ?? false,
  };
}

// F11: extract a SQLSTATE-like code from common driver error shapes.
// PG (`pg`) sets `code`; MySQL (`mysql2`) sets `code` + `sqlState`; SQLite
// (`better-sqlite3`) puts SQLITE_* in `code`. We surface whichever exists.
function extractSqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as { sqlState?: unknown; code?: unknown };
  if (typeof e.sqlState === "string") return e.sqlState;
  if (typeof e.code === "string") return e.code;
  return undefined;
}

async function executeMigrationInTransaction(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  migration: ParsedMigration,
  appliedBy: string,
  logger: CommandContext["logger"]
): Promise<void> {
  const id = randomUUID();
  const startMs = Date.now();

  await executeTransaction(adapter, dialect, async () => {
    // F11 PR 1 review fix #1: if a previous run failed, there's a
    // status='failed' row for this filename. The unique(filename)
    // constraint would block our INSERT. Delete the prior failed row
    // INSIDE this transaction so the retry is atomic — either both
    // the cleanup and the new row commit, or neither does.
    await deleteFailedMigrationRow(adapter, dialect, migration.name);

    const statements = splitSqlStatements(migration.upSql);

    for (const statement of statements) {
      if (statement.trim()) {
        logger.debug(`Executing: ${statement.substring(0, 100)}...`);
        await adapter.executeQuery(statement);
      }
    }

    // F11: record `applied_by` and `duration_ms` so operators can debug
    // "who ran this and how long did it take?" without external tooling.
    await recordMigration(adapter, dialect, {
      id,
      filename: migration.name,
      sha256: migration.checksum,
      status: "applied",
      appliedBy,
      durationMs: Date.now() - startMs,
      errorJson: null,
    });

    if (migration.collections.length > 0) {
      await updateCollectionMigrationStatus(
        adapter,
        dialect,
        migration.collections,
        id,
        logger
      );
    }

    if (migration.singles.length > 0) {
      await updateSingleMigrationStatus(
        adapter,
        dialect,
        migration.singles,
        id,
        logger
      );
    }

    if (migration.components.length > 0) {
      await updateComponentMigrationStatus(
        adapter,
        dialect,
        migration.components,
        id,
        logger
      );
    }
  });
}

async function executeTransaction(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  fn: () => Promise<void>
): Promise<void> {
  const beginSql =
    dialect === "mysql" ? "START TRANSACTION" : "BEGIN TRANSACTION";
  const commitSql = "COMMIT";
  const rollbackSql = "ROLLBACK";

  try {
    await adapter.executeQuery(beginSql);
    await fn();
    await adapter.executeQuery(commitSql);
  } catch (error) {
    try {
      await adapter.executeQuery(rollbackSql);
    } catch {
      // Ignore rollback errors
    }
    throw error;
  }
}

// F11 PR 1 review fix #1: clear any prior failed-status row for a
// filename before inserting a new row. The unique(filename) constraint
// would otherwise block retries. Always safe — at most one failed row
// can exist per filename, and deleting nothing is a no-op.
async function deleteFailedMigrationRow(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  filename: string
): Promise<void> {
  const escaped = escapeSql(filename);
  const sql =
    dialect === "mysql"
      ? `DELETE FROM \`nextly_migrations\` WHERE \`filename\` = '${escaped}' AND \`status\` = 'failed'`
      : `DELETE FROM "nextly_migrations" WHERE "filename" = '${escaped}' AND "status" = 'failed'`;
  await adapter.executeQuery(sql);
}

// F11: insert a row into `nextly_migrations` per the spec §7 schema.
// SQLite stores `error_json` as TEXT so we JSON-encode it here; PG/MySQL
// have native JSON column types and accept the same JSON literal.
//
// Exported as `recordMigrationForTest` so unit tests can capture the
// emitted SQL without standing up a real DB.
export async function recordMigrationForTest(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  record: {
    id: string;
    filename: string;
    sha256: string;
    status: MigrationRecordStatus;
    appliedBy: string | null;
    durationMs: number | null;
    errorJson: MigrationErrorJson | null;
  }
): Promise<void> {
  return recordMigration(adapter, dialect, record);
}

async function recordMigration(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  record: {
    id: string;
    filename: string;
    sha256: string;
    status: MigrationRecordStatus;
    appliedBy: string | null;
    durationMs: number | null;
    errorJson: MigrationErrorJson | null;
  }
): Promise<void> {
  const appliedByLiteral = record.appliedBy
    ? `'${escapeSql(record.appliedBy)}'`
    : "NULL";
  const durationLiteral =
    record.durationMs !== null && record.durationMs !== undefined
      ? String(record.durationMs)
      : "NULL";
  // JSON-encode the error payload. Null on success rows. We use literal
  // SQL strings here because the existing migrate flow uses raw queries
  // (not Drizzle's typed builder) — F11 doesn't change that pattern.
  const errorJsonLiteral = record.errorJson
    ? `'${escapeSql(JSON.stringify(record.errorJson))}'`
    : "NULL";

  let insertSql: string;

  switch (dialect) {
    case "postgresql":
      insertSql = `
        INSERT INTO "nextly_migrations"
          ("id", "filename", "sha256", "status", "applied_by", "duration_ms", "error_json", "applied_at")
        VALUES
          ('${record.id}', '${escapeSql(record.filename)}', '${record.sha256}', '${record.status}',
           ${appliedByLiteral}, ${durationLiteral}, ${errorJsonLiteral}::jsonb, NOW())
      `;
      break;
    case "mysql":
      insertSql = `
        INSERT INTO \`nextly_migrations\`
          (\`id\`, \`filename\`, \`sha256\`, \`status\`, \`applied_by\`, \`duration_ms\`, \`error_json\`, \`applied_at\`)
        VALUES
          ('${record.id}', '${escapeSql(record.filename)}', '${record.sha256}', '${record.status}',
           ${appliedByLiteral}, ${durationLiteral}, ${errorJsonLiteral}, NOW())
      `;
      break;
    case "sqlite":
      // SQLite stores epoch-ms as INTEGER per the F11 schema. F11 PR 1
      // review fix #3: julianday() gives real sub-second precision.
      // The earlier `strftime('%s','now') * 1000` formula was second-
      // precision masquerading as ms — the `* 1000` just zero-pads.
      // 2440587.5 is the Julian day for 1970-01-01T00:00:00Z; subtracting
      // it gives days since the Unix epoch; * 86400000 converts to ms.
      // `error_json` is TEXT (JSON.parse on read).
      insertSql = `
        INSERT INTO "nextly_migrations"
          ("id", "filename", "sha256", "status", "applied_by", "duration_ms", "error_json", "applied_at")
        VALUES
          ('${record.id}', '${escapeSql(record.filename)}', '${record.sha256}', '${record.status}',
           ${appliedByLiteral}, ${durationLiteral}, ${errorJsonLiteral},
           CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
      `;
      break;
    default:
      throw new Error(`Unsupported dialect: ${dialect as string}`);
  }

  await adapter.executeQuery(insertSql);
}

async function updateCollectionMigrationStatus(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  collections: string[],
  migrationId: string,
  logger: CommandContext["logger"]
): Promise<void> {
  for (const slug of collections) {
    try {
      let updateSql: string;

      switch (dialect) {
        case "postgresql":
          updateSql = `
            UPDATE "dynamic_collections"
            SET "migration_status" = 'applied', "last_migration_id" = '${migrationId}', "updated_at" = NOW()
            WHERE "slug" = '${escapeSql(slug)}'
          `;
          break;
        case "mysql":
          updateSql = `
            UPDATE \`dynamic_collections\`
            SET \`migration_status\` = 'applied', \`last_migration_id\` = '${migrationId}', \`updated_at\` = NOW()
            WHERE \`slug\` = '${escapeSql(slug)}'
          `;
          break;
        case "sqlite":
          updateSql = `
            UPDATE "dynamic_collections"
            SET "migration_status" = 'applied', "last_migration_id" = '${migrationId}', "updated_at" = strftime('%s', 'now')
            WHERE "slug" = '${escapeSql(slug)}'
          `;
          break;
        default:
          continue;
      }

      await adapter.executeQuery(updateSql);
      logger.debug(`Updated migration status for collection: ${slug}`);
    } catch (error) {
      // Collection might not exist in dynamic_collections table - that's OK
      logger.debug(
        `Could not update collection '${slug}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

async function updateSingleMigrationStatus(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  singles: string[],
  migrationId: string,
  logger: CommandContext["logger"]
): Promise<void> {
  for (const slug of singles) {
    try {
      let updateSql: string;

      switch (dialect) {
        case "postgresql":
          updateSql = `
            UPDATE "dynamic_singles"
            SET "migration_status" = 'applied', "last_migration_id" = '${migrationId}', "updated_at" = NOW()
            WHERE "slug" = '${escapeSql(slug)}'
          `;
          break;
        case "mysql":
          updateSql = `
            UPDATE \`dynamic_singles\`
            SET \`migration_status\` = 'applied', \`last_migration_id\` = '${migrationId}', \`updated_at\` = NOW()
            WHERE \`slug\` = '${escapeSql(slug)}'
          `;
          break;
        case "sqlite":
          updateSql = `
            UPDATE "dynamic_singles"
            SET "migration_status" = 'applied', "last_migration_id" = '${migrationId}', "updated_at" = strftime('%s', 'now')
            WHERE "slug" = '${escapeSql(slug)}'
          `;
          break;
        default:
          continue;
      }

      await adapter.executeQuery(updateSql);
      logger.debug(`Updated migration status for single: ${slug}`);
    } catch (error) {
      // Single might not exist in dynamic_singles table - that's OK
      logger.debug(
        `Could not update single '${slug}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

async function updateComponentMigrationStatus(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  components: string[],
  migrationId: string,
  logger: CommandContext["logger"]
): Promise<void> {
  for (const slug of components) {
    try {
      let updateSql: string;

      switch (dialect) {
        case "postgresql":
          updateSql = `
            UPDATE "dynamic_components"
            SET "migration_status" = 'applied', "last_migration_id" = '${migrationId}', "updated_at" = NOW()
            WHERE "slug" = '${escapeSql(slug)}'
          `;
          break;
        case "mysql":
          updateSql = `
            UPDATE \`dynamic_components\`
            SET \`migration_status\` = 'applied', \`last_migration_id\` = '${migrationId}', \`updated_at\` = NOW()
            WHERE \`slug\` = '${escapeSql(slug)}'
          `;
          break;
        case "sqlite":
          updateSql = `
            UPDATE "dynamic_components"
            SET "migration_status" = 'applied', "last_migration_id" = '${migrationId}', "updated_at" = strftime('%s', 'now')
            WHERE "slug" = '${escapeSql(slug)}'
          `;
          break;
        default:
          continue;
      }

      await adapter.executeQuery(updateSql);
      logger.debug(`Updated migration status for component: ${slug}`);
    } catch (error) {
      // Component might not exist in dynamic_components table - that's OK
      logger.debug(
        `Could not update component '${slug}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

function splitSqlStatements(sql: string): string[] {
  // Remove Drizzle's statement breakpoint markers and SQL comments.
  // drizzle-kit uses two marker patterns in generated migration SQL:
  //   1. Standalone: `--> statement-breakpoint` on its own line (between CREATE TABLE blocks)
  //   2. Inline: `SQL_STATEMENT;--> statement-breakpoint` on the same line (after CREATE INDEX/ALTER)
  // Both must be cleaned out before executing, otherwise the marker text
  // ends up as invalid SQL in the next statement.
  const cleanedSql = sql
    .split("\n")
    .filter(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith("--> statement-breakpoint")) return false;
      // Remove pure SQL comment lines (but keep lines that have SQL after comments)
      if (
        trimmed.startsWith("--") &&
        !trimmed.includes("CREATE") &&
        !trimmed.includes("ALTER") &&
        !trimmed.includes("DROP") &&
        !trimmed.includes("INSERT")
      )
        return false;
      return true;
    })
    // Strip inline markers (pattern 2) that appear after semicolons on the
    // same line, e.g. `CREATE INDEX ...;--> statement-breakpoint`. Without
    // this, the text after the semicolon pollutes the next accumulated
    // statement and causes a MySQL syntax error.
    .map(line => line.replace(/--> statement-breakpoint/g, ""))
    .join("\n");

  const statements: string[] = [];
  let current = "";
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < cleanedSql.length; i++) {
    const char = cleanedSql[i];
    const prevChar = cleanedSql[i - 1];

    if ((char === "'" || char === '"') && prevChar !== "\\") {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
    }

    if (char === ";" && !inString) {
      const statement = current.trim();
      const hasSQL =
        /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|SELECT|TRUNCATE|GRANT|REVOKE)\b/i.test(
          statement
        );
      if (statement && hasSQL) {
        statements.push(statement);
      }
      current = "";
    } else {
      current += char;
    }
  }

  const finalStatement = current.trim();
  const hasFinalSQL =
    /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|SELECT|TRUNCATE|GRANT|REVOKE)\b/i.test(
      finalStatement
    );
  if (finalStatement && hasFinalSQL) {
    statements.push(finalStatement);
  }

  return statements;
}

// F11: dropped local generateUUID() in favor of node:crypto's randomUUID,
// which is what the rest of the codebase uses (matches schema/migration-journal
// pattern from F8 PR 5). Avoids re-implementing UUID v4 generation.

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function displayResults(result: MigrateResult, context: CommandContext): void {
  const { logger } = context;

  logger.newline();

  if (result.isDryRun) {
    logger.info("Dry Run Summary:");
    logger.keyValue("Would apply", formatCount(result.applied, "migration"));
    return;
  }

  if (result.applied === 0 && result.failed === 0) {
    logger.info("No migrations were executed.");
    return;
  }

  logger.info("Migration Summary:");
  // F11: dropped "Batch" key (no batch concept in forward-only model).

  if (result.applied > 0) {
    logger.keyValue("Applied", formatCount(result.applied, "migration"));
  }

  if (result.failed > 0) {
    logger.keyValue("Failed", formatCount(result.failed, "migration"));
  }

  if (result.migrations.length > 0) {
    logger.newline();
    const headers = ["Migration", "Status", "Duration"];
    const rows: (string | number | boolean)[][] = result.migrations.map(m => [
      m.filename,
      m.success ? "Applied" : "Failed",
      formatDuration(m.durationMs),
    ]);
    logger.table(headers, rows);
  }

  const failedMigrations = result.migrations.filter(m => !m.success);
  if (failedMigrations.length > 0) {
    logger.newline();
    logger.error("Error Details:");
    for (const m of failedMigrations) {
      logger.error(`  ${m.filename}: ${m.error}`);
    }
  }
}

/**
 * Register the migrate command with the program
 *
 * @param program - Commander program instance
 */
export function registerMigrateCommand(program: Command): void {
  program
    .command("migrate")
    .description("Run all pending database migrations")
    .option("--dry-run", "Show what would be migrated without executing", false)
    .option("--step <n>", "Run only N migrations", parseInt)
    .action(async (cmdOptions: MigrateCommandOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);

      const resolvedOptions: ResolvedMigrateOptions = {
        ...cmdOptions,
        config: globalOpts.config,
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
        cwd: globalOpts.cwd,
      };

      try {
        await runMigrate(resolvedOptions, context);
      } catch (error) {
        context.logger.error(
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
