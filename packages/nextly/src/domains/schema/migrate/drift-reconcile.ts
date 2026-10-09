/**
 * `nextly migrate`'s per-file drift reconciliation.
 *
 * For a pending migration file, compares the live managed schema against the
 * file's pre-baseline and target snapshots:
 *   - live ≡ before        → IN_SYNC: run the .sql verbatim, record file_apply
 *                            — unless its last attempt failed and may have
 *                            stopped part-way (`assertNotPartiallyApplied`).
 *   - live ≡ target        → ALREADY_APPLIED: skip SQL, record file_apply
 *                            (statements_executed=0), supersede prior dev events
 *                            — unless its last attempt failed and may have
 *                            stopped part-way: it ran outside a transaction,
 *                            or on MySQL (`assertNotPartiallyApplied`).
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
  supersede(args: {
    supersededEventIds: string[];
    byEventId: string;
  }): Promise<void>;
  /** Every `file_apply` row for one filename: applied, failed, rolled back. */
  findFileApplies(
    filename: string
  ): Promise<ReadonlyArray<Pick<SchemaEventRow, "status" | "startedAt">>>;
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
   * marked to run outside one; returns statements executed.
   */
  executeSql: (sql: string, unit: MigrationUnit) => Promise<number>;
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
 * database at this file's target or a caller finds it further along.
 */
export async function recordAlreadyApplied(
  file: { filename: string; sha256?: string },
  repo: ReconcileRepo,
  supersedableEventIds?: () => Promise<string[]>
): Promise<void> {
  const id = await repo.recordStart({
    eventType: "file_apply",
    source: "cli-migrate",
    filename: file.filename,
    sha256: file.sha256 ?? null,
  });
  await repo.markApplied(id, {
    statementsExecuted: 0,
    uniqueFilename: file.filename,
  });
  const supersedable = (await supersedableEventIds?.()) ?? [];
  if (supersedable.length > 0) {
    await repo.supersede({ supersededEventIds: supersedable, byEventId: id });
  }
}

/**
 * Why a unit whose last attempt may have stopped part-way is not recorded, or
 * not run again: a statement that changes no schema leaves no trace the
 * snapshot comparison can see, in either direction.
 */
const PARTIAL_REFUSALS = {
  record:
    "The database stands where it ends, but a statement that changes no schema may not have run, so it is not recorded as applied without running.",
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
  refusing: keyof typeof PARTIAL_REFUSALS = "record"
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
    publicMessage: `${why} ${PARTIAL_REFUSALS[refusing]} ${partiallyAppliedAdvice(file.filename)}`,
    logContext: { source: file.filename, reason: "partially-applied" },
  });
}

function toDriftItem(op: Operation): DriftItem {
  switch (op.type) {
    case "add_table":
      return { kind: "+", detail: `table '${op.table.name}' present in DB` };
    case "add_column":
      return {
        kind: "+",
        detail: `${op.tableName}.${op.column.name} present in DB`,
      };
    case "drop_table":
      return { kind: "-", detail: `table '${op.tableName}' absent from DB` };
    case "drop_column":
      return {
        kind: "-",
        detail: `${op.tableName}.${op.columnName} absent from DB`,
      };
    case "add_index":
      return {
        kind: "+",
        detail: `index '${op.index.name}' on '${op.tableName}' present in DB`,
      };
    case "drop_index":
      return {
        kind: "-",
        detail: `index '${op.index.name}' on '${op.tableName}' absent from DB`,
      };
    default:
      return { kind: "?", detail: `${op.type} differs` };
  }
}

export async function reconcileFile(
  args: ReconcileFileArgs
): Promise<{ state: ReconcileState }> {
  const { file, before, target, live, repo, executeSql } = args;
  const migration = file.filename.replace(/\.sql$/, "");

  // IN_SYNC — live matches the pre-migration baseline → run the file, unless
  // a failed attempt may have left a data statement of it applied.
  if (equiv(live, before)) {
    await assertNotPartiallyApplied(file, args.dialect, repo, "rerun");
    const id = await repo.recordStart({
      eventType: "file_apply",
      source: "cli-migrate",
      filename: file.filename,
      sha256: file.sha256 ?? null,
    });
    try {
      const statementsExecuted = await executeSql(file.sql, {
        source: file.filename,
        transaction: file.transaction ?? true,
      });
      await repo.markApplied(id, {
        statementsExecuted,
        uniqueFilename: file.filename,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await repo.markFailed(id, {
        // The cause chain as well as the message, bounded and without
        // logContext, as the verbatim path records it: an error that keeps
        // the database's reason out of its public message carries it in its
        // cause, and the ledger row is where the operator reads it back.
        errorMessage: truncateErrorMessage(
          describeError(err, { context: false })
        ),
        errorJson:
          err instanceof Error ? { name: err.name, message: err.message } : err,
      });
      throw new NextlyError({
        code: "NEXTLY_MIGRATION_APPLY_FAILED",
        publicMessage: `Migration ${migration} failed: ${message}`,
        ...(err instanceof Error ? { cause: err } : {}),
      });
    }
    return { state: "in_sync" };
  }

  // ALREADY_APPLIED — live already matches the target → record without running.
  if (equiv(live, target)) {
    await assertNotPartiallyApplied(file, args.dialect, repo);
    await recordAlreadyApplied(file, repo, args.supersedableEventIds);
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
