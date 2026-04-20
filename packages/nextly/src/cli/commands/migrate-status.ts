/**
 * Migrate Status Command
 *
 * Implements the `nextly migrate:status` command for displaying migration status.
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
 * Combined status of a migration (file + database state)
 */
interface MigrationStatus {
  name: string;
  status: "applied" | "pending" | "failed";
  batch: number | null;
  appliedAt: Date | null;
  errorMessage?: string;
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

    const summary = {
      applied: migrationStatuses.filter(m => m.status === "applied").length,
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
      slug: String(row.slug),
      name: String(row.name),
      migrationStatus: String(row.migration_status),
      lastMigrationId: row.last_migration_id
        ? String(row.last_migration_id)
        : null,
    }));
  } catch {
    return [];
  }
}

function buildMigrationStatuses(
  files: ParsedMigration[],
  applied: MigrationRecord[]
): MigrationStatus[] {
  const appliedMap = new Map(applied.map(m => [m.name, m]));
  const statuses: MigrationStatus[] = [];

  for (const file of files) {
    const record = appliedMap.get(file.name);

    if (record) {
      const checksumMismatch = record.checksum !== file.checksum;

      statuses.push({
        name: file.name,
        status: record.status === "failed" ? "failed" : "applied",
        batch: record.batch,
        appliedAt: record.executedAt,
        errorMessage: record.errorMessage,
        checksumMismatch,
      });

      appliedMap.delete(file.name);
    } else {
      statuses.push({
        name: file.name,
        status: "pending",
        batch: null,
        appliedAt: null,
        checksumMismatch: false,
      });
    }
  }

  for (const [name, record] of appliedMap) {
    statuses.push({
      name: `${name} (missing file)`,
      status: record.status === "failed" ? "failed" : "applied",
      batch: record.batch,
      appliedAt: record.executedAt,
      errorMessage: record.errorMessage,
      checksumMismatch: false,
    });
  }

  return statuses.sort((a, b) => a.name.localeCompare(b.name));
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

    const headers = ["Migration", "Status", "Batch", "Applied At"];
    const rows: (string | number | boolean)[][] = migrations.map(m => {
      let statusDisplay: string;
      switch (m.status) {
        case "applied":
          statusDisplay = m.checksumMismatch ? "Applied (modified)" : "Applied";
          break;
        case "pending":
          statusDisplay = "Pending";
          break;
        case "failed":
          statusDisplay = "Failed";
          break;
      }

      return [
        m.name,
        statusDisplay,
        m.batch ?? "-",
        m.appliedAt ? formatDate(m.appliedAt) : "-",
      ];
    });

    logger.table(headers, rows);

    if (verbose) {
      const failedMigrations = migrations.filter(
        m => m.status === "failed" && m.errorMessage
      );
      if (failedMigrations.length > 0) {
        logger.newline();
        logger.error("Error Details:");
        for (const m of failedMigrations) {
          logger.error(`  ${m.name}: ${m.errorMessage}`);
        }
      }

      const modifiedMigrations = migrations.filter(m => m.checksumMismatch);
      if (modifiedMigrations.length > 0) {
        logger.newline();
        logger.warn("Modified Migrations (checksum mismatch):");
        for (const m of modifiedMigrations) {
          logger.warn(`  ${m.name}`);
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
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
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
