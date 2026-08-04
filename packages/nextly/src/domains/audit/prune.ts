/**
 * Remove audit rows that have aged past their window.
 *
 * Two tables, two windows, pruned independently: content activity is written on
 * every mutation and is the one that actually grows, while auth events are
 * written per sign-in and are kept longer because the questions asked of them
 * are asked later.
 *
 * Batched, and that is not a detail. Neither table has ever been pruned, so the
 * first pass on an existing install faces every row ever written, and this runs
 * off a user's content write. An unbounded `DELETE` there takes a long lock on
 * the largest table at the worst moment.
 *
 * Absorbs its own failures. Retention is housekeeping offered by a write path,
 * and a write that succeeded must not report failure because pruning could not
 * run.
 *
 * @module domains/audit/prune
 * @since 1.0.0
 */

import type { WhereCondition } from "@nextlyhq/adapter-drizzle/types";

import type { Logger } from "../../shared/types";

import {
  AUDIT_PRUNE_BATCH_SIZE,
  type ResolvedAuditRetentionConfig,
} from "./retention-config";

const ACTIVITY_TABLE = "activity_log";
const AUTH_TABLE = "audit_log";

/** The slice of the adapter a prune needs, so tests can supply a double. */
export interface AuditPruneAdapter {
  select<T = unknown>(
    table: string,
    options?: {
      where?: { and: WhereCondition[] };
      orderBy?: { column: string; direction: "asc" | "desc" }[];
      limit?: number;
      columns?: string[];
    }
  ): Promise<T[]>;
  delete(table: string, where: { and: WhereCondition[] }): Promise<number>;
}

export interface AuditPruneDeps {
  adapter: AuditPruneAdapter;
  /** Injectable so tests can pin the cutoff instead of sleeping. */
  now?: () => Date;
  logger?: Logger;
}

export interface AuditPruneResult {
  activity: number;
  auth: number;
}

/**
 * Delete rows older than `cutoff`, a batch at a time.
 *
 * Reads ids and deletes by id rather than issuing one ranged DELETE: it bounds
 * each statement, and it keeps the read on the `created_at` index while the
 * write touches a known set of primary keys.
 *
 * No offset cursor is needed, unlike the webhook prune — nothing here is ever
 * skipped, so deleted rows leave the table and the next read starts at the
 * oldest remaining row by itself.
 */
async function pruneTable(
  deps: AuditPruneDeps,
  table: string,
  cutoff: Date,
  budget: { batchesLeft: number }
): Promise<number> {
  let deleted = 0;

  while (budget.batchesLeft > 0) {
    const candidates = await deps.adapter.select<{ id: string }>(table, {
      where: { and: [{ column: "createdAt", op: "<", value: cutoff }] },
      orderBy: [{ column: "createdAt", direction: "asc" }],
      limit: AUDIT_PRUNE_BATCH_SIZE,
      columns: ["id"],
    });

    // The steady state is "nothing to prune", which costs one index probe and
    // takes no write lock.
    if (candidates.length === 0) return deleted;

    budget.batchesLeft -= 1;
    deleted += await deps.adapter.delete(table, {
      and: [{ column: "id", op: "IN", value: candidates.map(row => row.id) }],
    });

    // A short read means nothing older remains; a full one may have more.
    if (candidates.length < AUDIT_PRUNE_BATCH_SIZE) return deleted;
  }

  return deleted;
}

/**
 * Run one retention pass over both audit trails.
 *
 * Each trail gets its OWN budget rather than a shared one. Sharing starves the
 * smaller trail permanently: the write paths offer a two-batch pass, activity
 * ages far faster than auth, and an install retiring a batch-worth of activity
 * per interval would consume the whole allowance before the auth trail was
 * reached — every time, so `audit_log` would never be pruned at all while
 * appearing to be configured. The first pass after an upgrade makes this worse,
 * since the activity backlog is the entire history.
 *
 * A pass is therefore bounded per trail rather than overall, which is the
 * bound that matters: what must stay small is the work any single write waits
 * on, and each trail's own cap already ensures that.
 */
export async function pruneAuditData(
  deps: AuditPruneDeps,
  policy: ResolvedAuditRetentionConfig,
  maxBatches?: number
): Promise<AuditPruneResult> {
  const now = (deps.now ?? (() => new Date()))();
  const perTrail = maxBatches ?? policy.maxBatchesPerRun;
  const result: AuditPruneResult = { activity: 0, auth: 0 };

  if (policy.activityMaxAgeMs !== false) {
    result.activity = await pruneTable(
      deps,
      ACTIVITY_TABLE,
      new Date(now.getTime() - policy.activityMaxAgeMs),
      { batchesLeft: perTrail }
    );
  }

  if (policy.authMaxAgeMs !== false) {
    result.auth = await pruneTable(
      deps,
      AUTH_TABLE,
      new Date(now.getTime() - policy.authMaxAgeMs),
      { batchesLeft: perTrail }
    );
  }

  return result;
}

/**
 * {@link pruneAuditData}, with failures absorbed and reported.
 *
 * A missing table is the ordinary case on an older database rather than an
 * error: `audit_log` is absent from some bootstrap paths, and a pass that
 * cannot find it should leave the other table's pruning alone.
 */
export async function pruneAuditDataSafely(
  deps: AuditPruneDeps,
  policy: ResolvedAuditRetentionConfig,
  maxBatches?: number
): Promise<AuditPruneResult> {
  try {
    return await pruneAuditData(deps, policy, maxBatches);
  } catch (error) {
    deps.logger?.warn?.("audit retention pass failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { activity: 0, auth: 0 };
  }
}
