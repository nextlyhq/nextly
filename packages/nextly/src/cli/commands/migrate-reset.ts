/**
 * Migrate Reset Command
 *
 * Implements the `nextly migrate:reset` command for rolling back all migrations
 * by executing DOWN scripts in reverse order.
 *
 * @module cli/commands/migrate-reset
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # Roll back all migrations (with confirmation)
 * nextly migrate:reset
 *
 * # Skip confirmation prompt
 * nextly migrate:reset --force
 *
 * # Custom config path
 * nextly migrate:reset --config ./custom/nextly.config.ts
 * ```
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { createInterface } from "node:readline";

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
 * Options specific to the migrate:reset command
 */
export interface MigrateResetCommandOptions {
  /**
   * Skip confirmation prompt.
   * @default false
   */
  force?: boolean;
}

/**
 * Combined options (global + command-specific)
 */
interface ResolvedMigrateResetOptions extends MigrateResetCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

/**
 * Parsed migration file data with DOWN SQL
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
  /** Collection slugs (if present in file header) */
  collections: string[];
  /** Timestamp extracted from filename */
  timestamp: string;
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
 * Result of a single migration rollback
 */
interface RollbackResult {
  name: string;
  batch: number;
  success: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Result of the reset command
 */
interface MigrateResetResult {
  /** Number of migrations rolled back */
  rolledBack: number;
  /** Number of batches processed */
  batchesProcessed: number;
  /** Individual rollback results */
  migrations: RollbackResult[];
  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Execute the migrate:reset command
 *
 * @param options - Combined global and command options
 * @param context - Command context with logger
 */
export async function runMigrateReset(
  options: ResolvedMigrateResetOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const startTime = Date.now();

  logger.header("Migrate Reset");

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

    const appliedMigrations = await getAppliedMigrations(
      adapter as unknown as DrizzleAdapter,
      dialect
    );

    if (appliedMigrations.length === 0) {
      logger.newline();
      logger.info("Nothing to reset. No migrations have been applied.");
      return;
    }

    logger.keyValue(
      "Applied migrations",
      formatCount(appliedMigrations.length, "migration")
    );

    const cwd = options.cwd ?? process.cwd();
    const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);

    logger.debug(`Scanning migrations in ${migrationsDir}...`);

    const migrationFiles = await discoverMigrations(migrationsDir, logger);

    const validationErrors = validateDownScripts(
      appliedMigrations,
      migrationFiles
    );

    if (validationErrors.length > 0) {
      logger.newline();
      logger.error("Cannot reset: Some migrations are missing DOWN sections.");
      logger.newline();
      for (const error of validationErrors) {
        logger.error(`  ${error}`);
      }
      logger.newline();
      logger.info(
        "Please add DOWN sections to the migration files listed above."
      );
      logger.info("Format: Add '-- DOWN' followed by reversal SQL statements.");
      process.exit(1);
    }

    logger.newline();
    logger.warn("This command will ROLL BACK ALL MIGRATIONS.");
    logger.warn("All schema changes will be reverted and data may be lost.");

    const batches = groupByBatch(appliedMigrations);
    const batchNumbers = Object.keys(batches)
      .map(Number)
      .sort((a, b) => b - a);

    logger.newline();
    logger.info(`Will roll back ${batchNumbers.length} batch(es):`);
    for (const batchNum of batchNumbers) {
      const batchMigrations = batches[batchNum];
      logger.info(
        `  Batch ${batchNum}: ${formatCount(batchMigrations.length, "migration")}`
      );
    }

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

    logger.newline();
    logger.info("Rolling back migrations...");

    const result = await executeRollbacks(
      appliedMigrations,
      migrationFiles,
      adapter as unknown as DrizzleAdapter,
      dialect,
      context
    );

    displayResults(result, context);

    const totalDuration = Date.now() - startTime;
    logger.newline();
    logger.divider();

    if (result.rolledBack === 0) {
      logger.info("No migrations were rolled back.");
    } else {
      logger.success(
        `Reset complete: ${formatCount(result.rolledBack, "migration")} rolled back in ${formatDuration(totalDuration)}`
      );
    }
  } finally {
    await adapter.disconnect();
  }
}


async function discoverMigrations(
  migrationsDir: string,
  logger: CommandContext["logger"]
): Promise<Map<string, ParsedMigration>> {
  const migrations = new Map<string, ParsedMigration>();
  let files: string[];

  try {
    files = await readdir(migrationsDir);
  } catch {
    return migrations;
  }

  const sqlFiles = files.filter(f => f.endsWith(".sql"));

  for (const file of sqlFiles) {
    const filePath = resolve(migrationsDir, file);
    const name = basename(file, ".sql");

    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = parseMigrationFile(name, filePath, content);
      migrations.set(name, parsed);
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
  content: string
): ParsedMigration {
  const checksum = createHash("sha256").update(content).digest("hex");

  const collectionsMatch = content.match(/^-- Collections?:\s*(.+)$/m);
  const collections = collectionsMatch
    ? collectionsMatch[1].split(",").map(c => c.trim())
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
    collections,
    timestamp,
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
        !line.trim().startsWith("-- Collections:")
    );
  }

  return {
    upSql: upLines.join("\n").trim(),
    downSql: downLines.join("\n").trim(),
  };
}

function validateDownScripts(
  appliedMigrations: MigrationRecord[],
  migrationFiles: Map<string, ParsedMigration>
): string[] {
  const errors: string[] = [];

  for (const record of appliedMigrations) {
    const file = migrationFiles.get(record.name);

    if (!file) {
      errors.push(
        `Migration '${record.name}' - file not found in migrations directory`
      );
      continue;
    }

    if (!file.downSql || file.downSql.trim() === "") {
      errors.push(`Migration '${record.name}' - missing or empty DOWN section`);
    }
  }

  return errors;
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
      ? "SELECT * FROM `nextly_migrations` ORDER BY `batch` DESC, `executed_at` DESC"
      : 'SELECT * FROM "nextly_migrations" ORDER BY "batch" DESC, "executed_at" DESC';

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

function groupByBatch(
  migrations: MigrationRecord[]
): Record<number, MigrationRecord[]> {
  const batches: Record<number, MigrationRecord[]> = {};

  for (const migration of migrations) {
    if (!batches[migration.batch]) {
      batches[migration.batch] = [];
    }
    batches[migration.batch].push(migration);
  }

  return batches;
}

async function executeRollbacks(
  appliedMigrations: MigrationRecord[],
  migrationFiles: Map<string, ParsedMigration>,
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  context: CommandContext
): Promise<MigrateResetResult> {
  const { logger } = context;
  const results: RollbackResult[] = [];
  const startTime = Date.now();

  const batches = groupByBatch(appliedMigrations);
  const batchNumbers = Object.keys(batches)
    .map(Number)
    .sort((a, b) => b - a);

  let totalRolledBack = 0;

  for (const batchNum of batchNumbers) {
    const batchMigrations = batches[batchNum];

    logger.newline();
    logger.info(
      `Rolling back batch ${batchNum} (${formatCount(batchMigrations.length, "migration")})...`
    );

    // Process migrations in reverse execution order within the batch.
    // They're already sorted DESC from the query.
    for (const record of batchMigrations) {
      const migrationStart = Date.now();
      const file = migrationFiles.get(record.name)!;

      logger.info(`  Rolling back: ${record.name}`);

      try {
        await executeRollbackInTransaction(adapter, dialect, file, record);

        const duration = Date.now() - migrationStart;
        logger.success(`    Rolled back in ${formatDuration(duration)}`);

        results.push({
          name: record.name,
          batch: batchNum,
          success: true,
          durationMs: duration,
        });
        totalRolledBack++;
      } catch (error) {
        const duration = Date.now() - migrationStart;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        logger.error(`    Failed: ${errorMessage}`);

        results.push({
          name: record.name,
          batch: batchNum,
          success: false,
          durationMs: duration,
          error: errorMessage,
        });

        return {
          rolledBack: totalRolledBack,
          batchesProcessed: batchNumbers.indexOf(batchNum) + 1,
          migrations: results,
          durationMs: Date.now() - startTime,
        };
      }
    }
  }

  return {
    rolledBack: totalRolledBack,
    batchesProcessed: batchNumbers.length,
    migrations: results,
    durationMs: Date.now() - startTime,
  };
}

async function executeRollbackInTransaction(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  migration: ParsedMigration,
  record: MigrationRecord
): Promise<void> {
  await executeTransaction(adapter, dialect, async () => {
    const statements = splitSqlStatements(migration.downSql);

    for (const statement of statements) {
      if (statement.trim()) {
        await adapter.executeQuery(statement);
      }
    }

    await deleteMigrationRecord(adapter, dialect, record.name);
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

async function deleteMigrationRecord(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  migrationName: string
): Promise<void> {
  const escapedName = migrationName.replace(/'/g, "''");
  const query =
    dialect === "mysql"
      ? `DELETE FROM \`nextly_migrations\` WHERE \`name\` = '${escapedName}'`
      : `DELETE FROM "nextly_migrations" WHERE "name" = '${escapedName}'`;

  await adapter.executeQuery(query);
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const prevChar = sql[i - 1];

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
      if (statement && !statement.startsWith("--")) {
        statements.push(statement);
      }
      current = "";
    } else {
      current += char;
    }
  }

  const finalStatement = current.trim();
  if (finalStatement && !finalStatement.startsWith("--")) {
    statements.push(finalStatement);
  }

  return statements;
}

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

function displayResults(
  result: MigrateResetResult,
  context: CommandContext
): void {
  const { logger } = context;

  logger.newline();

  if (result.rolledBack === 0) {
    logger.info("No migrations were rolled back.");
    return;
  }

  logger.info("Reset Summary:");
  logger.keyValue("Rolled back", formatCount(result.rolledBack, "migration"));
  logger.keyValue("Batches processed", result.batchesProcessed);

  if (result.migrations.length > 0) {
    logger.newline();
    const headers = ["Migration", "Batch", "Status", "Duration"];
    const rows: (string | number | boolean)[][] = result.migrations.map(m => [
      m.name,
      m.batch,
      m.success ? "Rolled back" : "Failed",
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
 * Register the migrate:reset command with the program
 *
 * @param program - Commander program instance
 */
export function registerMigrateResetCommand(program: Command): void {
  program
    .command("migrate:reset")
    .description("Roll back all migrations")
    .option("-f, --force", "Skip confirmation prompt", false)
    .action(async (cmdOptions: MigrateResetCommandOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const context = createContext(globalOpts);

      const resolvedOptions: ResolvedMigrateResetOptions = {
        ...cmdOptions,
        config: globalOpts.config,
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
        cwd: globalOpts.cwd,
      };

      try {
        await runMigrateReset(resolvedOptions, context);
      } catch (error) {
        context.logger.error(
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
