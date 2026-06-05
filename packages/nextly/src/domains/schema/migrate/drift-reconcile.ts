/**
 * `nextly migrate` Phase 2 — per-file drift reconciliation (spec §4.7).
 *
 * For a pending migration file, compares the live managed schema against the
 * file's pre-baseline and target snapshots:
 *   - live ≡ before        → IN_SYNC: run the .sql verbatim, record file_apply.
 *   - live ≡ target        → ALREADY_APPLIED: skip SQL, record file_apply
 *                            (statements_executed=0), supersede prior dev events.
 *   - neither              → DRIFT: throw NEXTLY_MIGRATION_DRIFT.
 *
 * Equivalence (spec §4.2) is realized as "empty diff" via the existing diff
 * engine. Effects (SQL execution, event recording) are injected so the state
 * machine unit-tests without a DB.
 *
 * @module domains/schema/migrate/drift-reconcile
 * @since v0.0.3-alpha (Plan C2)
 */
import { NextlyError } from "../../../errors";
import { diffSnapshots } from "../pipeline/diff/diff";
import type { NextlySchemaSnapshot, Operation } from "../pipeline/diff/types";

import { migrationDriftError, type DriftItem } from "./drift-error";

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
    args: { statementsExecuted?: number | null }
  ): Promise<void>;
  markFailed(
    id: string,
    args: { errorMessage?: string | null; errorJson?: unknown }
  ): Promise<void>;
  supersede(args: {
    supersededEventIds: string[];
    byEventId: string;
  }): Promise<void>;
}

export interface ReconcileFileArgs {
  file: { filename: string; sql: string; path: string; sha256?: string };
  before: NextlySchemaSnapshot;
  target: NextlySchemaSnapshot;
  live: NextlySchemaSnapshot;
  repo: ReconcileRepo;
  /** Execute the file's SQL in one transaction; returns statements executed. */
  executeSql: (sql: string) => Promise<number>;
  /** Dev/ui/db_sync event ids this file_apply supersedes (ALREADY_APPLIED). */
  supersedableEventIds?: () => Promise<string[]>;
}

/** Two snapshots are equivalent iff their diff is empty (spec §4.2). */
function equiv(a: NextlySchemaSnapshot, b: NextlySchemaSnapshot): boolean {
  return diffSnapshots(a, b).length === 0;
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
      const statementsExecuted = await executeSql(file.sql);
      await repo.markApplied(id, { statementsExecuted });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await repo.markFailed(id, {
        errorMessage: message,
        errorJson:
          err instanceof Error ? { name: err.name, message: err.message } : err,
      });
      throw new NextlyError({
        code: "NEXTLY_MIGRATION_APPLY_FAILED",
        publicMessage: `Migration ${migration} failed: ${message}`,
      });
    }
    return { state: "in_sync" };
  }

  // ALREADY_APPLIED — live already matches the target → record without running.
  if (equiv(live, target)) {
    const id = await repo.recordStart({
      eventType: "file_apply",
      source: "cli-migrate",
      filename: file.filename,
      sha256: file.sha256 ?? null,
    });
    await repo.markApplied(id, { statementsExecuted: 0 });
    const supersedable = (await args.supersedableEventIds?.()) ?? [];
    if (supersedable.length > 0) {
      await repo.supersede({ supersededEventIds: supersedable, byEventId: id });
    }
    return { state: "already_applied" };
  }

  // DRIFT — live matches neither baseline nor target.
  const driftItems = diffSnapshots(before, live).map(toDriftItem);
  throw migrationDriftError({ migration, file: file.path, driftItems });
}
