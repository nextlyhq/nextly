/**
 * `nextly migrate:down` — revert the most-recently-applied migration(s).
 *
 * SP-2 rollback. Reads the newest applied `file_apply` event(s) from
 * `nextly_schema_events`, runs each file's parsed `-- DOWN` section under the
 * migrate lock inside a transaction — outside one for a file marked
 * `-- nextly:no-transaction` — and records a `rolled_back` event, and a
 * plugin's schema version, in that same transaction, so the file becomes
 * re-runnable exactly when its DOWN commits. Schema shape is restored; data
 * is NOT recovered.
 *
 * **Runtime restriction (F11):** CLI-only; never import from runtime code.
 *
 * @module cli/commands/migrate-down
 */
import { createHash } from "node:crypto";
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
  truncateErrorMessage,
} from "../../domains/schema/events/schema-events-repository";
import {
  ACCEPT_DATA_LOSS_HELP,
  isInteractiveTerminal,
  judgeDataLoss,
  resolveDataLossConsent,
  type DataLossConsent,
  type Deletion,
} from "../../domains/schema/migrate/data-loss-consent";
import {
  concurrentRunError,
  failedAttemptMayBePartial,
  isConcurrentRun,
} from "../../domains/schema/migrate/drift-reconcile";
import {
  outsideTransactionNotice,
  runMigrationStatements,
  type MigrationUnit,
} from "../../domains/schema/migrate/migration-transaction";
import {
  compareModuleNames,
  qualifiedFilename,
} from "../../domains/schema/migrate/plugin/plugin-migration";
import { recordPluginSchemaVersionFromLedger } from "../../domains/schema/migrate/plugin/plugin-schema-version";
import { resolveMigration } from "../../domains/schema/migrate/resolve";
import {
  assertRunnableStatements,
  marksNoTransaction,
  splitSqlStatements,
} from "../../domains/schema/migrate/split-sql";
import {
  assertNoForeignDrops,
  columnsAfter,
  liveTablesAfter,
  readLiveColumns,
  readLiveElements,
  readLiveIndexTables,
  readLiveTables,
  rebuildBlockStatements,
  type LiveColumns,
  type LiveElements,
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
import {
  askToDeleteInTerminal,
  readDataLossConsent,
  type AcceptDataLossOption,
} from "../utils/data-loss-consent";
import { compareMigrationBaseNames } from "../utils/migration-discovery";

import { parseSqlSections } from "./migrate";
import {
  pluginModuleDown,
  recordRollbackFailed,
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
 * needs no data-loss consent. Everything else is handed to the classifier
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
 *
 * Migrations recorded in the same millisecond — a run of plugin modules
 * adopted together, say — share a `startedAt`, and the ledger is read with no
 * ORDER BY, so a tie is broken by the order the stream runs them in, the
 * later first (`laterInRunOrder`). Left to the read order, `--step 1` could
 * reverse a module before the later one that depends on it.
 *
 * `plugin` names the stream the rows were scoped to: its modules' run order
 * is by module name, the app's by file name.
 */
export function selectAppliedTargets(
  rows: SchemaEventRow[],
  step: number,
  plugin?: string
): string[] {
  const applied: { filename: string; at: number }[] = [];
  for (const [filename, newest] of newestEventsByFilename(rows)) {
    if (newest.status === "applied") {
      applied.push({ filename, at: newest.startedAt.getTime() });
    }
  }
  applied.sort(
    (a, b) => b.at - a.at || laterInRunOrder(a.filename, b.filename, plugin)
  );
  return applied.slice(0, Math.max(0, step)).map(a => a.filename);
}

/**
 * Negative when ledger filename `a` runs after `b` in its stream: by module
 * name for a plugin's rows (`compareModuleNames`, the order the runner applies
 * them in), by base name for the app's (`compareMigrationBaseNames`).
 */
function laterInRunOrder(a: string, b: string, plugin?: string): number {
  if (plugin !== undefined) {
    const prefix = qualifiedFilename(plugin, "");
    return compareModuleNames(b.slice(prefix.length), a.slice(prefix.length));
  }
  const base = (filename: string) => filename.replace(/\.sql$/i, "");
  return compareMigrationBaseNames(base(b), base(a));
}

export interface MigrateDownCoreDeps {
  dialect: SupportedDialect;
  db: unknown;
  /**
   * The adapter the schema lock is taken through (`downDatabaseDeps` supplies it). Optional only
   * so a test that replaces `withLock` need not build one; the real lock refuses without it.
   */
  adapter?: DrizzleAdapter;
  /** What holds the lock while this runs, as another run's refusal names it. */
  lockCommand?: string;
  /**
   * The owner registry read again, for the plan made inside the lock. `downDatabaseDeps` supplies
   * it; absent, the plan inside the lock uses the rows read before it.
   */
  readOwners?: () => Promise<
    Pick<MigrateDownCoreDeps, "owners" | "elementOwners">
  >;
  nodeEnv: string | undefined;
  logger: CommandContext["logger"];
  options: {
    step?: number;
    /**
     * The earlier spelling of the consent: covers a DOWN that loses data, as
     * it did before. Read only when `consent` is absent; the command line
     * folds it into `consent`, naming it deprecated.
     */
    allowDataLoss?: boolean;
    /** The data-loss consent a DOWN that loses data needs. */
    consent?: DataLossConsent;
    yes?: boolean;
    dryRun?: boolean;
    /** Name whose migration rows to act on; undefined means the app's own. */
    plugin?: string;
  };
  listFileApplies: () => Promise<SchemaEventRow[]>;
  fileExists: (filename: string) => Promise<boolean>;
  /**
   * Returns the parsed `-- DOWN` SQL for a filename (may be empty string),
   * and whether it runs in a transaction: false for a file marked
   * `-- nextly:no-transaction` or a module with `transaction: false`.
   */
  readDownSql: (filename: string) => Promise<MigrationDown>;
  /**
   * Executes a target's DOWN statements — the ones the guards judged — as
   * `unit` says: in one transaction unless it is marked to run outside one —
   * then `after` with the handle they ran on, inside that transaction when
   * there is one (`runMigrationStatements`); returns how many ran.
   */
  execDown: (
    statements: readonly string[],
    unit: MigrationUnit,
    after: (db: unknown) => Promise<void>
  ) => Promise<number>;
  /**
   * Records a `rolled_back` event (retires the applied row) through `db`,
   * the handle the DOWN ran on. False, and nothing written, when the
   * migration's newest row is no longer `applied`: another run rolled it
   * back while this one was running its DOWN.
   */
  recordRolledBack: (filename: string, db: unknown) => Promise<boolean>;
  /**
   * Re-derive the plugin's applied schema version from the ledger rows that
   * survive the rollback, and write it onto its owner rows, through `db`,
   * the handle the DOWN and its `rolled_back` row were written on.
   *
   * Optional so the app path, which has no plugin owner rows to maintain,
   * supplies nothing.
   */
  recordPluginSchemaVersion?: (db: unknown) => Promise<void>;
  /**
   * Records a `failed` event for an errored DOWN; `transaction` false says it
   * ran outside a transaction, so part of it may have applied.
   */
  recordFailed: (
    filename: string,
    message: string,
    transaction: boolean
  ) => Promise<void>;
  /**
   * Table-level owner rows for the drop guard; absent when no registry is
   * reachable, which reads as nothing being claimed.
   */
  owners?: ReadonlyMap<string, OwnerRecord>;
  /** Every owner row, element rows included, for the guard's column check. */
  elementOwners?: readonly OwnerRecord[];
  /**
   * The live columns of the tables the targets' DOWNs rebuild
   * (`readLiveColumns`). Absent, a rebuild is read as the drop it would
   * otherwise be.
   */
  readLiveColumns?: (
    statementLists: ReadonlyArray<readonly string[]>
  ) => Promise<LiveColumns>;
  /**
   * The live indexes, foreign keys and checks of the tables the targets'
   * DOWNs rebuild (`readLiveElements`), read once before any runs. Absent, a
   * rebuild is read as the drop it would otherwise be.
   */
  readLiveElements?: (
    statementLists: ReadonlyArray<readonly string[]>
  ) => Promise<LiveElements>;
  /**
   * The tables the targets' DOWNs create that exist already
   * (`readLiveTables`). Absent, the guard credits a DOWN with no table it
   * creates.
   */
  readLiveTables?: (
    statementLists: ReadonlyArray<readonly string[]>
  ) => Promise<ReadonlySet<string>>;
  /**
   * The table each index the targets' DOWNs name without one is on
   * (`readLiveIndexTables`), read once before any runs. Absent, such an index
   * is judged as one on a table no record claims.
   */
  readLiveIndexTables?: (
    statementLists: ReadonlyArray<readonly string[]>
  ) => Promise<ReadonlyMap<string, string>>;
  withLock: typeof withMigrateLock;
  /**
   * Whether a person is at a terminal to be asked before a DOWN loses data.
   * Absent reads as no, so a rollback without consent is refused rather than
   * run.
   */
  interactive?: boolean;
  /** Asks that person a yes-or-no question; only called when `interactive`. */
  askToDelete?: (question: string) => Promise<boolean>;
}

/**
 * The adapter the lock is taken through. Refused rather than guessed when absent: a rollback run
 * without the schema lock is the overlap the lock exists to prevent.
 */
function lockAdapter(deps: MigrateDownCoreDeps): DrizzleAdapter {
  if (deps.adapter !== undefined) return deps.adapter;
  // A stand-in `withLock` ignores its first argument, so a test that replaces the lock still runs;
  // the real one reads `getCapabilities` off it and fails loudly on this placeholder.
  return {
    getCapabilities: () => {
      throw NextlyError.internal({
        logContext: { reason: "migrate:down was given no adapter to lock" },
      });
    },
  } as unknown as DrizzleAdapter;
}

export interface MigrateDownResult {
  rolledBack: string[];
}

/** A migration's DOWN as the rollback reads it. */
export interface MigrationDown {
  sql: string;
  /** False when the migration is marked to run outside a transaction. */
  transaction: boolean;
}

/** One rollback target, as planned before anything runs. */
export interface PlannedDown {
  filename: string;
  downSql: string;
  /** False when the DOWN runs outside a transaction. */
  transaction: boolean;
  /** The DOWN split into the statements `execDown` runs. */
  statements: string[];
  /** Why the DOWN could not be read, when it could not. */
  unreadable?: unknown;
  /**
   * The columns of the tables it rebuilds as they will be when it runs: live
   * for the first target, then as the targets before it leave them.
   */
  liveColumns?: LiveColumns;
  /** The live elements of the tables it rebuilds; see `readLiveState`. */
  liveElements?: LiveElements;
  /** The tables it creates that exist before it runs (`readLiveState`). */
  liveTables?: ReadonlySet<string>;
  /** The table each index its DOWN names without one is on; see `readLiveState`. */
  liveIndexTables?: ReadonlyMap<string, string>;
}

/**
 * The reason a real run refuses to roll `p` back, or undefined when nothing
 * does — every refusal that does not depend on a flag the operator passes.
 * One function for the real run, which throws it, the dry run, which reports
 * it, and `plugins uninstall`, which throws it before any module runs.
 */
export function refusalOf(
  p: PlannedDown,
  deps: Pick<
    MigrateDownCoreDeps,
    "dialect" | "options" | "owners" | "elementOwners"
  >
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
    assertRunnableStatements(p.statements, deps.dialect, p.filename, {
      transaction: p.transaction,
      unit: deps.options.plugin ? "module" : "file",
    });
    // A rollback drops only what its own stream owns: an app file's DOWN
    // dropping a plugin-migrated table is refused whole, before any
    // statement runs, so the ledger records nothing.
    assertNoForeignDrops({
      liveColumns: p.liveColumns,
      liveElements: p.liveElements,
      liveTables: p.liveTables,
      liveIndexTables: p.liveIndexTables,
      statements: p.statements,
      stream: deps.options.plugin ? `plugin:${deps.options.plugin}` : "app",
      owners: deps.owners ?? new Map(),
      elementOwners: deps.elementOwners ?? [],
      dialect: deps.dialect,
      source: p.filename,
    });
  } catch (refusal) {
    return asError(refusal);
  }
  return undefined;
}

/**
 * Hands each target the live state it will run against, read once before any
 * runs: the columns of the tables it rebuilds, as the targets before it leave
 * them, and the tables it creates that exist already. Every table an earlier
 * target creates counts as existing for the later ones, whether or not it is
 * dropped again in between — which can only withhold a creation's credit from
 * a later target, never lend it one.
 */
async function readLiveState(
  planned: PlannedDown[],
  deps: Pick<
    MigrateDownCoreDeps,
    | "dialect"
    | "readLiveColumns"
    | "readLiveElements"
    | "readLiveTables"
    | "readLiveIndexTables"
  >
): Promise<void> {
  const lists = planned.map(p => p.statements);
  let columns: LiveColumns = (await deps.readLiveColumns?.(lists)) ?? new Map();
  let tables = await deps.readLiveTables?.(lists);
  // Read once for every target. An index a target names is one the database
  // has before the rollback; one it lacks then is absent here and judged as
  // taking nothing — the only way it can exist by that target's turn is that
  // an earlier target of this same rollback, this stream's, recreated it.
  const indexTables = await deps.readLiveIndexTables?.(lists);
  // Read once too. Every target of a rollback is one stream's, so an
  // element an earlier target put on a table is this stream's to leave out
  // of a later rebuild, and one an earlier target took is judged again by a
  // later rebuild that leaves it out, as the earlier target's drop was.
  const elements = await deps.readLiveElements?.(lists);
  for (const p of planned) {
    p.liveColumns = columns;
    p.liveElements = elements;
    p.liveTables = tables;
    p.liveIndexTables = indexTables;
    columns = columnsAfter(p.statements, deps.dialect, columns);
    // Kept with the descendants the live reading carries, followed through
    // the target's renames, so each later target is judged against the
    // inheritance tree as well.
    tables = tables && liveTablesAfter(tables, p.statements, deps.dialect);
  }
}

/** A thrown value as an Error, so it can be thrown again as one. */
function asError(thrown: unknown): Error {
  return thrown instanceof Error
    ? thrown
    : NextlyError.internal({ logContext: { thrown: String(thrown) } });
}

/**
 * Run one target's DOWN and record it, in the transaction the DOWN runs in.
 *
 * The `rolled_back` row is written through the DOWN's own handle, and so is
 * a plugin's schema version: read from the modules that REMAIN applied
 * rather than computed by subtraction, because modules can be rolled back out
 * of order, and written onto its owner rows so the boot gate stops accepting
 * code that expects what the DOWN removed. A DOWN that commits commits all
 * three, and one that fails, or a process stopping before COMMIT, leaves the
 * migration applied with its statements in place. Outside a transaction each
 * statement has committed by the time they are written, as for an UP.
 *
 * Another run having rolled the migration back first is a lost race
 * (`concurrentRunError`): thrown inside the transaction, it rolls this DOWN
 * back. A failure is recorded as a failed rollback, except a lost race
 * rolled back whole, which leaves nothing of this run to record.
 */
export async function rollBackOne(
  p: PlannedDown,
  deps: Pick<
    MigrateDownCoreDeps,
    | "dialect"
    | "logger"
    | "options"
    | "execDown"
    | "recordRolledBack"
    | "recordPluginSchemaVersion"
    | "recordFailed"
  >
): Promise<void> {
  if (!p.transaction) {
    deps.logger.warn(outsideTransactionNotice(p.filename));
  }
  const partial = failedAttemptMayBePartial(p, deps.dialect);
  try {
    await deps.execDown(
      p.statements,
      { source: p.filename, transaction: p.transaction, direction: "down" },
      async db => {
        if (!(await deps.recordRolledBack(p.filename, db))) {
          throw concurrentRunError({
            filename: p.filename,
            direction: "down",
            partial,
          });
        }
        if (deps.options.plugin) await deps.recordPluginSchemaVersion?.(db);
      }
    );
  } catch (err) {
    if (!isConcurrentRun(err) || partial) {
      await deps.recordFailed(
        p.filename,
        truncateErrorMessage(describeError(err, { context: false })),
        p.transaction
      );
    }
    throw err;
  }
}

/**
 * Each target's DOWN as it will run, in the order given, with the live state
 * the guards judge it against (`readLiveState`). Reads; runs nothing.
 *
 * The one planner for every rollback: `migrate:down` and `plugins uninstall`
 * judge and run the statements it returns, so the two cannot disagree about
 * what a module's DOWN holds.
 *
 * `reversible` asks whether the section holds any STATEMENT, not whether it
 * holds any text. A generated migration with nothing to reverse still emits
 * a `-- DOWN` header and an explanatory comment, so a length check reads it
 * as reversible, executes nothing, and records the file rolled back — after
 * which `migrate` treats it as pending and re-applies its `CREATE TABLE`s
 * against the tables that are still there. A baseline is the case where
 * that always happens, because it never has a down section.
 *
 * A target whose DOWN cannot be read — a module the plugin no longer
 * ships, or one changed since it was sealed or applied — is kept with the
 * reason, so a dry run can report it; `refusalOf` refuses a real run on it.
 */
export async function planRollback(
  filenames: readonly string[],
  deps: Pick<
    MigrateDownCoreDeps,
    | "dialect"
    | "readDownSql"
    | "readLiveColumns"
    | "readLiveElements"
    | "readLiveTables"
    | "readLiveIndexTables"
  >
): Promise<PlannedDown[]> {
  const planned: PlannedDown[] = [];
  for (const filename of filenames) {
    try {
      const down = await deps.readDownSql(filename);
      const downSql = down.sql.trim();
      planned.push({
        filename,
        downSql,
        transaction: down.transaction,
        statements: splitSqlStatements(downSql, deps.dialect, down),
      });
    } catch (unreadable) {
      planned.push({
        filename,
        downSql: "",
        transaction: true,
        statements: [],
        unreadable,
      });
    }
  }
  await readLiveState(planned, deps);
  return planned;
}

/**
 * The targets a rollback would undo and its plan, with every guard a real run applies.
 *
 * Asked twice by a real run: once before the lock, so a refusal that is already certain needs no
 * wait, and again once the lock is held, against the ledger, the owner registry and the live
 * schema as they stand then. A run that waited for the lock may meet a database another run has
 * since changed — a plugin install adding an owned column, another rollback undoing the target —
 * and a plan approved before the wait would act on a database that is no longer there.
 *
 * The data-loss consent is judged in both, and asked about only in the first: `agreed` carries
 * what the operator agreed to there into the second, which accepts it without asking again and
 * refuses anything new rather than asking while other runs wait on the lock.
 */
async function planAndGuard(
  deps: MigrateDownCoreDeps,
  agreed?: readonly Deletion[]
): Promise<GuardedPlan> {
  const step = deps.options.step ?? 1;
  // Plugin rows belong to their own migration stream, so they are excluded
  // unless `--plugin` names one; an unscoped run must never revert a plugin's
  // migration while reporting an app rollback.
  const rows = scopeLedgerRows(
    await deps.listFileApplies(),
    deps.options.plugin
  );
  const targets = selectAppliedTargets(rows, step, deps.options.plugin);
  if (targets.length === 0)
    return { planned: [], deletions: [], declined: false };
  const planned = await planRollback(targets, deps);
  if (deps.options.dryRun) return { planned, deletions: [], declined: false };

  // Guards — evaluated up front for every target, before executing anything.
  for (const p of planned) {
    const refusal = refusalOf(p, deps);
    if (refusal !== undefined) throw refusal;
  }

  // A DOWN that loses data takes the data-loss consent, judged for every
  // target before the first runs. Each is judged by its statements as a
  // whole, so it is named by its file: only the consent without targets
  // covers it, and a list naming tables is refused rather than read as
  // covering a DOWN it cannot be matched against.
  const deletions: Deletion[] = planned
    .filter(p => isDestructiveDown(p.statements, deps.dialect, p.liveColumns))
    .map(p => ({
      kind: "unnamed" as const,
      description: `${p.filename}'s DOWN, which drops a table or column, or empties a table`,
      // The statements as judged: under the lock the DOWN is read again, and
      // one that changed since it was agreed to is a different deletion.
      fingerprint: createHash("sha256")
        .update(p.statements.join("\n;\n"))
        .digest("hex"),
    }));
  const first = agreed === undefined;
  const verdict = await judgeDataLoss({
    deletions,
    consent:
      deps.options.consent ??
      resolveDataLossConsent({
        honours: ["--allow-data-loss"],
        earlierFlags: deps.options.allowDataLoss ? ["--allow-data-loss"] : [],
      }),
    interactive: first && deps.interactive === true,
    ask: question => deps.askToDelete?.(question) ?? Promise.resolve(false),
    print: first ? line => deps.logger.warn(line) : () => {},
    approved: agreed,
  });
  if (verdict.kind === "refused") {
    throw NextlyError.invalidInput({
      message: verdict.message,
      logContext: { reason: `data-loss-${verdict.reason}` },
    });
  }
  return { planned, deletions, declined: verdict.kind === "declined" };
}

/** A rollback's plan once every guard has passed, and what the operator agreed it deletes. */
interface GuardedPlan {
  planned: PlannedDown[];
  deletions: Deletion[];
  /** The terminal was asked and said no: nothing is rolled back. */
  declined: boolean;
}

export async function migrateDownCore(
  deps: MigrateDownCoreDeps
): Promise<MigrateDownResult> {
  const guarded = await planAndGuard(deps);
  const planned = guarded.planned;

  if (planned.length === 0) {
    deps.logger.info("Nothing to roll back.");
    return { rolledBack: [] };
  }

  // Dry-run is a non-destructive preview: it never throws and never
  // executes. Every refusal a real run would make is reported instead, by
  // the same function that makes it, so the preview and the run cannot
  // disagree; so is what a real run would need the data-loss consent for, so
  // the operator can read the DOWN SQL before deciding to give it.
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
          "    ⚠ drops a table or column — a real run needs --accept-data-loss"
        );
      }
      if (!p.transaction) {
        deps.logger.info(`    ⚠ ${outsideTransactionNotice(p.filename)}`);
      }
      deps.logger.info(p.downSql);
    }
    return { rolledBack: [] };
  }

  if (guarded.declined) {
    deps.logger.info("Nothing was rolled back.");
    return { rolledBack: [] };
  }

  if (deps.nodeEnv === "production" && !deps.options.yes) {
    throw NextlyError.invalidInput({
      message:
        "Refusing to roll back in production without --yes. Prefer rolling forward with a corrective migration, or restore from backup. Re-run with --yes to override.",
    });
  }

  const rolledBack: string[] = [];
  await deps.withLock(
    lockAdapter(deps),
    deps.dialect,
    async () => {
      // Planned again under the lock, from the database as it stands now; see `planAndGuard`.
      const held = { ...deps, ...(await deps.readOwners?.()) };
      const { planned: current } = await planAndGuard(held, guarded.deletions);
      if (current.length === 0) {
        deps.logger.info("Nothing to roll back.");
        return;
      }
      for (const p of current) {
        await rollBackOne(p, held);
        rolledBack.push(p.filename);
        deps.logger.success(`Rolled back ${p.filename}`);
      }
    },
    {
      command: deps.lockCommand ?? "nextly migrate:down",
      // A held lock is waited for, about a minute, and then the run stops naming its holder.
      mode: "wait",
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
  acceptDataLoss?: AcceptDataLossOption;
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

/**
 * Everything `migrateDownCore` reads from and writes to the database, built
 * on one adapter: the ledger, the owner registry, the live schema the guards
 * judge, and how a DOWN runs and is recorded.
 *
 * A DOWN runs through `runMigrationStatements`, and its `rolled_back` row —
 * both the row and its retiring the applied one (`resolveMigration`) — and a
 * plugin's schema version are written through the handle it ran on, so in
 * a transaction they commit with its statements or not at all. The newest
 * row is read through that handle too: one no longer `applied` is another
 * run's rollback, which `migrateDownCore` refuses as a lost race.
 *
 * A database `nextly migrate` has not yet given the owner registry reads as
 * no owner rows, as it does for `nextly migrate`'s own guard, and has no
 * owner rows for a schema version to be written onto.
 */
export async function downDatabaseDeps(args: {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  /** The plugin whose modules are rolled back, and the modules it ships. */
  plugin?: {
    name: string;
    migrations: ReadonlyArray<{ name: string; schemaVersion: number }>;
  };
  /** The command a failed DOWN's ledger note names; `migrate:down` if absent. */
  command?: string;
}): Promise<
  Pick<
    MigrateDownCoreDeps,
    | "dialect"
    | "db"
    | "adapter"
    | "owners"
    | "elementOwners"
    | "readOwners"
    | "readLiveColumns"
    | "readLiveElements"
    | "readLiveTables"
    | "readLiveIndexTables"
    | "listFileApplies"
    | "execDown"
    | "recordRolledBack"
    | "recordPluginSchemaVersion"
    | "recordFailed"
  >
> {
  const { adapter, dialect, plugin } = args;
  const db = adapter.getDrizzle();
  const repo = new SchemaEventsRepository(db, dialect);
  const {
    SchemaOwnersRepository: OwnersRepo,
    schemaOwnersTableExists,
    tableOwnersByName,
  } = await import("../../domains/schema/ownership/schema-owners-repository");
  // Read through one function, so the plan made inside the lock reads the registry the same way.
  let registryExists = false;
  const readOwnerRows = async () => {
    registryExists = await schemaOwnersTableExists(adapter);
    return registryExists ? await new OwnersRepo(db, dialect).read() : [];
  };
  const ownerRows = await readOwnerRows();
  return {
    dialect,
    db,
    adapter,
    owners: tableOwnersByName(ownerRows),
    elementOwners: ownerRows,
    readOwners: async () => {
      const fresh = await readOwnerRows();
      return { owners: tableOwnersByName(fresh), elementOwners: fresh };
    },
    readLiveColumns: lists => readLiveColumns(db, dialect, lists),
    readLiveElements: lists => readLiveElements(db, dialect, lists),
    readLiveTables: lists => readLiveTables(db, dialect, lists),
    readLiveIndexTables: lists => readLiveIndexTables(db, dialect, lists),
    listFileApplies: () => repo.listFileApplies(),
    execDown: (statements, unit, after) =>
      runMigrationStatements(adapter, statements, unit, handle =>
        after(handle)
      ),
    recordRolledBack: async (filename, handle) => {
      const bound = repo.boundTo(handle);
      if (!(await bound.isFileApplied(filename))) return false;
      await resolveMigration({
        mode: "rolled-back",
        filename,
        dialect,
        repo: bound,
        // rolled-back mode does not read these; provide inert resolvers.
        fileExists: () => Promise.resolve(true),
        loadTargetSnapshot: () => Promise.resolve(null),
        marksNoTransaction: () => Promise.resolve(false),
        introspectLive: () => Promise.resolve({ tables: [] }),
      });
      return true;
    },
    recordPluginSchemaVersion: async handle => {
      if (plugin === undefined || !registryExists) return;
      await recordPluginSchemaVersionFromLedger({
        plugin: plugin.name,
        migrations: plugin.migrations,
        listFileApplies: () => repo.boundTo(handle).listFileApplies(),
        owners: new OwnersRepo(handle, dialect),
      });
    },
    recordFailed: (filename, message, transaction) =>
      recordRollbackFailed({
        repo,
        filename,
        dialect,
        transaction,
        note: `${args.command ?? "migrate:down"} failed: ${message}`,
      }),
  };
}

/** The named plugin and the modules its definition ships, if one is named. */
function pluginModules(
  plugins:
    | ReadonlyArray<{
        name: string;
        contributes?: {
          schema?: {
            migrations?: ReadonlyArray<{ name: string; schemaVersion: number }>;
          };
        };
      }>
    | undefined,
  name: string | undefined
):
  | {
      name: string;
      migrations: ReadonlyArray<{ name: string; schemaVersion: number }>;
    }
  | undefined {
  if (name === undefined) return undefined;
  const definition = (plugins ?? []).find(p => p.name === name);
  return {
    name,
    migrations: definition?.contributes?.schema?.migrations ?? [],
  };
}

/**
 * `migrate:down`'s data-loss consent: `--accept-data-loss` or
 * `NEXTLY_ACCEPT_DATA_LOSS`, with `--allow-data-loss` honoured as the earlier
 * spelling and named deprecated.
 */
export function downConsent(
  options: Pick<MigrateDownCommandOptions, "acceptDataLoss" | "allowDataLoss">,
  warn: (message: string) => void
): DataLossConsent {
  return readDataLossConsent({
    flag: options.acceptDataLoss,
    honours: ["--allow-data-loss"],
    earlierFlags: options.allowDataLoss ? ["--allow-data-loss"] : [],
    warn,
  });
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

    const readDownSql = async (filename: string): Promise<MigrationDown> => {
      const pluginName = pluginOfLedgerRow(filename);
      if (pluginName !== null) {
        // A plugin module is read from the plugin's definition, verified as
        // the module that was applied — the read `plugins uninstall` makes,
        // through the same function — and joined the way the apply path
        // joins its UP. The core splits it with the splitter
        // `pluginModuleStatements` uses, so the guards read, and `execDown`
        // runs, the statements the module's DOWN holds.
        const definition = (configResult.config.plugins ?? []).find(
          p => p.name === pluginName
        );
        return pluginModuleDown({
          pluginName,
          migrations: definition?.contributes?.schema?.migrations ?? [],
          filename,
          recordedSha: await recordedSha(filename),
          dialect,
        });
      }
      const name = filename.endsWith(".sql") ? filename : `${filename}.sql`;
      const content = await readFile(resolve(migrationsDir, name), "utf-8");
      return {
        sql: parseSqlSections(content).downSql,
        transaction: !marksNoTransaction(content),
      };
    };

    const plugin = options.plugin;
    const result = await migrateDownCore({
      ...(await downDatabaseDeps({
        adapter: adapter as unknown as DrizzleAdapter,
        dialect,
        plugin: pluginModules(configResult.config.plugins, plugin),
      })),
      nodeEnv: process.env.NODE_ENV,
      logger,
      options: {
        step: options.step,
        consent: downConsent(options, m => logger.warn(m)),
        yes: options.yes,
        dryRun: options.dryRun,
        plugin,
      },
      fileExists: () => Promise.resolve(true),
      readDownSql,
      withLock: withMigrateLock,
      interactive: isInteractiveTerminal(),
      askToDelete: askToDeleteInTerminal,
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
    .option("--accept-data-loss [targets]", ACCEPT_DATA_LOSS_HELP)
    .option("--allow-data-loss", "Deprecated: use --accept-data-loss", false)
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
