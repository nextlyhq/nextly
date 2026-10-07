/**
 * `nextly migrate`'s per-file drift reconciliation.
 *
 * For a pending migration file, compares the live managed schema against the
 * file's pre-baseline and target snapshots:
 *   - live ≡ before        → IN_SYNC: run the .sql verbatim, record file_apply.
 *   - live ≡ target        → ALREADY_APPLIED: skip SQL, record file_apply
 *                            (statements_executed=0), supersede prior dev events
 *                            — unless the file runs outside a transaction and
 *                            its last attempt failed (`assertNotPartiallyApplied`).
 *   - neither              → DRIFT: throw NEXTLY_MIGRATION_DRIFT.
 *
 * Two snapshots are equivalent when the diff engine finds no difference.
 * Effects (SQL execution, event recording) are injected so the state machine
 * unit-tests without a DB.
 *
 * @module domains/schema/migrate/drift-reconcile
 * @since v0.0.3-alpha
 */
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
 * Refuses to record a unit as applied without running it when the unit runs
 * outside a transaction and its newest attempt failed.
 *
 * Such an attempt stopped part-way and left the statements before the
 * failing one applied. The database can then stand at the unit's target —
 * every schema statement ran — while a statement that changes no schema, a
 * data change, never did, and recording the unit applied would skip it for
 * good. Only the operator knows what is left, so the refusal says how to
 * record the unit once it is finished by hand, or to run it again once what
 * ran is reversed. A unit run in a transaction is not refused: where its
 * failure was undone, nothing of it is left half-done.
 *
 * Exported so every path that adopts a unit asks this one question: the
 * reconcile, and the plugin runner's adoption of a run of modules.
 */
export async function assertNotPartiallyApplied(
  file: { filename: string; transaction?: boolean },
  repo: Pick<ReconcileRepo, "findFileApplies">
): Promise<void> {
  if (file.transaction !== false) return;
  const newest = newestEvent(await repo.findFileApplies(file.filename));
  if (newest?.status !== "failed") return;
  throw new NextlyError({
    code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
    publicMessage: `${file.filename} runs outside a transaction, and its last attempt failed part-way. The database stands where it ends, but a statement that changes no schema may not have run, so it is not recorded as applied without running. ${partiallyAppliedAdvice(file.filename)}`,
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

  // IN_SYNC — live matches the pre-migration baseline → run the file.
  if (equiv(live, before)) {
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
    await assertNotPartiallyApplied(file, repo);
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
