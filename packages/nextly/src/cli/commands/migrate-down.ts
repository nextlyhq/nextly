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

import {
  pluginOfLedgerRow,
  scopeLedgerRows,
} from "../../domains/schema/events/ledger-scope";
import { newestEventsByFilename } from "../../domains/schema/events/newest-event";
import {
  SchemaEventsRepository,
  type SchemaEventRow,
} from "../../domains/schema/events/schema-events-repository";
import { truncateErrorMessage } from "../../domains/schema/events/schema-events-repository";
import { executeTransaction } from "../../domains/schema/migrate/migration-transaction";
import { moduleSql } from "../../domains/schema/migrate/plugin/plugin-migration";
import { recordPluginSchemaVersionFromLedger } from "../../domains/schema/migrate/plugin/plugin-schema-version";
import { resolveMigration } from "../../domains/schema/migrate/resolve";
import {
  assertRunnableStatements,
  splitSqlStatements,
} from "../../domains/schema/migrate/split-sql";
import {
  assertNoForeignDrops,
  columnsAfter,
  readLiveColumns,
  rebuildBlockStatements,
  type LiveColumns,
} from "../../domains/schema/ownership/drop-guard";
import type { OwnerRecord } from "../../domains/schema/ownership/owner-registry";
import { findUnexpectedDestructiveStatements } from "../../domains/schema/pipeline/filter-unsafe-statements";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { describeError } from "../../errors/index";
import { NextlyError } from "../../errors/nextly-error";
import { createContext, type CommandContext } from "../program";
import {
  createCliAdapter,
  validateDatabaseEnv,
  type CLIDatabaseAdapter,
  type SupportedDialect,
} from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

import { parseSqlSections } from "./migrate";
import {
  recordRollbackFailed,
  verifiedPluginModule,
} from "./plugin-module-rollback";

/**
 * Whether a DOWN loses data: it drops a table, a schema or a column, or
 * truncates a table.
 *
 * Judged per statement by the classifier the schema pipeline refuses
 * unexpected destructive DDL with, so "destructive" has one reading — it
 * covers the forms a text match on `DROP COLUMN` misses, such as PostgreSQL's
 * and MySQL's `ALTER TABLE t DROP c`. A complete table rebuild keeps the
 * table and its rows, so its `DROP TABLE` is not counted: the statements
 * `rebuildBlockStatements` names — judged against the table's live columns,
 * as the drop guard judges them — which is how a constraint-only SQLite DOWN
 * needs no --allow-data-loss. Everything else is handed to the classifier
 * with an empty approved-rebuild set, so a DROP TABLE outside a complete
 * block, or of a twin missing a live column, still counts.
 */
export function isDestructiveDown(
  statements: readonly string[],
  dialect: SupportedDialect,
  liveColumns: LiveColumns | undefined
): boolean {
  const rebuilding = rebuildBlockStatements(statements, dialect, liveColumns);
  return (
    findUnexpectedDestructiveStatements(
      statements.filter((_, index) => !rebuilding.has(index)),
      new Set()
    ).length > 0
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
  const applied: { filename: string; at: number }[] = [];
  for (const [filename, newest] of newestEventsByFilename(rows)) {
    if (newest.status === "applied") {
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
    /** Name whose migration rows to act on; undefined means the app's own. */
    plugin?: string;
  };
  listFileApplies: () => Promise<SchemaEventRow[]>;
  fileExists: (filename: string) => Promise<boolean>;
  /** Returns the parsed `-- DOWN` SQL for a filename (may be empty string). */
  readDownSql: (filename: string) => Promise<string>;
  /**
   * Executes a target's DOWN statements — the ones the guards judged — in
   * one transaction; returns how many ran.
   */
  execDown: (statements: readonly string[]) => Promise<number>;
  /** Records a `rolled_back` event (retires the applied row). */
  recordRolledBack: (filename: string) => Promise<void>;
  /**
   * Re-derive the plugin's applied schema version from the ledger rows that
   * survive the rollback, and write it onto its owner rows.
   *
   * Optional so the app path, which has no plugin owner rows to maintain,
   * supplies nothing.
   */
  recordPluginSchemaVersion?: () => Promise<void>;
  /** Records a `failed` event for an errored DOWN. */
  recordFailed: (filename: string, message: string) => Promise<void>;
  /**
   * Owner rows for the drop guard; absent when no registry is reachable,
   * which refuses nothing (the pre-registry behaviour).
   */
  owners?: ReadonlyMap<string, OwnerRecord>;
  /**
   * The live columns of the tables the targets' DOWNs rebuild
   * (`readLiveColumns`). Absent, a rebuild is read as the drop it would
   * otherwise be.
   */
  readLiveColumns?: (
    statementLists: ReadonlyArray<readonly string[]>
  ) => Promise<LiveColumns>;
  withLock: typeof withMigrateLock;
}

export interface MigrateDownResult {
  rolledBack: string[];
}

/** One rollback target, as planned before anything runs. */
interface PlannedDown {
  filename: string;
  downSql: string;
  /** The DOWN split into the statements `execDown` runs. */
  statements: string[];
  /** Why the DOWN could not be read, when it could not. */
  unreadable?: unknown;
  /**
   * The columns of the tables it rebuilds as they will be when it runs: live
   * for the first target, then as the targets before it leave them.
   */
  liveColumns?: LiveColumns;
}

/**
 * The reason a real run refuses to roll `p` back, or undefined when nothing
 * does — every refusal that does not depend on a flag the operator passes.
 * One function for the real run, which throws it, and the dry run, which
 * reports it.
 */
function refusalOf(
  p: PlannedDown,
  deps: Pick<MigrateDownCoreDeps, "dialect" | "options" | "owners">
): Error | undefined {
  if (p.unreadable !== undefined) return asError(p.unreadable);
  if (p.statements.length === 0) {
    return NextlyError.invalidInput({
      message: `${p.filename} has no down SQL — it is irreversible. Hand-write a -- DOWN section or use 'nextly migrate:fresh'.`,
      logContext: { filename: p.filename },
    });
  }
  try {
    // A statement the runner's transaction cannot hold, refused before any
    // target runs rather than when the executor reaches it.
    assertRunnableStatements(p.statements, deps.dialect, p.filename);
    // A rollback drops only what its own stream owns: an app file's DOWN
    // dropping a plugin-migrated table is refused whole, before any
    // statement runs, so the ledger records nothing.
    assertNoForeignDrops({
      liveColumns: p.liveColumns,
      statements: p.statements,
      stream: deps.options.plugin ? `plugin:${deps.options.plugin}` : "app",
      owners: deps.owners ?? new Map(),
      dialect: deps.dialect,
      source: p.filename,
    });
  } catch (refusal) {
    return asError(refusal);
  }
  return undefined;
}

/** A thrown value as an Error, so it can be thrown again as one. */
function asError(thrown: unknown): Error {
  return thrown instanceof Error
    ? thrown
    : NextlyError.internal({ logContext: { thrown: String(thrown) } });
}

export async function migrateDownCore(
  deps: MigrateDownCoreDeps
): Promise<MigrateDownResult> {
  const step = deps.options.step ?? 1;
  // Plugin rows belong to their own migration stream, so they are excluded
  // unless `--plugin` names one; an unscoped run must never revert a plugin's
  // migration while reporting an app rollback.
  const rows = scopeLedgerRows(
    await deps.listFileApplies(),
    deps.options.plugin
  );
  const targets = selectAppliedTargets(rows, step);

  if (targets.length === 0) {
    deps.logger.info("Nothing to roll back.");
    return { rolledBack: [] };
  }

  // Load each target's DOWN SQL.
  //
  // `reversible` asks whether the section holds any STATEMENT, not whether it
  // holds any text. A generated migration with nothing to reverse still emits
  // a `-- DOWN` header and an explanatory comment, so a length check reads it
  // as reversible, executes nothing, and records the file rolled back — after
  // which `migrate` treats it as pending and re-applies its `CREATE TABLE`s
  // against the tables that are still there. A baseline is the case where
  // that always happens, because it never has a down section.
  //
  // A target whose DOWN cannot be read — a module the plugin no longer
  // ships, or one changed since it was sealed or applied — is kept with the
  // reason, so a dry run can report it; a real run refuses on it below.
  const planned: PlannedDown[] = [];
  for (const filename of targets) {
    try {
      const downSql = (await deps.readDownSql(filename)).trim();
      planned.push({
        filename,
        downSql,
        statements: splitSqlStatements(downSql, deps.dialect),
      });
    } catch (unreadable) {
      planned.push({ filename, downSql: "", statements: [], unreadable });
    }
  }
  let columns: LiveColumns =
    (await deps.readLiveColumns?.(planned.map(p => p.statements))) ?? new Map();
  for (const p of planned) {
    p.liveColumns = columns;
    columns = columnsAfter(p.statements, deps.dialect, columns);
  }

  // Dry-run is a non-destructive preview: it never throws and never
  // executes. Every refusal a real run would make is reported instead, by
  // the same function that makes it, so the preview and the run cannot
  // disagree; so is what a real run would need --allow-data-loss for, so the
  // operator can read the DOWN SQL before deciding to pass it.
  if (deps.options.dryRun) {
    deps.logger.info(`Would roll back ${planned.length} migration(s):`);
    for (const p of planned) {
      deps.logger.info(`  • ${p.filename}`);
      const refusal = refusalOf(p, deps);
      if (refusal !== undefined) {
        deps.logger.info(
          `    ✖ a real run would be refused: ${describeError(refusal, { context: false })}`
        );
        continue;
      }
      if (isDestructiveDown(p.statements, deps.dialect, p.liveColumns)) {
        deps.logger.info(
          "    ⚠ drops a table or column — a real run needs --allow-data-loss"
        );
      }
      deps.logger.info(p.downSql);
    }
    return { rolledBack: [] };
  }

  // Guards — evaluated up front for every target, before executing anything.
  for (const p of planned) {
    const refusal = refusalOf(p, deps);
    if (refusal !== undefined) throw refusal;
    if (
      isDestructiveDown(p.statements, deps.dialect, p.liveColumns) &&
      !deps.options.allowDataLoss
    ) {
      throw NextlyError.invalidInput({
        message: `Rolling back ${p.filename} drops a table or column (data loss). Re-run with --allow-data-loss to proceed.`,
        logContext: { filename: p.filename },
      });
    }
  }

  if (deps.nodeEnv === "production" && !deps.options.yes) {
    throw NextlyError.invalidInput({
      message:
        "Refusing to roll back in production without --yes. Prefer rolling forward with a corrective migration, or restore from backup. Re-run with --yes to override.",
    });
  }

  const rolledBack: string[] = [];
  await deps.withLock(
    deps.db,
    deps.dialect,
    async () => {
      // A plugin rollback moves that plugin's APPLIED schema version back.
      //
      // Only the ledger was being rewritten, so rolling a plugin from schema
      // version 2 to 1 left its owner rows still claiming 2 — and the
      // production boot gate then accepted plugin code declaring version 2
      // whose v2 tables and columns had just been removed.
      //
      // The new version is read from what REMAINS applied rather than
      // computed by subtraction: modules can be rolled back out of order and
      // a step count would drift from the ledger it is meant to describe.
      //
      // Run whenever any module rolled back, INCLUDING when a later one then
      // failed: the earlier DOWNs and their ledger events are committed, and
      // leaving the version where it was let boot accept code expecting the
      // columns they removed. A failure here must not hide the DOWN failure
      // that is the operator's real problem: after a failure it is logged beside
      // that failure, which is what the command throws.
      const syncVersion = async (afterFailure: boolean): Promise<void> => {
        if (!deps.options.plugin || rolledBack.length === 0) return;
        try {
          await deps.recordPluginSchemaVersion?.();
        } catch (versionError) {
          if (!afterFailure) throw versionError;
          deps.logger.error(
            `The plugin's recorded schema version could not be updated after the partial rollback: ${describeError(versionError, { context: false })}`
          );
        }
      };

      try {
        for (const p of planned) {
          try {
            await deps.execDown(p.statements);
          } catch (err) {
            await deps.recordFailed(
              p.filename,
              truncateErrorMessage(describeError(err, { context: false }))
            );
            throw err;
          }
          await deps.recordRolledBack(p.filename);
          rolledBack.push(p.filename);
          deps.logger.success(`Rolled back ${p.filename}`);
        }
      } catch (err) {
        await syncVersion(true);
        throw err;
      }
      await syncVersion(false);
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
  plugin?: string;
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

  const adapter: CLIDatabaseAdapter = await createCliAdapter({
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

    /**
     * The DOWN statements for one ledger row, from wherever that row lives.
     *
     * `--plugin` selects rows whose filename is qualified — `plugin:<name>/<module>`
     * — and a plugin's migrations are TypeScript MODULES held in its
     * definition, not `.sql` files under the app's migrations directory.
     * Resolving every filename below that directory made
     * `migrate:down --plugin <name>` fail on a missing file before it could
     * roll anything back, which is the one thing the flag exists to do.
     *
     * The app's own rows keep reading the `.sql` file exactly as before.
     */
    // The newest ledger row per filename, read once: a plugin module's DOWN
    // is verified against the checksum its applied row recorded.
    let newestRows: Promise<Map<string, SchemaEventRow>> | undefined;
    const recordedSha = async (filename: string) => {
      newestRows ??= repo.listFileApplies().then(newestEventsByFilename);
      return (await newestRows).get(filename)?.sha256;
    };

    const readDownSql = async (filename: string): Promise<string> => {
      const pluginName = pluginOfLedgerRow(filename);
      if (pluginName !== null) {
        // A plugin module is read from the plugin's definition, verified as
        // the module that was applied — the check `plugins uninstall` makes,
        // through the same function — and joined the way the apply path
        // joins its UP. The core splits it with the splitter
        // `pluginModuleStatements` uses, so the guards read, and `execDown`
        // runs, the statements `plugins uninstall` would.
        const definition = (configResult.config.plugins ?? []).find(
          p => p.name === pluginName
        );
        const module = verifiedPluginModule({
          pluginName,
          migrations: definition?.contributes?.schema?.migrations ?? [],
          // The last slash for the same reason `pluginOfLedgerRow` uses it:
          // a scoped plugin name carries a slash, and the first one is
          // inside the NAME.
          moduleName: filename.slice(filename.lastIndexOf("/") + 1),
          filename,
          recordedSha: await recordedSha(filename),
        });
        return moduleSql(module, dialect, "down");
      }
      const name = filename.endsWith(".sql") ? filename : `${filename}.sql`;
      const content = await readFile(resolve(migrationsDir, name), "utf-8");
      return parseSqlSections(content).downSql;
    };

    const execDown = async (statements: readonly string[]): Promise<number> => {
      await executeTransaction(dz, async tx => {
        for (const statement of statements) {
          await tx.execute(statement);
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
      await recordRollbackFailed({
        repo,
        filename,
        dialect,
        note: `migrate:down failed: ${message}`,
      });
    };

    // Owner rows for the drop guard, read before the run so a foreign drop
    // is refused before any statement executes.
    const { SchemaOwnersRepository: OwnersRepo, tableOwnersByName } =
      await import("../../domains/schema/ownership/schema-owners-repository");
    const owners = tableOwnersByName(await new OwnersRepo(db, dialect).read());

    const result = await migrateDownCore({
      dialect,
      db,
      owners,
      readLiveColumns: lists => readLiveColumns(db, dialect, lists),

      nodeEnv: process.env.NODE_ENV,
      logger,
      options: {
        step: options.step,
        allowDataLoss: options.allowDataLoss,
        yes: options.yes,
        dryRun: options.dryRun,
        plugin: options.plugin,
      },
      listFileApplies: () => repo.listFileApplies(),
      fileExists: () => Promise.resolve(true),
      readDownSql,
      execDown,
      recordRolledBack,
      recordPluginSchemaVersion: async () => {
        const plugin = options.plugin;
        if (!plugin) return;
        const { SchemaOwnersRepository } = await import(
          "../../domains/schema/ownership/schema-owners-repository"
        );
        const definition = (configResult.config.plugins ?? []).find(
          p => p.name === plugin
        );
        await recordPluginSchemaVersionFromLedger({
          plugin,
          migrations: definition?.contributes?.schema?.migrations ?? [],
          listFileApplies: () => repo.listFileApplies(),
          owners: new SchemaOwnersRepository(db, dialect),
        });
      },
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
    .option(
      "--plugin <name>",
      "Roll back <name>'s migrations instead of the app's"
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
