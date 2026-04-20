/**
 * Migrate Command
 *
 * Implements the `nextly migrate` command for running pending database migrations.
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

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { Command } from "commander";

import type { SupportedDialect } from "../../domains/schema/services/schema-generator.js";
import type { MigrationRecordStatus } from "../../schemas/dynamic-collections/types.js";
import {
  createContext,
  type CommandContext,
  type GlobalOptions,
} from "../program.js";
import {
  createAdapter,
  validateDatabaseEnv,
  getDialectDisplayName,
  type CLIDatabaseAdapter,
} from "../utils/adapter.js";
import { loadConfig, type LoadConfigResult } from "../utils/config-loader.js";
import { formatDuration, formatCount } from "../utils/logger.js";

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
 * Database migration record
 */
interface MigrationRecord {
  id: string;
  name: string;
  batch: number;
  checksum: string;
  status: MigrationRecordStatus;
  errorMessage?: string;
  executedAt: Date;
}

/**
 * Result of a single migration execution
 */
interface MigrationExecutionResult {
  name: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Result of the migrate command
 */
interface MigrateResult {
  /** Number of migrations applied */
  applied: number;
  /** Number of migrations skipped (already applied) */
  skipped: number;
  /** Number of migrations failed */
  failed: number;
  /** Batch number used for this run */
  batch: number;
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

async function ensureMigrationsTable(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<void> {
  let createTableSql: string;

  switch (dialect) {
    case "postgresql":
      createTableSql = `
        CREATE TABLE IF NOT EXISTS "nextly_migrations" (
          "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "name" VARCHAR(255) NOT NULL UNIQUE,
          "batch" INTEGER NOT NULL,
          "checksum" VARCHAR(64) NOT NULL,
          "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
          "error_message" TEXT,
          "executed_at" TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `;
      break;
    case "mysql":
      createTableSql = `
        CREATE TABLE IF NOT EXISTS \`nextly_migrations\` (
          \`id\` VARCHAR(36) PRIMARY KEY,
          \`name\` VARCHAR(255) NOT NULL UNIQUE,
          \`batch\` INTEGER NOT NULL,
          \`checksum\` VARCHAR(64) NOT NULL,
          \`status\` VARCHAR(20) NOT NULL DEFAULT 'pending',
          \`error_message\` TEXT,
          \`executed_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;
      break;
    case "sqlite":
      createTableSql = `
        CREATE TABLE IF NOT EXISTS "nextly_migrations" (
          "id" TEXT PRIMARY KEY,
          "name" TEXT NOT NULL UNIQUE,
          "batch" INTEGER NOT NULL,
          "checksum" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'pending',
          "error_message" TEXT,
          "executed_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
      `;
      break;
    default:
      throw new Error(`Unsupported dialect: ${dialect}`);
  }

  await adapter.executeQuery(createTableSql);
}

async function getAppliedMigrations(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<MigrationRecord[]> {
  const query =
    dialect === "mysql"
      ? "SELECT * FROM `nextly_migrations` ORDER BY `executed_at` ASC"
      : 'SELECT * FROM "nextly_migrations" ORDER BY "executed_at" ASC';

  try {
    const results = await adapter.executeQuery<Record<string, unknown>>(query);

    return results.map(row => ({
      id: String(row.id),
      name: String(row.name),
      batch: Number(row.batch),
      checksum: String(row.checksum),
      status: String(row.status) as MigrationRecordStatus,
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      executedAt: new Date(row.executed_at as string | number),
    }));
  } catch {
    return [];
  }
}

async function getNextBatchNumber(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<number> {
  const query =
    dialect === "mysql"
      ? "SELECT MAX(`batch`) as max_batch FROM `nextly_migrations`"
      : 'SELECT MAX("batch") as max_batch FROM "nextly_migrations"';

  try {
    const results = await adapter.executeQuery<{ max_batch: number | null }>(
      query
    );
    const maxBatch = results[0]?.max_batch ?? 0;
    return maxBatch + 1;
  } catch {
    return 1;
  }
}

function findPendingMigrations(
  files: ParsedMigration[],
  applied: MigrationRecord[],
  logger: CommandContext["logger"]
): ParsedMigration[] {
  const appliedNames = new Set(applied.map(m => m.name));
  const appliedChecksums = new Map(applied.map(m => [m.name, m.checksum]));

  const pending: ParsedMigration[] = [];

  for (const file of files) {
    if (appliedNames.has(file.name)) {
      const appliedChecksum = appliedChecksums.get(file.name);
      if (appliedChecksum && appliedChecksum !== file.checksum) {
        logger.warn(
          `Migration '${file.name}' has been modified since it was applied (checksum mismatch)`
        );
      }
      continue;
    }

    pending.push(file);
  }

  return pending.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
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

  let batch = 0;
  let applied = 0;
  let failed = 0;

  if (!options.dryRun) {
    batch = await getNextBatchNumber(adapter, dialect);
    logger.debug(`Using batch number: ${batch}`);
  }

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
        name: migration.name,
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
        batch,
        logger
      );

      const duration = Date.now() - migrationStart;
      logger.success(`  Applied in ${formatDuration(duration)}`);

      results.push({
        name: migration.name,
        success: true,
        durationMs: duration,
      });
      applied++;
    } catch (error) {
      const duration = Date.now() - migrationStart;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error(`  Failed: ${errorMessage}`);

      results.push({
        name: migration.name,
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
    batch,
    migrations: results,
    durationMs: Date.now() - startTime,
    isDryRun: options.dryRun ?? false,
  };
}

async function executeMigrationInTransaction(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  migration: ParsedMigration,
  batch: number,
  logger: CommandContext["logger"]
): Promise<void> {
  const id = generateUUID();

  await executeTransaction(adapter, dialect, async () => {
    const statements = splitSqlStatements(migration.upSql);

    for (const statement of statements) {
      if (statement.trim()) {
        logger.debug(`Executing: ${statement.substring(0, 100)}...`);
        await adapter.executeQuery(statement);
      }
    }

    await recordMigration(adapter, dialect, {
      id,
      name: migration.name,
      batch,
      checksum: migration.checksum,
      status: "applied",
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

async function recordMigration(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  record: {
    id: string;
    name: string;
    batch: number;
    checksum: string;
    status: MigrationRecordStatus;
    errorMessage?: string;
  }
): Promise<void> {
  let insertSql: string;

  switch (dialect) {
    case "postgresql":
      insertSql = `
        INSERT INTO "nextly_migrations" ("id", "name", "batch", "checksum", "status", "error_message", "executed_at")
        VALUES ('${record.id}', '${escapeSql(record.name)}', ${record.batch}, '${record.checksum}', '${record.status}', ${record.errorMessage ? `'${escapeSql(record.errorMessage)}'` : "NULL"}, NOW())
      `;
      break;
    case "mysql":
      insertSql = `
        INSERT INTO \`nextly_migrations\` (\`id\`, \`name\`, \`batch\`, \`checksum\`, \`status\`, \`error_message\`, \`executed_at\`)
        VALUES ('${record.id}', '${escapeSql(record.name)}', ${record.batch}, '${record.checksum}', '${record.status}', ${record.errorMessage ? `'${escapeSql(record.errorMessage)}'` : "NULL"}, NOW())
      `;
      break;
    case "sqlite":
      insertSql = `
        INSERT INTO "nextly_migrations" ("id", "name", "batch", "checksum", "status", "error_message", "executed_at")
        VALUES ('${record.id}', '${escapeSql(record.name)}', ${record.batch}, '${record.checksum}', '${record.status}', ${record.errorMessage ? `'${escapeSql(record.errorMessage)}'` : "NULL"}, strftime('%s', 'now'))
      `;
      break;
    default:
      throw new Error(`Unsupported dialect: ${dialect}`);
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

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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
  logger.keyValue("Batch", result.batch);

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
      m.name,
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
      logger.error(`  ${m.name}: ${m.error}`);
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
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
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
