/**
 * `nextly migrate`'s per-file drift reconciliation.
 *
 * For a pending migration file, compares the live managed schema against the
 * file's pre-baseline and target snapshots:
 *   - live ≡ before        → IN_SYNC: run the .sql verbatim, record file_apply
 *                            in the transaction the statements ran in
 *                            — unless its last attempt failed and may have
 *                            stopped part-way (`assertNotPartiallyApplied`).
 *   - live ≡ target        → ALREADY_APPLIED: skip SQL, record file_apply
 *                            (statements_executed=0), supersede prior dev events,
 *                            all in one transaction
 *                            — unless its last attempt failed and may have
 *                            stopped part-way: it ran outside a transaction,
 *                            or on MySQL (`assertNotPartiallyApplied`), and
 *                            the snapshot does not prove its whole effect
 *                            (`schemaOnly`).
 *   - neither              → DRIFT: throw NEXTLY_MIGRATION_DRIFT.
 *
 * Two snapshots are equivalent when the diff engine finds no difference.
 * Effects (SQL execution, event recording) are injected so the state machine
 * unit-tests without a DB.
 *
 * @module domains/schema/migrate/drift-reconcile
 * @since v0.0.3-alpha
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { describeError, NextlyError } from "../../../errors";
import { newestEvent } from "../events/newest-event";
import {
  truncateErrorMessage,
  type SchemaEventRow,
} from "../events/schema-events-repository";
import { diffSnapshots } from "../pipeline/diff/diff";
import type { NextlySchemaSnapshot, Operation } from "../pipeline/diff/types";

import { isUnadoptedDatabase } from "./baseline";
import { migrationDriftError, type DriftItem } from "./drift-error";
import {
  partiallyAppliedAdvice,
  type MigrationUnit,
} from "./migration-transaction";

export type ReconcileState = "in_sync" | "already_applied" | "drift";

/** Structural slice of SchemaEventsRepository this reconciler needs. */
export interface ReconcileRepo {
  recordStart(args: {
    eventType: "file_apply";
    source: "cli-migrate";
    filename: string;
    sha256?: string | null;
  }): Promise<string>;
  markApplied(
    id: string,
    args: { statementsExecuted?: number | null; uniqueFilename?: string | null }
  ): Promise<boolean>;
  markFailed(
    id: string,
    args: { errorMessage?: string | null; errorJson?: unknown }
  ): Promise<void>;
  /**
   * Delete an attempt still `in_progress`: one whose work was rolled back
   * whole because another run recorded the same file first.
   */
  discardAttempt(id: string): Promise<void>;
  supersede(args: {
    supersededEventIds: string[];
    byEventId: string;
  }): Promise<void>;
  /**
   * The same ledger written through another Drizzle handle: the one a
   * file's statements ran on, so its applied row commits or rolls back with
   * them.
   */
  boundTo(
    db: unknown
  ): Pick<ReconcileRepo, "recordStart" | "markApplied" | "supersede">;
  /**
   * Every `file_apply` row for one filename: applied, failed, rolled back,
   * with what each row retired, which tells a rollback from a cleared
   * attempt (`attemptCleared`).
   */
  findFileApplies(
    filename: string
  ): Promise<
    ReadonlyArray<
      Pick<SchemaEventRow, "status" | "startedAt" | "supersededEventIds">
    >
  >;
}

export interface ReconcileFileArgs {
  file: {
    filename: string;
    sql: string;
    path: string;
    sha256?: string;
    /**
     * False for a unit marked to run outside a transaction; absent, it runs
     * in one.
     */
    transaction?: boolean;
    /**
     * True for a unit whose whole effect the snapshot shows: a plugin module
     * whose statements change only the schema and are exactly what its two
     * sides render to (the runner's `provenBySnapshot`). A database standing
     * at its target then proves it ran, so it is recorded applied even when
     * its last attempt did not finish (`assertNotPartiallyApplied` guards
     * against a statement the snapshot cannot see, and it has none). Absent —
     * an app file, which has no such proof — such an attempt is refused.
     */
    schemaOnly?: boolean;
  };
  before: NextlySchemaSnapshot;
  target: NextlySchemaSnapshot;
  live: NextlySchemaSnapshot;
  /**
   * The database the file runs on. It decides whether a failed attempt can
   * have left part of the file applied (`assertNotPartiallyApplied`).
   */
  dialect: SupportedDialect;
  repo: ReconcileRepo;
  /**
   * Execute the file's SQL as `unit` says — in one transaction unless it is
   * marked to run outside one — then `after` with the handle the statements
   * ran on, inside that transaction when there is one
   * (`runMigrationStatements`); returns statements executed.
   */
  executeSql: (
    sql: string,
    unit: MigrationUnit,
    after: (db: unknown, statementsExecuted: number) => Promise<void>
  ) => Promise<number>;
  /**
   * What else is recorded once the file has run, or has been recorded
   * without running (`adopted`), through the handle its applied row was
   * written on, after that row: written in the same transaction, it commits
   * or rolls back with it.
   */
  recordApplied?: (db: unknown, adopted: boolean) => Promise<void>;
  /** Dev/ui/db_sync event ids this file_apply supersedes (ALREADY_APPLIED). */
  supersedableEventIds?: () => Promise<string[]>;
  /**
   * The plugin whose module this is, when it is one. A plugin's drift is
   * recovered differently from an app file's: its modules ship inside the
   * plugin, so the app's recoveries — re-creating or resolving an app
   * migration — do nothing for it.
   */
  pluginName?: string;
}

/**
 * Two snapshots are equivalent iff their diff is empty.
 *
 * Exported so every caller deciding "does the database stand here" asks this
 * one function, and none can come to disagree with the reconcile about it.
 */
export function snapshotsEquivalent(
  a: NextlySchemaSnapshot,
  b: NextlySchemaSnapshot
): boolean {
  return diffSnapshots(a, b).length === 0;
}

const equiv = snapshotsEquivalent;

/**
 * Record a file as applied without running it: the database already holds
 * what it would produce.
 *
 * The one place an adoption is written, whether the reconcile finds the
 * database at this file's target or a caller finds it further along. The
 * caller hands it a repository bound to a transaction, so its rows commit
 * together with whatever else the adoption records. Another run having
 * recorded the file first is thrown (`concurrentRunError`), which rolls
 * that transaction back and leaves the other run's row as the only record.
 */
export async function recordAlreadyApplied(
  file: { filename: string; sha256?: string },
  repo: Pick<ReconcileRepo, "recordStart" | "markApplied" | "supersede">,
  supersedable: readonly string[] = []
): Promise<void> {
  const id = await repo.recordStart({
    eventType: "file_apply",
    source: "cli-migrate",
    filename: file.filename,
    sha256: file.sha256 ?? null,
  });
  await markAppliedOrRefuse(repo, id, {
    filename: file.filename,
    statementsExecuted: 0,
    partial: false,
  });
  if (supersedable.length > 0) {
    await repo.supersede({
      supersededEventIds: [...supersedable],
      byEventId: id,
    });
  }
}

/**
 * The refusal for a run whose ledger write lost to another run's: the other
 * run recorded the same migration applied (`direction` "up") or rolled back
 * ("down") while this one was running it.
 *
 * `partial` says this run's statements may have stayed: it ran outside a
 * transaction, or on MySQL, which commits each schema statement as it runs
 * (`failedAttemptMayBePartial`). Otherwise they were rolled back with the
 * transaction the losing write was made in, and the ledger holds only the
 * other run's record.
 */
export function concurrentRunError(args: {
  filename: string;
  direction: "up" | "down";
  partial: boolean;
}): NextlyError {
  const what = args.direction === "up" ? "applied" : "rolled back";
  const outcome = args.partial
    ? `This run's statements ran outside a transaction, or on MySQL, which commits each schema statement as it runs, so they may have stayed applied and repeated what the other run did: check what ${args.filename} changes before going on.`
    : "This run's statements were rolled back, and the ledger keeps the other run's record.";
  return new NextlyError({
    code: "NEXTLY_MIGRATION_CONCURRENT_RUN",
    publicMessage: `Another run recorded ${args.filename} ${what} while this one was running it. ${outcome}`,
    logContext: {
      source: args.filename,
      direction: args.direction,
      reason: "concurrent-run",
    },
  });
}

/** Whether `error` is the refusal `concurrentRunError` builds. */
export function isConcurrentRun(error: unknown): boolean {
  return NextlyError.isCode(error, "NEXTLY_MIGRATION_CONCURRENT_RUN");
}

/**
 * Mark an attempt applied under the one-applied-row-per-file guard, and
 * throw `concurrentRunError` when the guard finds another run's applied row:
 * inside a transaction the throw rolls back the work the row records instead
 * of committing it beside the other run's.
 */
export async function markAppliedOrRefuse(
  repo: Pick<ReconcileRepo, "markApplied">,
  id: string,
  args: { filename: string; statementsExecuted: number; partial: boolean }
): Promise<void> {
  const applied = await repo.markApplied(id, {
    statementsExecuted: args.statementsExecuted,
    uniqueFilename: args.filename,
  });
  if (applied) return;
  throw concurrentRunError({
    filename: args.filename,
    direction: "up",
    partial: args.partial,
  });
}

/**
 * Record how an attempt that ran a file's statements ended, once it threw.
 *
 * A lost race whose statements were rolled back whole leaves nothing of the
 * attempt, so its row is deleted (`discardAttempt`): left as failed or
 * superseded, it would be the file's newest event over the other run's
 * applied row. Any other failure, and a lost race whose statements may have
 * stayed, is recorded failed, so `nextly migrate` stops on it
 * (`assertNotPartiallyApplied`) until the operator has looked.
 */
export async function recordAttemptFailed(
  repo: Pick<ReconcileRepo, "markFailed" | "discardAttempt">,
  id: string,
  error: unknown,
  partial: boolean
): Promise<void> {
  if (isConcurrentRun(error) && !partial) {
    await repo.discardAttempt(id);
    return;
  }
  await repo.markFailed(id, {
    // The cause chain as well as the message, bounded and without
    // logContext: an error that keeps the database's reason out of its
    // public message carries it in its cause, and the ledger row is where
    // the operator reads it back.
    errorMessage: truncateErrorMessage(
      describeError(error, { context: false })
    ),
    errorJson:
      error instanceof Error
        ? { name: error.name, message: error.message }
        : error,
  });
}

/**
 * Why a unit whose last attempt may have stopped part-way is not recorded, or
 * not run again: a statement that changes no schema leaves no trace the
 * snapshot comparison can see, in either direction.
 */
const PARTIAL_REFUSALS = {
  record:
    "The database stands where it ends, or past it, but a statement that changes no schema may not have run, so it is not recorded as applied without running.",
  rerun:
    "Running it again would repeat what of it ran and stayed: a statement that changes no schema may have run even where the schema shows nothing of the attempt, so it is not run again.",
} as const;

/**
 * Whether a failed attempt of a unit may have stopped part-way, leaving the
 * statements before the failing one applied: always outside a transaction,
 * and on MySQL inside one too, because MySQL commits each schema statement as
 * it runs. On PostgreSQL and SQLite a failed attempt in a transaction was
 * undone whole. `assertNotPartiallyApplied` explains each case.
 */
export function failedAttemptMayBePartial(
  file: { transaction?: boolean },
  dialect: SupportedDialect
): boolean {
  return file.transaction === false || dialect === "mysql";
}

/**
 * Whether a ledger row is an attempt that did not finish: one that failed,
 * or one still `in_progress`, which recorded no outcome — its process
 * stopped (killed, out of memory, its connection dropped), or is still
 * running where the migrate lock does not hold it off (SQLite takes none,
 * and PostgreSQL's expires). Either way the reader cannot know what of it
 * ran, so it is treated as the failure it may be.
 *
 * The one reading of "did the last attempt finish" for the partially-applied
 * refusal, and for `migrate:resolve`, which clears such attempts or records
 * past them.
 */
export function attemptUnfinished(
  row: Pick<SchemaEventRow, "status"> | undefined
): boolean {
  return row?.status === "failed" || row?.status === "in_progress";
}

/**
 * Whether a ledger row is an attempt `migrate:resolve --failed-cleanup`
 * cleared: flipped to `rolled_back` in place, retiring nothing. A rollback
 * (`migrate:down`, `migrate:resolve --rolled-back`) is a row of its own that
 * retires the applied row it undoes, and dev push writes no row at all.
 *
 * The operator clears an attempt once they have finished its statements by
 * hand or reversed them, and where the database stands then says which: at
 * the unit's start it runs again, past it the operator has finished it.
 */
export function attemptCleared(
  row: Pick<SchemaEventRow, "status" | "supersededEventIds"> | undefined
): boolean {
  return (
    row?.status === "rolled_back" && (row.supersededEventIds ?? []).length === 0
  );
}

/**
 * Refuses to record a unit as applied without running it, or to run it
 * again, when its newest attempt did not finish (`attemptUnfinished`) and may
 * have stopped part-way.
 *
 * Such an attempt can leave the statements before the failing one applied.
 * The database can then stand at the unit's target — every schema statement
 * ran — while a statement that changes no schema, a data change, never did,
 * and recording the unit applied would skip it for good (`refusing:
 * "record"`). Or it can stand at the unit's start — the schema statement
 * failed — while a data statement before it ran and stayed, and running the
 * unit again would repeat that statement (`refusing: "rerun"`). Only the
 * operator knows what is left, so the refusal says how to record the unit
 * once it is finished by hand, or to clear the attempt and run it again once
 * what ran is reversed.
 *
 * A failed attempt may have stopped part-way when the unit runs outside a
 * transaction, on any dialect, and on MySQL whether or not it runs in one:
 * MySQL commits each schema statement as it runs, together with everything
 * the transaction did before it, so a failure there undoes only what ran
 * after the last schema statement. On PostgreSQL and SQLite a unit run in a
 * transaction is not refused: its failure was undone whole, so nothing of it
 * is left half-done.
 *
 * Exported so every path that adopts or runs a unit asks this one question:
 * the reconcile, the plugin runner's adoption of a run of modules, and the
 * run of an app file that has no snapshot to reconcile against.
 */
export async function assertNotPartiallyApplied(
  file: { filename: string; transaction?: boolean },
  dialect: SupportedDialect,
  repo: Pick<ReconcileRepo, "findFileApplies">,
  /** What the caller would otherwise do with the unit. */
  refusing: keyof typeof PARTIAL_REFUSALS = "record",
  /**
   * How to recover this kind of file, where the caller knows better than the general advice: the
   * one question that tells whether the attempt landed, and the step for each answer.
   */
  advice?: string
): Promise<void> {
  if (!failedAttemptMayBePartial(file, dialect)) return;
  const outsideTransaction = file.transaction === false;
  const newest = newestEvent(await repo.findFileApplies(file.filename));
  if (!attemptUnfinished(newest)) return;
  const unfinished =
    newest?.status === "failed"
      ? undefined
      : "recorded no outcome (the process running it stopped, or is still running)";
  const why = outsideTransaction
    ? unfinished === undefined
      ? `${file.filename} runs outside a transaction, and its last attempt failed part-way.`
      : `${file.filename} runs outside a transaction, and its last attempt ${unfinished}, so it may have stopped part-way.`
    : `${file.filename}'s last attempt ${unfinished ?? "failed"}, and MySQL commits each schema statement as it runs, even inside a transaction, so that attempt may have stopped part-way.`;
  throw new NextlyError({
    code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
    publicMessage: `${why} ${PARTIAL_REFUSALS[refusing]} ${advice ?? partiallyAppliedAdvice(file.filename)}`,
    logContext: { source: file.filename, reason: "partially-applied" },
  });
}

/** How one kind of operation reads as a drift item. */
type DriftItemOf = {
  [K in Operation["type"]]: (op: Extract<Operation, { type: K }>) => DriftItem;
};

/**
 * One entry per operation kind, keyed by the union itself, so a kind added to
 * `Operation` fails to compile here until it says what it names, rather than
 * reaching the operator as an unnamed difference.
 */
const DRIFT_ITEMS: DriftItemOf = {
  add_table: op => ({
    kind: "+",
    detail: `table '${op.table.name}' present in DB`,
  }),
  drop_table: op => ({
    kind: "-",
    detail: `table '${op.tableName}' absent from DB`,
  }),
  rename_table: op => ({
    kind: "?",
    detail: `table '${op.fromName}' stands as '${op.toName}' in DB`,
  }),
  add_column: op => ({
    kind: "+",
    detail: `${op.tableName}.${op.column.name} present in DB`,
  }),
  drop_column: op => ({
    kind: "-",
    detail: `${op.tableName}.${op.columnName} absent from DB`,
  }),
  rename_column: op => ({
    kind: "?",
    detail: `${op.tableName}.${op.fromColumn} stands as ${op.tableName}.${op.toColumn} in DB`,
  }),
  change_column_type: op => ({
    kind: "?",
    detail: `${op.tableName}.${op.columnName} is ${op.toType} in DB, not ${op.fromType}`,
  }),
  change_column_nullable: op => ({
    kind: "?",
    detail: `${op.tableName}.${op.columnName} is ${op.toNullable ? "nullable" : "NOT NULL"} in DB`,
  }),
  change_column_default: op => ({
    kind: "?",
    detail: `${op.tableName}.${op.columnName} defaults to ${op.toDefault ?? "nothing"} in DB, not ${op.fromDefault ?? "nothing"}`,
  }),
  add_index: op => ({
    kind: "+",
    detail: `index '${op.index.name}' on '${op.tableName}' present in DB`,
  }),
  drop_index: op => ({
    kind: "-",
    detail: `index '${op.index.name}' on '${op.tableName}' absent from DB`,
  }),
  add_check: op => ({
    kind: "+",
    detail: `check '${op.check.name}' on '${op.tableName}' present in DB`,
  }),
  drop_check: op => ({
    kind: "-",
    detail: `check '${op.check.name}' on '${op.tableName}' absent from DB`,
  }),
  add_foreign_key: op => ({
    kind: "+",
    detail: `foreign key '${op.foreignKey.name}' on '${op.tableName}' present in DB`,
  }),
  drop_foreign_key: op => ({
    kind: "-",
    detail: `foreign key '${op.foreignKey.name}' on '${op.tableName}' absent from DB`,
  }),
  change_foreign_key_action: op => ({
    kind: "?",
    detail: `foreign key '${op.constraintName}' on '${op.tableName}' is ON DELETE ${op.toOnDelete} ON UPDATE ${op.toOnUpdate} in DB, not ON DELETE ${op.fromOnDelete} ON UPDATE ${op.fromOnUpdate}`,
  }),
};

/**
 * One difference between where a file starts and the live database, naming
 * the element it is about. Every operation kind is named (`DRIFT_ITEMS`), so
 * a refusal tells the operator which column, index, check or foreign key to
 * look at rather than only the kind of change.
 */
function toDriftItem(op: Operation): DriftItem {
  // The table's key and its operation's type are the same member of the
  // union; TypeScript can't correlate the two through an index, so the
  // formatter is widened to the union it is only ever called with.
  const describe = DRIFT_ITEMS[op.type] as (op: Operation) => DriftItem;
  return describe(op);
}

/**
 * Run a file's statements and record it applied through the handle they ran
 * on, with whatever else the caller records (`recordApplied`).
 *
 * In a transaction the applied row is written inside it: a failure of that
 * write rolls the statements back, and a process stopping before COMMIT
 * leaves neither, so the row never stays `in_progress` over statements that
 * committed. Another run having recorded the file first fails the write
 * (`markAppliedOrRefuse`) and rolls the statements back with it. Outside
 * one, each statement has already committed by the time the row is written,
 * as it always has.
 */
async function runAndRecord(
  args: ReconcileFileArgs,
  id: string
): Promise<void> {
  const { file, repo } = args;
  await args.executeSql(
    file.sql,
    { source: file.filename, transaction: file.transaction ?? true },
    async (db, statementsExecuted) => {
      await markAppliedOrRefuse(repo.boundTo(db), id, {
        filename: file.filename,
        statementsExecuted,
        partial: failedAttemptMayBePartial(file, args.dialect),
      });
      await args.recordApplied?.(db, false);
    }
  );
}

/**
 * Run a file whose database stands at its start, and record how it ended.
 * A lost race is thrown as it is, so the caller can tell it from a failure
 * of the file's own statements.
 */
async function runInSync(args: ReconcileFileArgs): Promise<void> {
  const { file, repo } = args;
  const id = await repo.recordStart({
    eventType: "file_apply",
    source: "cli-migrate",
    filename: file.filename,
    sha256: file.sha256 ?? null,
  });
  try {
    await runAndRecord(args, id);
  } catch (err) {
    await recordAttemptFailed(
      repo,
      id,
      err,
      failedAttemptMayBePartial(file, args.dialect)
    );
    if (isConcurrentRun(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      publicMessage: `Migration ${file.filename.replace(/\.sql$/, "")} failed: ${message}`,
      ...(err instanceof Error ? { cause: err } : {}),
    });
  }
}

/**
 * Record a file the database already stands past as applied, without running
 * it, with whatever else the caller records (`recordApplied`): in one
 * transaction with no statements, so the ledger row and the caller's rows
 * commit together or not at all.
 */
async function adoptFile(args: ReconcileFileArgs): Promise<void> {
  const { file, repo } = args;
  // Read before the transaction opens, through the caller's own handle.
  const supersedable = (await args.supersedableEventIds?.()) ?? [];
  await args.executeSql(
    "",
    { source: file.filename, transaction: true },
    async db => {
      await recordAlreadyApplied(file, repo.boundTo(db), supersedable);
      await args.recordApplied?.(db, true);
    }
  );
}

export async function reconcileFile(
  args: ReconcileFileArgs
): Promise<{ state: ReconcileState }> {
  const { file, before, target, live, repo } = args;
  const migration = file.filename.replace(/\.sql$/, "");

  // IN_SYNC — live matches the pre-migration baseline → run the file, unless
  // a failed attempt may have left a data statement of it applied.
  if (equiv(live, before)) {
    await assertNotPartiallyApplied(file, args.dialect, repo, "rerun");
    await runInSync(args);
    return { state: "in_sync" };
  }

  // ALREADY_APPLIED — live already matches the target → record without running,
  // unless a failed attempt may have left a statement the snapshot cannot see
  // undone. A unit that changes only the schema has none.
  if (equiv(live, target)) {
    if (file.schemaOnly !== true) {
      await assertNotPartiallyApplied(file, args.dialect, repo);
    }
    await adoptFile(args);
    return { state: "already_applied" };
  }

  // DRIFT — live matches neither baseline nor target.
  const driftItems = diffSnapshots(before, live).map(toDriftItem);
  // A half-applied first migration is indistinguishable from an unadopted
  // database by schema alone — MySQL commits each DDL statement as it runs, so
  // a first migration that failed partway leaves its tables and the retry sees
  // only tables that already exist. The ledger separates them: a failed
  // attempt left a row, and a database nobody has adopted never has one.
  const priorAttempts = await repo.findFileApplies(file.filename);
  throw migrationDriftError({
    migration,
    file: file.path,
    driftItems,
    pluginName: args.pluginName,
    // A database standing before the history started is a different problem
    // from a drifted one, and the recoveries for drift do not solve it.
    unadoptedDatabase: isUnadoptedDatabase({
      before,
      driftKinds: driftItems.map(d => d.kind),
      hasPriorAttempt: priorAttempts.length > 0,
    }),
  });
}
