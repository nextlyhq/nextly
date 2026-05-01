/**
 * Migrate Check Command (F11 PR 4)
 *
 * Implements `nextly migrate:check` per the F11 spec §6.4.
 *
 * CI-friendly integrity verification for migration files. Does NOT
 * connect to a database. Five checks run in order; first failure
 * exits non-zero with a specific error code:
 *
 *   1. CHECKSUM_MISMATCH  - A `.sql` file's content differs from the
 *      hash recorded in its paired `.snapshot.json` (someone edited
 *      the file after `migrate:create` generated it).
 *   2. MISSING_SNAPSHOT   - A `.sql` file has no paired `.snapshot.json`
 *      (operator deleted the snapshot or the file was added by hand).
 *   3. INVALID_SNAPSHOT   - A `.snapshot.json` file is malformed
 *      (corrupted JSON, hand-edited, or written by a future nextly
 *      version with an incompatible envelope).
 *   4. MISSING_MIGRATION  - A `.snapshot.json` file has no paired `.sql`
 *      (someone deleted the SQL but kept the snapshot).
 *   5. SCHEMA_DRIFT       - `nextly.config.ts` has uncommitted changes
 *      relative to the latest snapshot (operator forgot to run
 *      `migrate:create` after editing config).
 *
 * Exit codes:
 *   0 - All checks passed.
 *   1 - Any check failed; see printed reason.
 *
 * @module cli/commands/migrate-check
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # CI integrity gate
 * nextly migrate:check
 * ```
 *
 * **Runtime restriction (F11):** This module is CLI-only. Do NOT import
 * it from runtime code (init/, route-handler/, dispatcher/, api/,
 * actions/, direct-api/, routeHandler.ts, next.ts). The deployed
 * Next.js app must not perform schema migrations at boot. Enforced by
 * ESLint (`no-restricted-imports`); see
 * docs/guides/production-migrations.mdx.
 */

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Command } from "commander";

import {
  buildDesiredSnapshotFromConfig,
  type MinimalConfigEntity,
} from "../../domains/schema/migrate-create/generate";
import {
  EMPTY_SNAPSHOT,
  loadLatestSnapshot,
  SnapshotFileError,
  verifyMigrationHash,
} from "../../domains/schema/migrate-create/snapshot-io";
import { diffSnapshots } from "../../domains/schema/pipeline/diff/diff";
import type {
  NextlySchemaSnapshot,
  Operation,
} from "../../domains/schema/pipeline/diff/types";
import type { SupportedDialect } from "../../domains/schema/services/schema-generator";
import { createContext, type CommandContext } from "../program";
import { validateDatabaseEnv } from "../utils/adapter";
import { loadConfig, type LoadConfigResult } from "../utils/config-loader";

// ============================================================================
// Types
// ============================================================================

// F11 PR 4: no command-specific options today. Global options
// (--config, --cwd, --verbose, --quiet) are inherited from the program.
// `Record<string, never>` is the idiomatic "intentionally empty" shape;
// avoids the `_placeholder?: never` workaround the first draft used.
export type MigrateCheckCommandOptions = Record<string, never>;

interface ResolvedMigrateCheckOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

// ============================================================================
// Command Implementation
// ============================================================================

export async function runMigrateCheck(
  options: ResolvedMigrateCheckOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  logger.header("Migrate Check");

  // F11 PR 4: dialect comes from DATABASE_URL but we don't connect —
  // we just need to know which SQL flavor the diff engine should target
  // when computing the desired snapshot. Without this, drift-check
  // results would be inconsistent across dialects.
  const dbValidation = validateDatabaseEnv();
  if (!dbValidation.valid) {
    for (const error of dbValidation.errors) {
      logger.error(error);
    }
    logger.newline();
    logger.info(
      "Set DATABASE_URL and optionally DB_DIALECT environment variables. " +
        "(migrate:check does not connect to the DB but needs the dialect to compare snapshots correctly.)"
    );
    process.exit(1);
  }
  const dialect = dbValidation.dialect!;

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

  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);

  const desiredSnapshot = buildDesiredSnapshotFromConfig(
    toMinimalEntities(configResult.config.collections, "dc_"),
    toMinimalEntities(configResult.config.singles ?? [], "single_"),
    toMinimalEntities(configResult.config.components ?? [], "comp_"),
    dialect
  );

  await runChecks({
    migrationsDir,
    desiredSnapshot,
    logger,
  });
}

/**
 * F11 PR 4: pure-input check pipeline. Extracted so unit tests can call
 * it with a tmp `migrationsDir` + a hand-built desired snapshot, without
 * spinning up the loadConfig + validateDatabaseEnv plumbing.
 *
 * The CLI entry point (`runMigrateCheck`) loads config + dialect, builds
 * the desired snapshot, then delegates here. All `process.exit(1)` calls
 * happen inside this function — callers don't need to handle exit codes.
 */
export async function runChecks(args: {
  migrationsDir: string;
  desiredSnapshot: NextlySchemaSnapshot;
  logger: CommandContext["logger"];
}): Promise<void> {
  const { migrationsDir, desiredSnapshot, logger } = args;
  const metaDir = resolve(migrationsDir, "meta");

  let sqlFiles: string[];
  try {
    sqlFiles = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"));
  } catch {
    sqlFiles = [];
  }

  let snapshotFiles: string[];
  try {
    snapshotFiles = (await readdir(metaDir)).filter(f =>
      f.endsWith(".snapshot.json")
    );
  } catch {
    snapshotFiles = [];
  }

  logger.debug(
    `Inspecting ${sqlFiles.length} .sql file(s) and ${snapshotFiles.length} snapshot file(s).`
  );

  // Check 1+2: hash + missing snapshot per .sql file.
  for (const sqlName of sqlFiles) {
    const sqlContent = await readFile(resolve(migrationsDir, sqlName), "utf-8");
    let result;
    try {
      result = await verifyMigrationHash(metaDir, sqlName, sqlContent);
    } catch (err) {
      // F11 PR 4 review fix #3: distinct INVALID_SNAPSHOT code so the
      // operator can tell "snapshot file is corrupt / version-mismatched"
      // (fix = regenerate or upgrade nextly) apart from "snapshot is
      // missing entirely" (fix = git checkout).
      if (err instanceof SnapshotFileError) {
        logger.error(`INVALID_SNAPSHOT: ${err.message}`);
        process.exit(1);
        return;
      }
      throw err;
    }
    if (!result.ok && result.expected === undefined) {
      logger.error(
        `MISSING_SNAPSHOT: ${sqlName} has no paired snapshot file in ${metaDir}. ` +
          "If this migration was generated before F11 PR 3 (snapshot-based migrate:create), " +
          "you can either delete it or re-create it with `nextly migrate:create --blank` and copy the SQL across."
      );
      process.exit(1);
      return;
    }
    if (!result.ok) {
      logger.error(`CHECKSUM_MISMATCH: ${sqlName}`);
      logger.error(`  Expected SHA-256: ${result.expected}`);
      logger.error(`  Actual SHA-256:   ${result.actual}`);
      logger.error(
        "  The migration file was edited after generation. Either revert the edit, " +
          "or delete this file and re-generate via `nextly migrate:create --name=<name>`."
      );
      process.exit(1);
      return;
    }
  }

  // Check 3: missing migration per snapshot.
  const sqlBaseNames = new Set(sqlFiles.map(f => f.replace(/\.sql$/, "")));
  for (const snapName of snapshotFiles) {
    const baseName = snapName.replace(/\.snapshot\.json$/, "");
    if (!sqlBaseNames.has(baseName)) {
      logger.error(
        `MISSING_MIGRATION: snapshot ${snapName} exists but ${baseName}.sql does not. ` +
          "Restore the .sql file from version control, or delete the orphan snapshot."
      );
      process.exit(1);
      return;
    }
  }

  // Check 4: schema drift (config vs latest snapshot).
  let previousSnapshot: NextlySchemaSnapshot;
  try {
    const latest = await loadLatestSnapshot(metaDir);
    previousSnapshot = latest?.data.snapshot ?? EMPTY_SNAPSHOT;
  } catch (err) {
    // F11 PR 4 review fix #3: see INVALID_SNAPSHOT comment above.
    if (err instanceof SnapshotFileError) {
      logger.error(`INVALID_SNAPSHOT: ${err.message}`);
      process.exit(1);
      return;
    }
    throw err;
  }

  const ops = diffSnapshots(previousSnapshot, desiredSnapshot);
  if (ops.length > 0) {
    logger.error(`SCHEMA_DRIFT: ${ops.length} pending change(s) detected.`);
    // Cap the listed ops at 10 to keep CI logs readable on large drifts.
    for (const op of ops.slice(0, 10)) {
      logger.error(`  + ${describeOp(op)}`);
    }
    if (ops.length > 10) {
      logger.error(`  ... and ${ops.length - 10} more`);
    }
    logger.error(
      "Run `nextly migrate:create --name=<name>` and commit the result."
    );
    process.exit(1);
    return;
  }

  logger.success(
    `migrate:check OK — ${sqlFiles.length} migration file(s), no drift.`
  );
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Render an Operation as a short human-readable summary for the
 * SCHEMA_DRIFT error output. Mirrors the apply pipeline's logging
 * style for consistency.
 */
function describeOp(op: Operation): string {
  switch (op.type) {
    case "add_table":
      return `add_table ${op.table.name}`;
    case "drop_table":
      return `drop_table ${op.tableName}`;
    case "rename_table":
      return `rename_table ${op.fromName} -> ${op.toName}`;
    case "add_column":
      return `add_column ${op.tableName}.${op.column.name} (${op.column.type})`;
    case "drop_column":
      return `drop_column ${op.tableName}.${op.columnName}`;
    case "rename_column":
      return `rename_column ${op.tableName}.${op.fromColumn} -> ${op.toColumn}`;
    case "change_column_type":
      return `change_column_type ${op.tableName}.${op.columnName} (${op.fromType} -> ${op.toType})`;
    case "change_column_nullable":
      return `change_column_nullable ${op.tableName}.${op.columnName} (${op.fromNullable} -> ${op.toNullable})`;
    case "change_column_default":
      return `change_column_default ${op.tableName}.${op.columnName}`;
  }
}

/**
 * F11 PR 4: same adapter as `cli/commands/migrate-create.ts`. Kept in
 * sync via the shared `MinimalConfigEntity` type from the migrate-create
 * module. A future cleanup could extract to a shared CLI helper; for now
 * we duplicate the small ~15-LOC function rather than introduce a new
 * shared module just for this.
 *
 * MIRROR: keep in sync with `migrate-create.ts:toMinimalEntities`.
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
    return {
      slug: e.slug,
      tableName: e.dbName ?? `${tableNamePrefix}${e.slug.replace(/-/g, "_")}`,
      fields: (e.fields ?? []).map(f => ({
        name: f.name,
        type: f.type,
        required: f.required,
      })),
    };
  });
}

// SupportedDialect is the runtime dialect used to build the desired
// snapshot. Re-exported so tests can construct one without pulling in
// the adapter package.
export type { SupportedDialect };

// ============================================================================
// Command Registration
// ============================================================================

export function registerMigrateCheckCommand(program: Command): void {
  program
    .command("migrate:check")
    .description(
      "Verify migration file integrity and config drift (CI-friendly; no DB connection)"
    )
    .action(async (_cmdOptions: MigrateCheckCommandOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);

      const resolvedOptions: ResolvedMigrateCheckOptions = {
        config: globalOpts.config,
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
        cwd: globalOpts.cwd,
      };

      try {
        await runMigrateCheck(resolvedOptions, context);
      } catch (error) {
        context.logger.error(
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
