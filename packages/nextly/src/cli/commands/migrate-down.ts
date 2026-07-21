/**
 * `nextly migrate:down` — revert the most-recently-applied migration(s).
 *
 * SP-2 rollback. Reads the newest applied `file_apply` event(s) from
 * `nextly_schema_events`, runs each file's parsed `-- DOWN` section under the
 * migrate lock inside a transaction, then records a `rolled_back` event so the
 * file becomes re-runnable. Schema shape is restored; data is NOT recovered.
 *
 * **Runtime restriction (F11):** CLI-only; never import from runtime code.
 *
 * @module cli/commands/migrate-down
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { newestEvent } from "../../domains/schema/events/newest-event";
import {
  SchemaEventsRepository,
  type SchemaEventRow,
} from "../../domains/schema/events/schema-events-repository";
import { resolveMigration } from "../../domains/schema/migrate/resolve";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { describeError } from "../../errors/index";
import { createContext, type CommandContext } from "../program";
import {
  createAdapter,
  validateDatabaseEnv,
  type CLIDatabaseAdapter,
  type SupportedDialect,
} from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

import {
  executeTransaction,
  parseSqlSections,
  splitSqlStatements,
} from "./migrate";

/** A DOWN statement is "destructive" iff it drops a table or a column. */
export function isDestructiveDown(downSql: string): boolean {
  return (
    /\bDROP\s+TABLE\b/i.test(downSql) || /\bDROP\s+COLUMN\b/i.test(downSql)
  );
}

/**
 * Newest-applied-first filenames, limited to `step`. A file counts as applied
 * only when the NEWEST event for it is `applied` (a later rolled_back retires
 * it). Ordered by that newest event's startedAt, descending.
 */
export function selectAppliedTargets(
  rows: SchemaEventRow[],
  step: number
): string[] {
  const byFile = new Map<string, SchemaEventRow[]>();
  for (const r of rows) {
    if (!r.filename) continue;
    const list = byFile.get(r.filename) ?? [];
    list.push(r);
    byFile.set(r.filename, list);
  }

  const applied: { filename: string; at: number }[] = [];
  for (const [filename, list] of byFile) {
    const newest = newestEvent(list);
    if (newest?.status === "applied") {
      applied.push({ filename, at: newest.startedAt.getTime() });
    }
  }
  applied.sort((a, b) => b.at - a.at);
  return applied.slice(0, Math.max(0, step)).map(a => a.filename);
}

export interface MigrateDownCoreDeps {
  dialect: SupportedDialect;
  db: unknown;
  nodeEnv: string | undefined;
  logger: CommandContext["logger"];
  options: {
    step?: number;
    allowDataLoss?: boolean;
    yes?: boolean;
    dryRun?: boolean;
  };
  listFileApplies: () => Promise<SchemaEventRow[]>;
  fileExists: (filename: string) => Promise<boolean>;
  /** Returns the parsed `-- DOWN` SQL for a filename (may be empty string). */
  readDownSql: (filename: string) => Promise<string>;
  /** Executes a DOWN SQL string in a transaction; returns statements run. */
  execDown: (sql: string) => Promise<number>;
  /** Records a `rolled_back` event (retires the applied row). */
  recordRolledBack: (filename: string) => Promise<void>;
  /** Records a `failed` event for an errored DOWN. */
  recordFailed: (filename: string, message: string) => Promise<void>;
  withLock: typeof withMigrateLock;
}

export interface MigrateDownResult {
  rolledBack: string[];
}

export async function migrateDownCore(
  deps: MigrateDownCoreDeps
): Promise<MigrateDownResult> {
  const step = deps.options.step ?? 1;
  const rows = await deps.listFileApplies();
  const targets = selectAppliedTargets(rows, step);

  if (targets.length === 0) {
    deps.logger.info("Nothing to roll back.");
    return { rolledBack: [] };
  }

  // Load each target's DOWN SQL.
  const planned: { filename: string; downSql: string }[] = [];
  for (const filename of targets) {
    const downSql = (await deps.readDownSql(filename)).trim();
    planned.push({ filename, downSql });
  }

  // Dry-run is a non-destructive preview: it must never throw or execute, so
  // it runs BEFORE the guards. It instead annotates what a real run would
  // require, so the operator can read the DOWN SQL before deciding to pass
  // --allow-data-loss.
  if (deps.options.dryRun) {
    deps.logger.info(`Would roll back ${planned.length} migration(s):`);
    for (const p of planned) {
      deps.logger.info(`  • ${p.filename}`);
      if (p.downSql.length === 0) {
        deps.logger.info(
          "    (no -- DOWN section — irreversible; a real run would be refused)"
        );
        continue;
      }
      if (isDestructiveDown(p.downSql)) {
        deps.logger.info(
          "    ⚠ drops a table or column — a real run needs --allow-data-loss"
        );
      }
      deps.logger.info(p.downSql);
    }
    return { rolledBack: [] };
  }

  // Guards — evaluated up front, before executing anything.
  for (const p of planned) {
    if (p.downSql.length === 0) {
      throw new Error(
        `${p.filename} has no down SQL — it is irreversible. Hand-write a -- DOWN section or use 'nextly migrate:fresh'.`
      );
    }
    if (isDestructiveDown(p.downSql) && !deps.options.allowDataLoss) {
      throw new Error(
        `Rolling back ${p.filename} drops a table or column (data loss). Re-run with --allow-data-loss to proceed.`
      );
    }
  }

  if (deps.nodeEnv === "production" && !deps.options.yes) {
    throw new Error(
      "Refusing to roll back in production without --yes. Prefer rolling forward with a corrective migration, or restore from backup. Re-run with --yes to override."
    );
  }

  const rolledBack: string[] = [];
  await deps.withLock(
    deps.db,
    deps.dialect,
    async () => {
      for (const p of planned) {
        try {
          await deps.execDown(p.downSql);
        } catch (err) {
          await deps.recordFailed(p.filename, describeError(err));
          throw err;
        }
        await deps.recordRolledBack(p.filename);
        rolledBack.push(p.filename);
        deps.logger.success(`Rolled back ${p.filename}`);
      }
    },
    {
      mode: "fail-fast",
      logger: {
        warn: m => deps.logger.warn(m),
        info: m => deps.logger.info(m),
      },
    }
  );

  return { rolledBack };
}

// ============================================================================
// CLI shell + command registration
// ============================================================================

interface MigrateDownCommandOptions {
  step?: number;
  allowDataLoss?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  forceUnlock?: boolean;
}

interface ResolvedDownOptions extends MigrateDownCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

export async function runMigrateDown(
  options: ResolvedDownOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  logger.header("Migrate Down");

  const dbValidation = validateDatabaseEnv();
  if (!dbValidation.valid || !dbValidation.dialect) {
    for (const err of dbValidation.errors ?? []) logger.error(err);
    process.exit(1);
  }
  const dialect = dbValidation.dialect;

  const configResult = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
    debug: options.verbose,
  });
  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);

  const adapter: CLIDatabaseAdapter = await createAdapter({
    dialect: dbValidation.dialect,
    databaseUrl: dbValidation.databaseUrl,
    logger: options.verbose ? logger : undefined,
  });

  try {
    const db = (adapter as unknown as DrizzleAdapter).getDrizzle();
    const dz = adapter as unknown as DrizzleAdapter;
    const repo = new SchemaEventsRepository(db, dialect);

    if (options.forceUnlock) {
      const { forceUnlock } = await import(
        "../../domains/schema/pipeline/locks"
      );
      await forceUnlock(db, dialect);
    }

    const readDownSql = async (filename: string): Promise<string> => {
      const name = filename.endsWith(".sql") ? filename : `${filename}.sql`;
      const content = await readFile(resolve(migrationsDir, name), "utf-8");
      return parseSqlSections(content).downSql;
    };

    const execDown = async (sql: string): Promise<number> => {
      const statements = splitSqlStatements(sql);
      await executeTransaction(dz, dialect, async () => {
        for (const statement of statements) {
          await dz.executeQuery(statement);
        }
      });
      return statements.length;
    };

    const recordRolledBack = async (filename: string): Promise<void> => {
      await resolveMigration({
        mode: "rolled-back",
        filename,
        repo,
        // rolled-back mode does not read these; provide inert resolvers.
        fileExists: () => Promise.resolve(true),
        loadTargetSnapshot: () => Promise.resolve(null),
        introspectLive: () => Promise.resolve({ tables: [] }),
      });
    };

    const recordFailed = async (
      filename: string,
      message: string
    ): Promise<void> => {
      await repo.insertEvent({
        eventType: "file_apply",
        status: "failed",
        source: "cli-migrate",
        filename: filename.endsWith(".sql") ? filename : `${filename}.sql`,
        startedAt: new Date(),
        endedAt: new Date(),
        note: `migrate:down failed: ${message}`,
      });
    };

    const result = await migrateDownCore({
      dialect,
      db,

      nodeEnv: process.env.NODE_ENV,
      logger,
      options: {
        step: options.step,
        allowDataLoss: options.allowDataLoss,
        yes: options.yes,
        dryRun: options.dryRun,
      },
      listFileApplies: () => repo.listFileApplies(),
      fileExists: () => Promise.resolve(true),
      readDownSql,
      execDown,
      recordRolledBack,
      recordFailed,
      withLock: withMigrateLock,
    });

    if (result.rolledBack.length > 0) {
      logger.newline();
      logger.success(
        `Rolled back ${result.rolledBack.length} migration(s). ` +
          "Schema shape was restored; row data was NOT recovered."
      );
    }
  } finally {
    await adapter.disconnect();
  }
}

export function registerMigrateDownCommand(program: Command): void {
  program
    .command("migrate:down")
    .description(
      "Roll back the most-recently-applied migration(s) using their -- DOWN section"
    )
    .option("--step <n>", "Roll back the last N migrations", parseInt)
    .option(
      "--allow-data-loss",
      "Allow a rollback whose DOWN drops a table or column",
      false
    )
    .option(
      "--yes",
      "Confirm rollback in production (NODE_ENV=production)",
      false
    )
    .option(
      "--dry-run",
      "Show what would be rolled back (and the DOWN SQL) without executing",
      false
    )
    .option(
      "--force-unlock",
      "Clear a stale migrate lock before running",
      false
    )
    .action(async (cmdOptions: MigrateDownCommandOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);
      const resolvedOptions: ResolvedDownOptions = {
        ...cmdOptions,
        config: globalOpts.config,
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
        cwd: globalOpts.cwd,
      };
      try {
        await runMigrateDown(resolvedOptions, context);
      } catch (error) {
        context.logger.error(describeError(error));
        process.exit(1);
      }
    });
}
