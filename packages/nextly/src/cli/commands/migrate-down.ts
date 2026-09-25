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
import { newestEvent } from "../../domains/schema/events/newest-event";
import {
  SchemaEventsRepository,
  type SchemaEventRow,
} from "../../domains/schema/events/schema-events-repository";
import { truncateErrorMessage } from "../../domains/schema/events/schema-events-repository";
import { resolveMigration } from "../../domains/schema/migrate/resolve";
import { assertNoForeignDrops } from "../../domains/schema/ownership/drop-guard";
import type { OwnerRecord } from "../../domains/schema/ownership/owner-registry";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { describeError } from "../../errors/index";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { createContext, type CommandContext } from "../program";
import {
  createCliAdapter,
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
    /** Name whose migration rows to act on; undefined means the app's own. */
    plugin?: string;
  };
  listFileApplies: () => Promise<SchemaEventRow[]>;
  fileExists: (filename: string) => Promise<boolean>;
  /** Returns the parsed `-- DOWN` SQL for a filename (may be empty string). */
  readDownSql: (filename: string) => Promise<string>;
  /** Executes a DOWN SQL string in a transaction; returns statements run. */
  execDown: (sql: string) => Promise<number>;
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
  withLock: typeof withMigrateLock;
}

export interface MigrateDownResult {
  rolledBack: string[];
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
  const planned: { filename: string; downSql: string; reversible: boolean }[] =
    [];
  for (const filename of targets) {
    const downSql = (await deps.readDownSql(filename)).trim();
    planned.push({
      filename,
      downSql,
      reversible: splitSqlStatements(downSql, deps.dialect).length > 0,
    });
  }

  // Dry-run is a non-destructive preview: it must never throw or execute, so
  // it runs BEFORE the guards. It instead annotates what a real run would
  // require, so the operator can read the DOWN SQL before deciding to pass
  // --allow-data-loss.
  if (deps.options.dryRun) {
    deps.logger.info(`Would roll back ${planned.length} migration(s):`);
    for (const p of planned) {
      deps.logger.info(`  • ${p.filename}`);
      if (!p.reversible) {
        deps.logger.info(
          "    (no down SQL — irreversible; a real run would be refused)"
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
    if (!p.reversible) {
      throw new Error(
        `${p.filename} has no down SQL — it is irreversible. Hand-write a -- DOWN section or use 'nextly migrate:fresh'.`
      );
    }
    if (isDestructiveDown(p.downSql) && !deps.options.allowDataLoss) {
      throw new Error(
        `Rolling back ${p.filename} drops a table or column (data loss). Re-run with --allow-data-loss to proceed.`
      );
    }
    // A rollback drops only what its own stream owns: an app file's DOWN
    // dropping a plugin-migrated table is refused whole, before any
    // statement runs, so the ledger records nothing.
    assertNoForeignDrops({
      statements: splitSqlStatements(p.downSql, deps.dialect),
      stream: deps.options.plugin ? `plugin:${deps.options.plugin}` : "app",
      owners: deps.owners ?? new Map(),
      source: p.filename,
    });
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
      if (deps.options.plugin) await deps.recordPluginSchemaVersion?.();
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

/**
 * One plugin module's DOWN statements, as the SQL text the rollback path reads.
 *
 * Joined the way `run-plugin-migrations` joins a module's UP for its reconcile
 * file, so both directions describe a module the same way. The caller splits it
 * again before executing, and the guards in between — the irreversible check,
 * the data-loss check, `assertNoForeignDrops` — all read this text, so a plugin
 * module is judged by exactly the rules an app file is.
 */
function pluginModuleDownSql(
  plugins: readonly PluginDefinition[],
  filename: string,
  pluginName: string,
  dialect: SupportedDialect
): string {
  // The last slash for the same reason `pluginOfLedgerRow` uses it: a scoped
  // plugin name carries a slash, and the first one is inside the NAME.
  const moduleName = filename.slice(filename.lastIndexOf("/") + 1);
  const definition = plugins.find(p => p.name === pluginName);
  const module = (definition?.contributes?.schema?.migrations ?? []).find(
    m => m.name === moduleName
  );
  if (!module) {
    // Named rather than "file not found": the row exists, so the module was
    // shipped once. It is the plugin that is now absent or downgraded, and
    // those are different fixes.
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage:
        `${filename} is recorded in the ledger, but plugin "${pluginName}" does not currently ship a module named "${moduleName}". ` +
        `Reinstall the version that shipped it before rolling it back.`,
      statusCode: 400,
      logContext: { filename, plugin: pluginName, module: moduleName },
    });
  }
  return (module.dialects[dialect]?.down ?? []).join(";\n");
}

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
    const readDownSql = async (filename: string): Promise<string> => {
      const pluginName = pluginOfLedgerRow(filename);
      if (pluginName !== null) {
        return pluginModuleDownSql(
          configResult.config.plugins ?? [],
          filename,
          pluginName,
          dialect
        );
      }
      const name = filename.endsWith(".sql") ? filename : `${filename}.sql`;
      const content = await readFile(resolve(migrationsDir, name), "utf-8");
      return parseSqlSections(content).downSql;
    };

    const execDown = async (sql: string): Promise<number> => {
      const statements = splitSqlStatements(sql, dialect);
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

    // Owner rows for the drop guard, read before the run so a foreign drop
    // is refused before any statement executes.
    const { SchemaOwnersRepository: OwnersRepo, tableOwnersByName } =
      await import("../../domains/schema/ownership/schema-owners-repository");
    const owners = tableOwnersByName(await new OwnersRepo(db, dialect).read());

    const result = await migrateDownCore({
      dialect,
      db,
      owners,

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
        const ownersRepo = new SchemaOwnersRepository(db, dialect);
        const mine = (await ownersRepo.read()).filter(
          row => row.ownerId === plugin
        );
        if (mine.length === 0) return;

        // The highest schemaVersion among this plugin's modules that are STILL
        // applied. Read from the ledger rather than stepped down by one: a
        // rollback can take several modules, and modules can be reverted out
        // of order, so counting would describe something the ledger does not.
        const applied = new Set(
          scopeLedgerRows(await repo.listFileApplies(), plugin)
            .filter(row => row.status === "applied")
            .map(row => row.filename ?? "")
        );
        const definition = (configResult.config.plugins ?? []).find(
          p => p.name === plugin
        );
        let version: number | null = null;
        for (const module of definition?.contributes?.schema?.migrations ??
          []) {
          const filename = `plugin:${plugin}/${module.name}`;
          if (!applied.has(filename)) continue;
          version = Math.max(version ?? 0, module.schemaVersion);
        }

        await ownersRepo.upsert(
          mine.map(row => ({ ...row, schemaVersion: version }))
        );
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
