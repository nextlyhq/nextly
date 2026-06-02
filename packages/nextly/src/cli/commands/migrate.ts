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

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { assertNoLegacyBookkeeping } from "../../domains/schema/events/legacy-detection";
import { getSchemaEventsDdl } from "../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { reconcileCore } from "../../domains/schema/migrate/core-reconcile";
import { reconcileFile } from "../../domains/schema/migrate/drift-reconcile";
import {
  EMPTY_SNAPSHOT,
  parseSnapshotFile,
} from "../../domains/schema/migrate-create/snapshot-io";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import type { SupportedDialect } from "../../domains/schema/services/schema-generator";
import { CORE_TABLE_PREFIXES } from "../../schemas";
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
    const db = (adapter as unknown as DrizzleAdapter).getDrizzle();
    const cwd = options.cwd ?? process.cwd();
    const appMigrationsDir = resolve(cwd, configResult.config.db.migrationsDir);

    // Phase 0 — legacy bookkeeping gate (spec §4.6). Aborts with
    // NEXTLY_LEGACY_BOOKKEEPING_DETECTED if the pre-consolidation tables exist.
    await assertNoLegacyBookkeeping(
      adapter as unknown as { tableExists: (n: string) => Promise<boolean> }
    );

    if (options.dryRun) {
      const pending = await findPendingFiles(
        adapter,
        db,
        dialect,
        appMigrationsDir,
        logger
      );
      logger.newline();
      logger.keyValue("Pending", formatCount(pending.length, "migration"));
      for (const m of pending) logger.info(`  • ${m.name}.sql`);
      logger.success("Dry run complete (no changes made).");
      return;
    }

    // Operator-set override; never in CI config (spec §4.6.1).
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    const allowCoreDestructive = process.env.NEXTLY_ALLOW_CORE_DESTRUCTIVE === "1"; // prettier-ignore

    const dz = adapter as unknown as DrizzleAdapter & {
      tableExists: (n: string) => Promise<boolean>;
    };

    await withMigrateLock(db, dialect, async () => {
      // Phase 1 — core schema reconciliation (production-strict). The ledger
      // table (`nextly_schema_events`) is bootstrapped out-of-band by
      // `ensureLedger` — AFTER applyCore (so pushSchema doesn't see it as an
      // extraneous table) and BEFORE the event is recorded. Idempotent: the
      // DDL runs only when the table is absent (MySQL's CREATE INDEX lacks
      // IF NOT EXISTS, so it must not re-run).
      logger.info("Phase 1: reconciling core schema...");
      await reconcileCore({
        db,
        dialect,
        logger: { info: m => logger.debug(m), warn: m => logger.warn(m) },
        allowDestructive: allowCoreDestructive,
        ensureLedger: async () => {
          if (!(await dz.tableExists("nextly_schema_events"))) {
            for (const stmt of getSchemaEventsDdl(dialect)) {
              await dz.executeQuery(stmt);
            }
          }
        },
      });

      // Phase 2 — user migration files (drift reconciliation, §4.7).
      logger.info("Phase 2: applying user migrations...");
      const applied = await runFileMigrations({
        adapter,
        db,
        dialect,
        migrationsDir: appMigrationsDir,
        step: options.step,
        logger,
      });

      logger.newline();
      logger.success(
        applied === 0
          ? "Nothing to migrate. Database is up to date."
          : `${formatCount(applied, "migration")} applied.`
      );
    });

    const duration = Date.now() - startTime;
    logger.divider();
    logger.success(`migrate completed in ${formatDuration(duration)}`);
  } finally {
    await adapter.disconnect();
  }
}

/**
 * Discover migration files with no applied `file_apply` event yet. On a fresh
 * DB the ledger table does not exist yet (only the real `migrate` bootstraps
 * it in Phase 1); dry-run must stay read-only, so if the ledger is absent we
 * report every discovered file as pending rather than querying (and throwing).
 */
export async function findPendingFiles(
  adapter: CLIDatabaseAdapter,
  db: unknown,
  dialect: SupportedDialect,
  migrationsDir: string,
  logger: CommandContext["logger"]
): Promise<ParsedMigration[]> {
  const all = await discoverMigrations(migrationsDir, logger, "app");
  const hasLedger = await (
    adapter as unknown as { tableExists: (n: string) => Promise<boolean> }
  ).tableExists("nextly_schema_events");
  if (!hasLedger) return all;

  const repo = new SchemaEventsRepository(db, dialect);
  const pending: ParsedMigration[] = [];
  for (const m of all) {
    if (!(await repo.isFileApplied(`${m.name}.sql`))) pending.push(m);
  }
  return pending;
}

async function safeListTables(adapter: CLIDatabaseAdapter): Promise<string[]> {
  try {
    return await (
      adapter as unknown as { listTables: () => Promise<string[]> }
    ).listTables();
  } catch {
    return [];
  }
}

/** Load a migration's paired target snapshot, or null if absent. */
async function loadTargetSnapshot(
  metaDir: string,
  name: string
): Promise<NextlySchemaSnapshot | null> {
  const file = `${name}.snapshot.json`;
  try {
    const content = await readFile(resolve(metaDir, file), "utf-8");
    return parseSnapshotFile(content, file).snapshot;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Phase 2 — apply pending user migration files via §4.7 drift reconciliation.
 * Walks files in lex order, carrying each file's target snapshot forward as the
 * next file's baseline. Returns the count actually applied.
 */
async function runFileMigrations(args: {
  adapter: CLIDatabaseAdapter;
  db: unknown;
  dialect: SupportedDialect;
  migrationsDir: string;
  step?: number;
  logger: CommandContext["logger"];
}): Promise<number> {
  const { adapter, db, dialect, migrationsDir, logger } = args;
  const all = await discoverMigrations(migrationsDir, logger, "app");
  if (all.length === 0) {
    logger.debug("No user migration files found.");
    return 0;
  }

  const repo = new SchemaEventsRepository(db, dialect);
  const metaDir = resolve(migrationsDir, "meta");

  // Phase 2 scope = managed USER tables (dc_/single_/comp_). Core is Phase 1.
  const liveTables = await safeListTables(adapter);
  const managed = liveTables.filter(t =>
    CORE_TABLE_PREFIXES.some(p => t.startsWith(p))
  );

  const dz = adapter as unknown as DrizzleAdapter;
  const executeSql = async (sqlText: string): Promise<number> => {
    const statements = splitSqlStatements(sqlText);
    await executeTransaction(dz, dialect, async () => {
      for (const statement of statements) {
        await dz.executeQuery(statement);
      }
    });
    return statements.length;
  };

  let before: NextlySchemaSnapshot = EMPTY_SNAPSHOT;
  let applied = 0;
  let remaining =
    args.step && args.step > 0 ? args.step : Number.POSITIVE_INFINITY;

  for (const m of all) {
    const filename = `${m.name}.sql`;
    const target = await loadTargetSnapshot(metaDir, m.name);

    if (await repo.isFileApplied(filename)) {
      if (target) before = target; // advance baseline past applied files
      continue;
    }
    if (remaining <= 0) break;

    if (!target) {
      // No paired snapshot (hand-written migration): run verbatim + record.
      logger.warn(
        `No snapshot for ${filename}; applying verbatim without drift checks.`
      );
      const id = await repo.recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename,
        sha256: m.checksum,
      });
      try {
        const n = await executeSql(m.upSql);
        await repo.markApplied(id, { statementsExecuted: n });
      } catch (err) {
        await repo.markFailed(id, {
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      applied++;
      remaining--;
      logger.success(`Applied ${filename}`);
      continue;
    }

    const live = await introspectLiveSnapshot(db, dialect, managed);
    await reconcileFile({
      file: { filename, sql: m.upSql, path: m.filePath, sha256: m.checksum },
      before,
      target,
      live,
      repo,
      executeSql,
    });
    before = target;
    applied++;
    remaining--;
    logger.success(`Applied ${filename}`);
  }

  return applied;
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
