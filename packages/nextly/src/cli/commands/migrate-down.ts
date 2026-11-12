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
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import {
  filesWithinStep,
  stepContinuedNotice,
  stepFileOf,
  type StepFile,
} from "../../domains/i18n/migration/step-windows";
import {
  isPluginLedgerRow,
  ledgerFilename,
  pluginOfLedgerRow,
  scopeLedgerRows,
} from "../../domains/schema/events/ledger-scope";
import {
  removedOnPurpose,
  standingsByFilename,
} from "../../domains/schema/events/migration-state";
import { newestEventsByFilename } from "../../domains/schema/events/newest-event";
import {
  SchemaEventsRepository,
  type SchemaEventRow,
  truncateErrorMessage,
} from "../../domains/schema/events/schema-events-repository";
import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import {
  consentToCover,
  describeDeletion,
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
  readDeletionFacts,
  runDeletions,
  runStatements,
  type DeletionFacts,
} from "../../domains/schema/migrate/file-deletions";
import {
  outsideTransactionNotice,
  runMigrationStatements,
  type MigrationUnit,
} from "../../domains/schema/migrate/migration-transaction";
import { readOldBuilderLedger } from "../../domains/schema/migrate/old-builder-ledger";
import {
  compareModuleNames,
  qualifiedFilename,
} from "../../domains/schema/migrate/plugin/plugin-migration";
import { recordPluginSchemaVersionFromLedger } from "../../domains/schema/migrate/plugin/plugin-schema-version";
import { refuseRequiredColumnsOverNulls } from "../../domains/schema/migrate/required-column-guard";
import { resolveMigration } from "../../domains/schema/migrate/resolve";
import { declaredNamesOf } from "../../domains/schema/migrate/resolved-schema";
import {
  planRollbackBookkeeping,
  type RollbackBookkeeping,
} from "../../domains/schema/migrate/rollback-to-record";
import {
  assertRunnableStatements,
  marksNoTransaction,
  splitSqlStatements,
} from "../../domains/schema/migrate/split-sql";
import { parseSqlSections } from "../../domains/schema/migrate/sql-sections";
import {
  assertNoForeignDrops,
  columnsAfter,
  liveTablesAfter,
  readLiveColumns,
  readLiveElements,
  readLiveIndexTables,
  readLiveTables,
  type LiveColumns,
  type LiveElements,
} from "../../domains/schema/ownership/drop-guard";
import type { OwnerRecord } from "../../domains/schema/ownership/owner-registry";
import { readDdlEventTriggers } from "../../domains/schema/pipeline/live-table-facts";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import {
  storeSchemaVersion,
  newestAppliedAppMigration,
} from "../../domains/schema/schema-version";
import { describeError } from "../../errors/index";
import { NextlyError } from "../../errors/nextly-error";
import { exitWithError } from "../errors";
import type { CommandContext } from "../program";
import type { SupportedDialect } from "../utils/adapter";
import { openMigrationCommand } from "../utils/command-prerequisites";
import {
  askToDeleteInTerminal,
  deletionSource,
  eventTriggerNotice,
  judgeRunDeletions,
  type Agreement,
  type DeletionSource,
  readDataLossConsent,
  type AcceptDataLossOption,
} from "../utils/data-loss-consent";
import {
  compareMigrationBaseNames,
  type DeclaredNames,
} from "../utils/migration-discovery";

import { commandRun } from "./command-run";
import { assertAppHistoryHolds, migrateExitCode } from "./migrate";
import {
  pluginModuleDown,
  recordRollbackFailed,
} from "./plugin-module-rollback";

/**
 * What each target of a rollback deletes, named, for the consent to cover:
 * the DOWNs read as one run, in the order they run (`runDeletions`), so a
 * target is judged against the schema the targets before it leave, and a
 * foreign key an earlier DOWN restores is followed from a later one's
 * removal of rows. App migrations and plugin modules are read alike.
 *
 * The live facts are read once, for every target's statements. Without a
 * reader none is known: every removal's reach, trigger and inheritance tree
 * stands for a deletion only the consent without targets covers, and the
 * live columns are the ones the plan read (`readLiveState`).
 */
export async function rollbackDeletions(
  planned: readonly Pick<PlannedDown, "statements" | "liveColumns">[],
  dialect: SupportedDialect,
  readFacts:
    | ((statements: readonly string[]) => Promise<DeletionFacts>)
    | undefined
): Promise<Deletion[][]> {
  const lists = planned.map(p => p.statements);
  const facts =
    (await readFacts?.(runStatements(lists))) ??
    unreadFacts(planned[0]?.liveColumns);
  return runDeletions(lists, dialect, facts);
}

/** The facts of a rollback with no reader: nothing live answered, so each question fails closed. */
function unreadFacts(liveColumns: LiveColumns | undefined): DeletionFacts {
  return {
    cascadeFrom: () => undefined,
    truncateCascadeFrom: () => undefined,
    nulledBy: () => undefined,
    hiddenCode: () => undefined,
    descendantsOf: () => undefined,
    liveTable: () => undefined,
    liveColumns: liveColumns ?? new Map(),
  };
}

/**
 * Newest-applied-first filenames, limited to `step`. A file counts as applied
 * when its standing says so (`standingsByFilename`): an app migration's latest
 * outcome is `applied` (a later rolled_back retires it; an attempt that failed
 * or stopped does not), a plugin module's newest record is. Ordered by that
 * applied record's startedAt, descending.
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
  for (const [filename, standing] of standingsByFilename(rows)) {
    if (standing.state === "applied" && standing.outcome !== undefined) {
      applied.push({ filename, at: standing.outcome.startedAt.getTime() });
    }
  }
  applied.sort(
    (a, b) => b.at - a.at || laterInRunOrder(a.filename, b.filename, plugin)
  );
  return applied.slice(0, Math.max(0, step)).map(a => a.filename);
}

/**
 * The files `migrate:down --step` rolls back, newest first: `step` of them, and on through a move
 * between translated and shared it would otherwise end inside, saying so (`filesWithinStep`). Each
 * applied file is read for what it is for; one that is missing or can't be read opens and closes
 * nothing, and its own refusal comes from `planRollback` if it is a target. `reads` hands those
 * reads on, so the plan is made from the DOWN the window was judged from, read once per pass. A
 * plugin's modules move no translation, so its stream keeps to the step.
 */
async function targetsWithinStep(
  rows: SchemaEventRow[],
  step: number,
  deps: Pick<
    MigrateDownCoreDeps,
    "options" | "fileExists" | "readDownSql" | "logger"
  >,
  notify: boolean
): Promise<{ targets: string[]; reads?: ReadonlyMap<string, DownRead> }> {
  if (deps.options.plugin !== undefined) {
    return {
      targets: selectAppliedTargets(rows, step, deps.options.plugin),
    };
  }
  const applied = selectAppliedTargets(rows, Number.POSITIVE_INFINITY);
  const reads = new Map<string, DownRead>();
  const files = await Promise.all(
    applied.map(async filename => {
      if (!(await deps.fileExists(filename))) {
        return { filename, ...NO_STEP_FILE };
      }
      const read = await readDown(filename, deps);
      reads.set(filename, read);
      const stepFile = "down" in read ? read.down.stepFile : undefined;
      return { filename, ...(stepFile ?? NO_STEP_FILE) };
    })
  );
  const within = filesWithinStep(
    files.map(file => ({ file, done: false })),
    step,
    "down"
  );
  if (notify && within.continued !== undefined) {
    deps.logger.info(stepContinuedNotice(within.continued));
  }
  return { targets: within.run.map(f => f.filename), reads };
}

const NO_STEP_FILE: StepFile = { collections: [], singles: [], components: [] };

/** A file's DOWN, or why it couldn't be read, which `planRollback` turns into its refusal. */
type DownRead = { down: MigrationDown } | { unreadable: unknown };

async function readDown(
  filename: string,
  deps: Pick<MigrateDownCoreDeps, "readDownSql">
): Promise<DownRead> {
  try {
    return { down: await deps.readDownSql(filename) };
  } catch (unreadable) {
    return { unreadable };
  }
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
   * Store the database's schema version after an app migration's DOWN,
   * through `db`, the handle the DOWN and its `rolled_back` row were written
   * on: its migration becomes the newest one still applied, so the version
   * moves back with the registry rows the DOWN wrote, in its transaction.
   *
   * Optional so a caller with no schema version to keep supplies nothing.
   */
  recordSchemaVersion?: (db: unknown) => Promise<void>;
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
   * Records, durably and before the first statement, that a DOWN started:
   * an attempt with no outcome yet (`downStartRecordedFirst`). Returns its id.
   * Optional so a caller with no ledger of its own supplies nothing, and the
   * DOWN is recorded only once it ends, as it was before.
   */
  recordDownStarted?: (filename: string) => Promise<string>;
  /**
   * Refuses a DOWN whose statements make a column required over rows that would break it,
   * counted before its first statement and before the ledger records an attempt
   * (`refuseRequiredColumnsOverNulls`, as `nextly migrate` judges an UP). A DOWN can make a column
   * required again over rows saved since its UP ran. `source` is the file's name. Optional so a
   * caller with no database of its own supplies nothing.
   */
  refuseRequiredColumns?: (
    statements: readonly string[],
    source: string
  ) => Promise<void>;
  /**
   * Removes a DOWN's started attempt once its ending is recorded, through
   * `db`: the handle the rolled-back row was written on when it ended in a
   * rollback, so the two commit together. The ending's own record then says
   * how the attempt ended.
   */
  endDownAttempt?: (id: string, db?: unknown) => Promise<void>;
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
   * The live facts a target's DOWN deletions are judged against: the foreign
   * keys a row removal cascades through (`readDeletionFacts`). Absent, no
   * foreign key is known, and a cascading removal needs the consent without
   * targets.
   */
  readDeletionFacts?: (statements: readonly string[]) => Promise<DeletionFacts>;
  /**
   * The database's enabled DDL event triggers, named beside a rollback's
   * deletions (`eventTriggerNotice`). Absent, none is named.
   */
  readEventTriggers?: () => Promise<readonly string[]>;
  /**
   * The app history checks every command that rolls back app migrations
   * makes before its first write (`assertAppHistoryHolds`): an applied
   * migration the folder lacks (exit 3), an unresolved attempt, its own down
   * section's included, and an applied file edited since it ran (exit 2).
   * Asked under the lock before the plan, for the app's stream only: a
   * plugin's history keeps its own rules. `recordChecksums` is false for a
   * dry run, which writes nothing. The command supplies it; absent, a caller
   * with no migrations folder of the app's, nothing is read.
   */
  checkAppHistory?: (args: { recordChecksums: boolean }) => Promise<void>;
  /**
   * The app migrations whose file's removal `migrate:resolve --removed`
   * recorded: such a migration stays applied, and a rollback reaching it while
   * its file is absent is refused by name (`refuseRemovedTargets`).
   */
  removedFiles?: () => Promise<ReadonlySet<string>>;
  /**
   * Whether a person is at a terminal to be asked before a DOWN loses data.
   * Absent reads as no, so a rollback without consent is refused rather than
   * run.
   */
  interactive?: boolean;
  /** Asks that person a yes-or-no question; only called when `interactive`. */
  askToDelete?: (question: string) => Promise<boolean>;
  /**
   * What rolling back `targets` does with the database's registry record
   * (`planRollbackBookkeeping`), read from `rows`, the ledger rows the targets
   * were chosen from: a refusal where the point it leaves has nothing recording
   * the registry, thrown before anything runs, or the bookkeeping to undo where
   * that point is the record's. Asked for the app's stream only, in both plans;
   * absent, a caller with no record to keep reads as having none.
   */
  registryBookkeeping?: (args: {
    rows: readonly SchemaEventRow[];
    targets: readonly string[];
  }) => Promise<RollbackBookkeeping>;
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
  /**
   * What the file is for and the entities it names, which `--step` reads so it never ends inside
   * a move between translated and shared (`filesWithinStep`). Absent for a plugin's module, which
   * moves no translation.
   */
  stepFile?: StepFile;
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
      logContext: { filename: p.filename, reason: "down-sql-missing" },
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
    | "recordSchemaVersion"
    | "recordFailed"
    | "recordDownStarted"
    | "endDownAttempt"
    | "refuseRequiredColumns"
  >,
  /**
   * Run in the DOWN's transaction after its statements and before its
   * rollback is recorded: the registry rows of the entities whose field types
   * this DOWN changes back (`RollbackBookkeeping.perFile`), and, for the last
   * target, the one that reaches the point, the bookkeeping a rollback to the
   * registry record's point undoes (`RollbackBookkeeping.restore`). In a
   * transaction it commits with
   * the DOWN, or neither does. On MySQL, whose schema statements commit as
   * they run, a failure here leaves the migration recorded applied with its
   * rollback recorded failed and possibly partial, as any DOWN stopped
   * part-way there, rather than recorded rolled back with part of its
   * bookkeeping undone.
   */
  atPoint?: () => Promise<void>
): Promise<void> {
  // A column made required over rows that would break it: refused here, before the DOWN's first
  // statement and before the ledger records an attempt, so the migration stays applied.
  await deps.refuseRequiredColumns?.(p.statements, p.filename);
  if (!p.transaction) {
    deps.logger.warn(outsideTransactionNotice(p.filename));
  }
  const partial = failedAttemptMayBePartial(p, deps.dialect);
  // Before the first statement, where a stop can leave part of the DOWN
  // committed: the ledger then shows an attempt with no outcome, and the
  // migration stays recorded applied until the DOWN's last statement ran.
  const attempt = downStartRecordedFirst(p, deps.dialect)
    ? await deps.recordDownStarted?.(p.filename)
    : undefined;
  try {
    await deps.execDown(
      p.statements,
      { source: p.filename, transaction: p.transaction, direction: "down" },
      async db => {
        await atPoint?.();
        if (!(await deps.recordRolledBack(p.filename, db))) {
          throw concurrentRunError({
            filename: p.filename,
            direction: "down",
            partial,
          });
        }
        if (deps.options.plugin) await deps.recordPluginSchemaVersion?.(db);
        // An app migration's DOWN moves the stored schema version back, after
        // its `rolled_back` row, so the ledger it is read from is current.
        else await deps.recordSchemaVersion?.(db);
        // The rollback is recorded, and it resolves the start row, which is
        // older: failing to remove that row never fails a DOWN whose
        // statements ran. A start row is recorded only where a failed write
        // leaves the transaction usable (MySQL, or no transaction at all).
        if (attempt !== undefined) {
          await deps.endDownAttempt?.(attempt, db).catch(() => undefined);
        }
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
    // Recorded failed above; a lost race rolled back whole left nothing to
    // record, and the other run's rollback is the migration's outcome. A
    // start row left behind reads as a stopped DOWN, which is still true, so
    // failing to remove it never hides the DOWN's own error.
    if (attempt !== undefined) {
      await deps.endDownAttempt?.(attempt).catch(() => undefined);
    }
    throw err;
  }
}

/**
 * Whether a DOWN's attempt is recorded before its first statement: an app
 * migration's DOWN wherever a stop can leave part of it committed
 * (`failedAttemptMayBePartial`, the predicate an UP's attempt is recorded
 * by). A plugin module's DOWN keeps its history's record, written once it
 * ends.
 */
function downStartRecordedFirst(
  p: Pick<PlannedDown, "filename" | "transaction">,
  dialect: SupportedDialect
): boolean {
  return (
    !isPluginLedgerRow(p.filename) && failedAttemptMayBePartial(p, dialect)
  );
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
  >,
  reads?: ReadonlyMap<string, DownRead>
): Promise<PlannedDown[]> {
  const planned: PlannedDown[] = [];
  for (const filename of filenames) {
    // A DOWN `targetsWithinStep` read for this pass is planned as it was read, not read again.
    const read = reads?.get(filename) ?? (await readDown(filename, deps));
    planned.push(plannedFrom(filename, read, deps.dialect));
  }
  await readLiveState(planned, deps);
  return planned;
}

/** One target's plan from its DOWN, or the reason it can't be planned. */
function plannedFrom(
  filename: string,
  read: DownRead,
  dialect: SupportedDialect
): PlannedDown {
  let unreadable: unknown = "unreadable" in read ? read.unreadable : undefined;
  if ("down" in read) {
    try {
      const downSql = read.down.sql.trim();
      return {
        filename,
        downSql,
        transaction: read.down.transaction,
        statements: splitSqlStatements(downSql, dialect, read.down),
      };
    } catch (error) {
      unreadable = error;
    }
  }
  return {
    filename,
    downSql: "",
    transaction: true,
    statements: [],
    unreadable,
  };
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
  agreed?: Agreement
): Promise<GuardedPlan> {
  const step = deps.options.step ?? 1;
  // Plugin rows belong to their own migration stream, so they are excluded
  // unless `--plugin` names one; an unscoped run must never revert a plugin's
  // migration while reporting an app rollback.
  const rows = scopeLedgerRows(
    await deps.listFileApplies(),
    deps.options.plugin
  );
  const { targets, reads } = await targetsWithinStep(
    rows,
    step,
    deps,
    agreed === undefined
  );
  if (targets.length === 0) return { planned: [], agreement: new Set() };
  const planned = refuseRemovedTargets(
    await planRollback(targets, deps, reads),
    (await deps.removedFiles?.()) ?? new Set()
  );
  const bookkeeping = await bookkeepingOf(deps, rows, targets);
  if (deps.options.dryRun) {
    return { planned, agreement: new Set(), bookkeeping };
  }

  // Guards — evaluated up front for every target, before executing anything.
  for (const p of planned) {
    const refusal = refusalOf(p, deps);
    if (refusal !== undefined) throw refusal;
  }
  // A point nothing records the registry at is refused before anything runs,
  // and before the data-loss consent is asked for a rollback that cannot run.
  if (bookkeeping?.refusal !== undefined) throw bookkeeping.refusal;

  // A DOWN that loses data takes the data-loss consent, judged once for
  // every target before the first runs, by the deletions their statements
  // make (`downDeletions`), each file named above its own.
  const consent =
    deps.options.consent ??
    resolveDataLossConsent({
      honours: ["--allow-data-loss"],
      earlierFlags: deps.options.allowDataLoss ? ["--allow-data-loss"] : [],
    });
  // Each deletion keeps the file it comes from, by identity, for the listing
  // and for binding an agreement to the file as it stands.
  const sources = new Map<Deletion, DeletionSource>();
  const perTarget = await rollbackDeletions(
    planned,
    deps.dialect,
    deps.readDeletionFacts
  );
  planned.forEach((p, at) => {
    const source = deletionSource(p.filename, p.statements.join("\n;\n"));
    for (const deletion of perTarget[at] ?? []) sources.set(deletion, source);
  });
  const agreement = await judgeRunDeletions({
    sources,
    consent,
    agreed,
    interactive: deps.interactive,
    askToDelete: deps.askToDelete,
    warn: line => deps.logger.warn(line),
    notice:
      sources.size === 0 || deps.readEventTriggers === undefined
        ? undefined
        : await eventTriggerNotice(deps.readEventTriggers),
  });
  return { planned, agreement, bookkeeping };
}

/**
 * What `migrate:down --dry-run` reports of a plan: the refusal a real run
 * makes under the lock, each target with its refusal or what its DOWN deletes
 * and the SQL it runs, and the database's DDL event triggers.
 */
async function previewRollback(
  planned: readonly PlannedDown[],
  deps: MigrateDownCoreDeps,
  bookkeeping: RollbackBookkeeping | undefined
): Promise<void> {
  // The refusals a real run makes under the lock, reported as the others are.
  await reportUnresolvedRefusal(deps);
  reportBookkeeping(bookkeeping, deps.logger);
  deps.logger.info(`Would roll back ${planned.length} migration(s):`);
  const notice =
    deps.readEventTriggers === undefined
      ? undefined
      : await eventTriggerNotice(deps.readEventTriggers);
  if (notice !== undefined) deps.logger.info(`  ⚠ ${notice}`);
  // Judged as the real run judges them: every target's DOWN as one run.
  const perTarget = await rollbackDeletions(
    planned,
    deps.dialect,
    deps.readDeletionFacts
  );
  for (const [at, p] of planned.entries()) {
    deps.logger.info(`  • ${p.filename}`);
    const refusal = refusalOf(p, deps);
    if (refusal !== undefined) {
      deps.logger.info(
        `    ✖ a real run would be refused: ${describeError(refusal, { context: false })}`
      );
      continue;
    }
    const deletes = perTarget[at] ?? [];
    if (deletes.length > 0) {
      deps.logger.info(
        `    ⚠ deletes data: ${deletes.map(describeDeletion).join("; ")}. A real run needs ${consentToCover(deletes)}.`
      );
    }
    if (!p.transaction) {
      deps.logger.info(`    ⚠ ${outsideTransactionNotice(p.filename)}`);
    }
    deps.logger.info(p.downSql);
  }
}

/** A rollback's plan once every guard has passed, and what the operator agreed it deletes. */
interface GuardedPlan {
  planned: PlannedDown[];
  /** What the operator agreed the targets delete, bound to each file as it stood. */
  agreement: Agreement;
  /** What the rollback does with the registry record (`MigrateDownCoreDeps.registryBookkeeping`). */
  bookkeeping?: RollbackBookkeeping;
}

export async function migrateDownCore(
  deps: MigrateDownCoreDeps
): Promise<MigrateDownResult> {
  // Before the plan, which reads each target's down section: a build lacking
  // an applied file stops on the history (exit 3), not on the read of the
  // file it lacks. Read-only here; asked again under the lock. A dry run
  // reports the refusal after its plan instead.
  if (!deps.options.dryRun) {
    const refused = await refusalOfHistory(deps, false);
    if (refused !== undefined) throw refused;
  }
  const guarded = await planAndGuard(deps);
  const planned = guarded.planned;
  const lockOptions = {
    command: deps.lockCommand ?? "nextly migrate:down",
    // A held lock is waited for, about a minute, and then the run stops naming its holder.
    mode: "wait" as const,
    logger: {
      warn: (m: string) => deps.logger.warn(m),
      info: (m: string) => deps.logger.info(m),
    },
  };

  if (planned.length === 0) {
    // Nothing to roll back still refuses on an unresolved attempt, judged under
    // the lock as a run with targets is: the command must not read as having
    // found the history sound while an attempt stands unresolved.
    if (
      !deps.options.dryRun &&
      deps.options.plugin === undefined &&
      deps.checkAppHistory !== undefined
    ) {
      await deps.withLock(
        lockAdapter(deps),
        deps.dialect,
        async () => {
          const unresolved = await refusalOfHistory(deps, true);
          if (unresolved !== undefined) throw unresolved;
        },
        lockOptions
      );
    }
    // A dry run reports the same refusal, as it does with targets.
    if (deps.options.dryRun) await reportUnresolvedRefusal(deps);
    deps.logger.info("Nothing to roll back.");
    return { rolledBack: [] };
  }

  // Dry-run is a non-destructive preview: it never throws and never
  // executes. Every refusal a real run would make is reported instead, by
  // the same function that makes it, so the preview and the run cannot
  // disagree; so is what a real run would need the data-loss consent for, so
  // the operator can read the DOWN SQL before deciding to give it.
  if (deps.options.dryRun) {
    await previewRollback(planned, deps, guarded.bookkeeping);
    return { rolledBack: [] };
  }

  if (deps.nodeEnv === "production" && !deps.options.yes) {
    throw NextlyError.invalidInput({
      message:
        "Refusing to roll back in production without --yes. Prefer rolling forward with a corrective migration, or restore from backup. Re-run with --yes to override.",
      logContext: { reason: "production-needs-yes" },
    });
  }

  const rolledBack: string[] = [];
  await deps.withLock(
    lockAdapter(deps),
    deps.dialect,
    async () => {
      // Before the plan and the first write, from the ledger as it stands
      // once the lock is held: an older build rolling back a history it does
      // not hold, an edited down section, or a DOWN retried over its own
      // stopped attempt, which would run statements that already ran.
      const unresolved = await refusalOfHistory(deps, true);
      if (unresolved !== undefined) throw unresolved;
      // Planned again under the lock, from the database as it stands now; see `planAndGuard`.
      const held = { ...deps, ...(await deps.readOwners?.()) };
      const { planned: current, bookkeeping } = await planAndGuard(
        held,
        guarded.agreement
      );
      if (current.length === 0) {
        deps.logger.info("Nothing to roll back.");
        return;
      }
      for (const [at, p] of current.entries()) {
        // The last target is the one that reaches the point the rollback
        // leaves, so the bookkeeping there commits with its DOWN. A DOWN that
        // changes a field's type back writes its entity's row with it first.
        const last = at === current.length - 1;
        await rollBackOne(
          p,
          held,
          inTurn(
            bookkeeping?.perFile?.get(p.filename),
            last ? bookkeeping?.restore : undefined
          )
        );
        rolledBack.push(p.filename);
        deps.logger.success(`Rolled back ${p.filename}`);
      }
      // The rolled-back migrations' own registry changes, undone once the
      // last DOWN has run, under the same lock. Every DOWN has committed by
      // now, so a failure here is said beside the rollback rather than
      // reported as one: a rollback re-run on that report would roll back
      // the migration before as well.
      try {
        await bookkeeping?.afterAll?.();
      } catch (error) {
        deps.logger.warn(
          `The rollback is done, but the registry rows were not brought back to the point it reached: ${describeError(error, { context: false })}. ` +
            "Run `nextly migrate`, which writes the rows the newest applied snapshot records."
        );
      }
    },
    lockOptions
  );

  return { rolledBack };
}

/** Each of `steps` given, one after the other; undefined where none is. */
function inTurn(
  ...steps: ReadonlyArray<(() => Promise<void>) | undefined>
): (() => Promise<void>) | undefined {
  const given = steps.filter(
    (step): step is () => Promise<void> => step !== undefined
  );
  if (given.length === 0) return undefined;
  return async () => {
    for (const step of given) await step();
  };
}

/**
 * What rolling back `targets` does with the registry record
 * (`MigrateDownCoreDeps.registryBookkeeping`): asked of the app's stream
 * alone, since a plugin's modules carry no registry rows.
 */
async function bookkeepingOf(
  deps: Pick<MigrateDownCoreDeps, "options" | "registryBookkeeping">,
  rows: readonly SchemaEventRow[],
  targets: readonly string[]
): Promise<RollbackBookkeeping | undefined> {
  if (deps.options.plugin !== undefined) return undefined;
  return deps.registryBookkeeping?.({ rows, targets });
}

/** A dry run's line for what a real run does with the registry record. */
function reportBookkeeping(
  bookkeeping: RollbackBookkeeping | undefined,
  logger: MigrateDownCoreDeps["logger"]
): void {
  if (bookkeeping?.refusal !== undefined) {
    logger.info(
      `✖ a real run would be refused: ${describeError(bookkeeping.refusal, { context: false })}`
    );
  } else if (bookkeeping?.summary !== undefined) {
    logger.info(bookkeeping.summary);
  }
}

/** A dry run's line for the unresolved-attempt refusal a real run would make. */
async function reportUnresolvedRefusal(
  deps: Pick<MigrateDownCoreDeps, "options" | "checkAppHistory" | "logger">
): Promise<void> {
  // Read-only: a dry run records no checksum.
  const unresolved = await refusalOfHistory(deps, false);
  if (unresolved === undefined) return;
  deps.logger.info(
    `✖ a real run would be refused: ${describeError(unresolved, { context: false })}`
  );
}

/**
 * The app history checks' refusal (`checkAppHistory`), or undefined: a real
 * run throws it under the lock, a dry run reports it. Never for a plugin's
 * stream (`--plugin`).
 */
async function refusalOfHistory(
  deps: Pick<MigrateDownCoreDeps, "options" | "checkAppHistory">,
  recordChecksums: boolean
): Promise<Error | undefined> {
  if (deps.options.plugin !== undefined) return undefined;
  try {
    await deps.checkAppHistory?.({ recordChecksums });
    return undefined;
  } catch (refusal) {
    return asError(refusal);
  }
}

/**
 * A target whose file is absent because its removal was recorded on purpose
 * (`removedFiles`) has no DOWN to run: it is refused by name, rather than
 * with the read error its absent file gives.
 */
function refuseRemovedTargets(
  planned: PlannedDown[],
  removed: ReadonlySet<string>
): PlannedDown[] {
  return planned.map(p =>
    p.unreadable !== undefined && removed.has(p.filename)
      ? {
          ...p,
          unreadable: NextlyError.invalidInput({
            message: `\`${p.filename}\` is recorded as removed from the migrations folder on purpose, so \`nextly migrate:down\` cannot roll it back while its file is absent. Put the file back as it was, and the rollback runs its down section.`,
            logContext: { filename: p.filename, reason: "down-file-removed" },
          }),
        }
      : p
  );
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
  /**
   * The app's migrations folder. Given, with no plugin, the rows of its old
   * Schema Builder files are no migration to roll back, as every reader
   * leaves them out (`readOldBuilderLedger`).
   */
  migrationsDir?: string;
  /** What the run's declared schema names, which old Builder files are judged against. */
  declared?: DeclaredNames;
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
    | "readDeletionFacts"
    | "readEventTriggers"
    | "listFileApplies"
    | "execDown"
    | "recordRolledBack"
    | "recordPluginSchemaVersion"
    | "recordSchemaVersion"
    | "recordFailed"
    | "recordDownStarted"
    | "endDownAttempt"
    | "refuseRequiredColumns"
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
  // Read once, before any DOWN opens its transaction: a database that has no
  // `nextly_meta` table yet stores no schema version, and a DOWN's version
  // write must not fail the DOWN there.
  const versionTableExists =
    plugin === undefined && (await adapter.tableExists("nextly_meta"));
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
    readDeletionFacts: statements => readDeletionFacts(db, dialect, statements),
    readEventTriggers: () => readDdlEventTriggers(db, dialect),
    listFileApplies: async () => {
      const rows = await repo.listFileApplies();
      if (plugin !== undefined || args.migrationsDir === undefined) return rows;
      const { ignoredRows } = await readOldBuilderLedger(
        {
          migrationsDir: args.migrationsDir,
          dialect,
          declared: args.declared,
        },
        repo,
        rows
      );
      return rows.filter(
        row => row.filename === null || !ignoredRows.has(row.filename)
      );
    },
    refuseRequiredColumns: (statements, source) =>
      refuseRequiredColumnsOverNulls(db, dialect, statements, source),
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
        fileChecksum: () => Promise.resolve(""),
        introspectLive: () => Promise.resolve({ tables: [] }),
      });
      return true;
    },
    recordSchemaVersion: async handle => {
      if (!versionTableExists) return;
      await storeSchemaVersion(handle, dialect, {
        wrote: false,
        migration: newestAppliedAppMigration(
          await repo.boundTo(handle).listFileApplies()
        ),
      });
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
    recordDownStarted: filename =>
      repo.recordStart({
        eventType: "file_rollback",
        source: "cli-migrate",
        filename: ledgerFilename(filename),
      }),
    endDownAttempt: (id, handle) =>
      (handle === undefined ? repo : repo.boundTo(handle)).discardAttempt(id),
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

  const opened = await openMigrationCommand(options, logger);
  // A dry run whose database is not there has said so, and ends here.
  if (opened === undefined) return;
  const { dbValidation, configResult, migrationsDir, adapter } = opened;
  // The project root the definition file is read from, as the command was run.
  const cwd = options.cwd ?? process.cwd();
  const dialect = dbValidation.dialect;

  try {
    const db = (adapter as unknown as DrizzleAdapter).getDrizzle();
    const repo = new SchemaEventsRepository(db, dialect);
    // Read as `nextly migrate` reads the folder, for an app rollback only: a
    // plugin's DOWNs come from its definition, never from the app's folder,
    // so the app's manifest has nothing to say about them.
    const declared =
      options.plugin === undefined
        ? await declaredNamesOf({ ...configResult, projectRoot: cwd })
        : undefined;

    // A dry run clears no lock, which may be an active operation's; it says a
    // real run would.
    if (options.forceUnlock && options.dryRun) {
      logger.info("Would remove any migrate lock held");
    } else if (options.forceUnlock) {
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
        stepFile: stepFileOf(content, name),
      };
    };

    const plugin = options.plugin;
    const result = await migrateDownCore({
      ...(await downDatabaseDeps({
        adapter: adapter as unknown as DrizzleAdapter,
        dialect,
        plugin: pluginModules(configResult.config.plugins, plugin),
        migrationsDir,
        declared,
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
      ...(plugin === undefined
        ? {
            checkAppHistory: ({ recordChecksums }) =>
              assertAppHistoryHolds({
                adapter,
                db,
                dialect,
                migrationsDir,
                logger,
                declared,
                command: "nextly migrate:down",
                recordChecksums,
              }),
            removedFiles: async () =>
              removedOnPurpose(
                await repo.listFileApplies(),
                await repo.listFileRemovals()
              ),
            registryBookkeeping: ({ rows, targets }) =>
              planRollbackBookkeeping({
                adapter: adapter as unknown as DrizzleAdapter,
                dialect,
                migrationsDir,
                config: configResult.config,
                rows,
                rolledBack: targets,
                logger,
              }),
          }
        : {}),
      interactive: canPrompt(),
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

/**
 * The action of `nextly migrate:down`, loaded when it runs.
 */
export async function migrateDownAction(
  cmdOptions: MigrateDownCommandOptions,
  cmd: Command
): Promise<void> {
  const { context, options } = commandRun(cmdOptions, cmd);
  const resolvedOptions: ResolvedDownOptions = options;
  try {
    await runMigrateDown(resolvedOptions, context);
  } catch (error) {
    // Exit 2 for an edited applied file, 3 for one the folder lacks.
    exitWithError(context.logger, error, migrateExitCode(error));
  }
}

export { registerMigrateDownCommand } from "./migrate-down.command";
