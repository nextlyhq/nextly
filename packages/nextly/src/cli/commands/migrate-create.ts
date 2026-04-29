/**
 * Migrate Create Command (F11 PR 3 rewrite)
 *
 * Implements `nextly migrate:create` per the F11 spec §6.1.
 *
 * The command reads `nextly.config.ts`, loads the latest snapshot from
 * `migrations/meta/`, computes the diff via the F4 Option E diff engine,
 * prompts the operator about possible renames via clack, generates the
 * SQL via the shared `pipeline/sql-templates/` module, and writes a
 * paired `migrations/<ts>_<slug>.sql` + `migrations/meta/<ts>_<slug>.snapshot.json`.
 *
 * Does NOT connect to a database — the diff is between the config and
 * the latest snapshot, both file-based.
 *
 * Exit codes (per spec):
 *   0 - File written.
 *   1 - Error (bad config, snapshot unreadable, prompt cancelled).
 *   2 - No changes detected (config matches latest snapshot).
 *
 * @module cli/commands/migrate-create
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # Generate migration from pending schema changes
 * nextly migrate:create --name=add_excerpt
 *
 * # Generate without prompts (CI). Renames default to "decline" (DROP+ADD).
 * nextly migrate:create --name=add_excerpt --non-interactive
 *
 * # Same, but accept all renames automatically. ADVANCED — only when you've
 * # already verified the diff is rename-only.
 * nextly migrate:create --name=add_excerpt --non-interactive --accept-renames
 *
 * # Create blank migration for custom SQL
 * nextly migrate:create --name=custom_seed --blank
 * ```
 *
 * **Runtime restriction (F11):** This module is CLI-only. Do NOT import
 * it from runtime code (init/, route-handler/, dispatcher/, api/) — the
 * deployed Next.js app must not perform schema migrations at boot.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Command } from "commander";

import {
  formatBlankFile,
  formatTimestamp,
  slugify,
} from "../../domains/schema/migrate-create/format-file.js";
import {
  generateMigration,
  type MinimalConfigEntity,
} from "../../domains/schema/migrate-create/generate.js";
import type { SupportedDialect } from "../../domains/schema/services/schema-generator.js";
import { createContext, type CommandContext } from "../program.js";
import {
  getDialectDisplayName,
  validateDatabaseEnv,
} from "../utils/adapter.js";
import { loadConfig, type LoadConfigResult } from "../utils/config-loader.js";
import { formatDuration } from "../utils/logger.js";

// ============================================================================
// Types
// ============================================================================

export interface MigrateCreateCommandOptions {
  /**
   * Migration name (required for non-blank). Slug-cased; the timestamp
   * prefix is added automatically.
   * @example "add_excerpt"
   */
  name?: string;

  /**
   * Create an empty migration file for custom SQL.
   * @default false
   */
  blank?: boolean;

  /**
   * Skip interactive prompts. Used in CI / non-TTY environments. With
   * this flag set and `--accept-renames` not set, all rename candidates
   * are declined (DROP + ADD with possible data loss).
   * @default detected from process.stdout.isTTY
   */
  nonInteractive?: boolean;

  /**
   * Only meaningful with `--non-interactive`. Auto-accept all rename
   * candidates. ADVANCED — verify the diff first via `migrate:create`
   * in interactive mode before flipping this on for CI.
   * @default false
   */
  acceptRenames?: boolean;
}

interface ResolvedMigrateCreateOptions extends MigrateCreateCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

// ============================================================================
// Command Implementation
// ============================================================================

export async function runMigrateCreate(
  nameArg: string | undefined,
  options: ResolvedMigrateCreateOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const startTime = Date.now();

  logger.header("Migrate Create");

  // F11 PR 3: dialect comes from DATABASE_URL (no DB connection needed —
  // we just need to know which SQL flavor to emit). validateDatabaseEnv
  // handles the parsing without opening a connection.
  const dbValidation = validateDatabaseEnv();
  if (!dbValidation.valid) {
    for (const error of dbValidation.errors) {
      logger.error(error);
    }
    logger.newline();
    logger.info(
      "Set DATABASE_URL and optionally DB_DIALECT environment variables. " +
        "(migrate:create does not connect to the DB but needs the dialect to emit the right SQL.)"
    );
    process.exit(1);
  }
  const dialect = dbValidation.dialect!;

  // Resolve the migration name. --name flag takes precedence over the
  // positional argument. Required for non-blank invocations.
  const name = options.name ?? nameArg;
  if (!options.blank && !name) {
    logger.error(
      "--name is required for non-blank migrations. " +
        "Use --blank to create an empty migration without a name, or pass --name=<slug>."
    );
    process.exit(1);
  }

  // Load config.
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

  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);

  logger.keyValue("Dialect", getDialectDisplayName(dialect));

  // --blank: write a stub file and exit. No diff, no prompts.
  if (options.blank) {
    await runBlankPath(
      name ?? "custom_migration",
      dialect,
      migrationsDir,
      context,
      startTime
    );
    return;
  }

  // F11 PR 3: detect non-interactive mode from the explicit flag OR from
  // a non-TTY stdout. CI environments typically have isTTY=false; the
  // safer default in that case is to decline renames (treat as DROP+ADD)
  // unless --accept-renames is explicit.
  const nonInteractive =
    options.nonInteractive === true || !process.stdout.isTTY;

  // Convert config entries to the minimal shape the orchestrator needs.
  const collections = toMinimalEntities(configResult.config.collections, "dc_");
  const singles = toMinimalEntities(
    configResult.config.singles ?? [],
    "single_"
  );
  const components = toMinimalEntities(
    configResult.config.components ?? [],
    "comp_"
  );

  if (
    collections.length === 0 &&
    singles.length === 0 &&
    components.length === 0
  ) {
    logger.warn("No collections, singles, or components defined in config.");
    logger.info("Use --blank to create an empty migration for custom SQL.");
    return;
  }

  logger.newline();
  logger.info("Comparing config to latest snapshot...");

  let result;
  try {
    result = await generateMigration({
      name: name!,
      dialect,
      migrationsDir,
      collections,
      singles,
      components,
      nonInteractive,
      autoAcceptRenames: options.acceptRenames === true,
    });
  } catch (error) {
    logger.error(
      `Failed to generate migration: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  if (result === null) {
    logger.newline();
    logger.info(
      "No changes detected. Your config matches the latest snapshot."
    );
    // Per spec: exit code 2 distinguishes "happy no-op" from "actual
    // error" so CI scripts can react differently.
    process.exit(2);
  }

  const duration = Date.now() - startTime;
  logger.newline();
  logger.success(`Created migration → ${result.sqlPath}`);
  logger.success(`Snapshot → ${result.snapshotPath}`);
  logger.keyValue("Operations", result.operationCount);
  if (result.renamesAccepted > 0) {
    logger.keyValue("Renames accepted", result.renamesAccepted);
  }
  logger.newline();
  logger.divider();
  logger.success(`Migration created in ${formatDuration(duration)}`);
  logger.newline();
  logger.info("Next steps:");
  logger.item("Review the generated .sql file", 1);
  logger.item("Commit it to git alongside your nextly.config.ts changes", 1);
  logger.item("Run `nextly migrate` to apply it", 1);
}

// ============================================================================
// --blank path
// ============================================================================

async function runBlankPath(
  name: string,
  dialect: SupportedDialect,
  migrationsDir: string,
  context: CommandContext,
  startTime: number
): Promise<void> {
  const { logger } = context;

  const now = new Date();
  const baseName = `${formatTimestamp(now)}_${slugify(name)}`;
  const sqlPath = resolve(migrationsDir, `${baseName}.sql`);

  await mkdir(migrationsDir, { recursive: true });
  const content = formatBlankFile(baseName, dialect, now);
  await writeFile(sqlPath, content, "utf-8");

  // F11 PR 3: blank migrations don't get a paired snapshot file. The
  // operator-authored SQL has no schema diff to capture; the next
  // `migrate:create` will diff against whatever the latest non-blank
  // snapshot is. (If they later want migrate:check to verify a hash for
  // their hand-written file, they can manually edit the snapshot — but
  // that's an advanced workflow and out of v1 scope.)

  const duration = Date.now() - startTime;
  logger.newline();
  logger.success(`Created blank migration → ${sqlPath}`);
  logger.newline();
  logger.divider();
  logger.success(`Blank migration created in ${formatDuration(duration)}`);
  logger.newline();
  logger.info("Edit the migration file to add your custom SQL.");
}

// ============================================================================
// Config -> MinimalConfigEntity adapter
// ============================================================================

/**
 * Convert config entries (collections / singles / components) to the
 * minimal shape generateMigration needs. The table name is derived from
 * the slug + a per-entity prefix (matching runtime-schema-generator's
 * naming convention).
 *
 * F11 PR 3: typed as `unknown[]` + structural narrowing because the real
 * CollectionConfig / SingleConfig / ComponentConfig types have many more
 * attributes that we don't need here (and listing them all just to please
 * the type checker would be brittle as those configs evolve).
 */
function toMinimalEntities(
  entities: unknown[],
  tableNamePrefix: "dc_" | "single_" | "comp_"
): MinimalConfigEntity[] {
  return entities.map(raw => {
    const e = raw as {
      slug: string;
      fields?: { name: string; type: string; required?: boolean }[];
      dbName?: string;
    };
    const slug = e.slug;
    const fields = (e.fields ?? []).map(f => ({
      name: f.name,
      type: f.type,
      required: f.required,
    }));
    return {
      slug,
      tableName: e.dbName ?? `${tableNamePrefix}${slug.replace(/-/g, "_")}`,
      fields,
    };
  });
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerMigrateCreateCommand(program: Command): void {
  program
    .command("migrate:create")
    .description(
      "Create a new migration file from schema changes or for custom SQL"
    )
    .argument("[name]", "Migration name (slug-cased, e.g., add_excerpt)")
    .option("--name <name>", "Migration name (alternate to positional arg)")
    .option("--blank", "Create an empty migration file for custom SQL", false)
    .option(
      "--non-interactive",
      "Skip interactive prompts (auto-detected from non-TTY)",
      false
    )
    .option(
      "--accept-renames",
      "ADVANCED: auto-accept all rename candidates in non-interactive mode",
      false
    )
    .action(
      async (
        positionalName: string | undefined,
        cmdOptions: MigrateCreateCommandOptions,
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals();
        const context = createContext(globalOpts);

        const resolvedOptions: ResolvedMigrateCreateOptions = {
          ...cmdOptions,
          config: globalOpts.config,
          verbose: globalOpts.verbose,
          quiet: globalOpts.quiet,
          cwd: globalOpts.cwd,
        };

        try {
          await runMigrateCreate(positionalName, resolvedOptions, context);
        } catch (error) {
          context.logger.error(
            error instanceof Error ? error.message : String(error)
          );
          process.exit(1);
        }
      }
    );
}
