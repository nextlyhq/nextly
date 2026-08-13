/**
 * Email domain — retention pruning.
 *
 * Deletes aged rows from `email_deliveries` in bounded batches. The table is
 * the durable answer to "did this send, and did it bounce", and it identifies
 * recipients by an HMAC of their address — so it is a record of who was written
 * to, and it grows on every send forever unless something removes it.
 *
 * This is one half of a two-part erasure story, and the halves cover different
 * populations. `erase-recipient.ts` answers a deliberate "erase this person"
 * request, which only reaches people the caller can name. Many recipients were
 * never users at all — mail sent to an address with no account — so the API
 * alone silently misses them. This pass reaches every row by age, regardless of
 * whose it was or which secret hashed it.
 *
 * Never runs inside a send's transaction: pruning is housekeeping, and failing
 * a password-reset email because it hiccuped is the wrong trade.
 *
 * Deletion is two round trips per batch (select ids, then delete by id) for the
 * reason the webhook prune documents: no single statement batches a delete
 * across all three dialects — PostgreSQL has no `DELETE ... LIMIT`, MySQL
 * rejects a subquery against the delete target, and SQLite supports it only
 * when compiled with a non-default flag. Selecting ids first also confines
 * MySQL's locks to specific records rather than gap-locking a range of the
 * index that concurrent sends need.
 *
 * @module domains/email/prune
 */

import type { WhereCondition } from "@nextlyhq/adapter-drizzle/types";

import type { Logger } from "../../shared/types";
import { warnQuietly } from "../retention/safe-log";

import {
  EMAIL_RETENTION_CLASSES,
  windowForEmailClass,
  type EmailRetentionClass,
  type ResolvedEmailRetentionConfig,
} from "./retention-config";

const DELIVERIES_TABLE = "email_deliveries";

/**
 * Rows removed per statement.
 *
 * Matches the webhook prune's chunk size and stays under SQLite's
 * `SQLITE_MAX_VARIABLE_NUMBER` of 999 on older builds — delivery ids are text,
 * so the id list IS the bind-parameter count.
 */
export const EMAIL_PRUNE_BATCH_SIZE = 500;

/** The subset of the adapter this module needs, so tests can supply a double. */
export interface EmailPruneAdapter {
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

export interface EmailPruneDeps {
  adapter: EmailPruneAdapter;
  now?: () => Date;
  logger?: Logger;
  /**
   * Absolute moment to stop starting new batches.
   *
   * Only the scheduled drain supplies one, and it is a promise that call makes
   * to a serverless cron route: the invocation must return before the platform
   * kills it, or the drain's own delivery work is lost with it. Write paths
   * bound themselves with `maxBatches` instead, because what they are
   * protecting is one user's request rather than a wall clock.
   *
   * Checked BETWEEN batches rather than mid-statement, so a pass stops cleanly
   * having committed whole batches. Absent means unbounded, which is what every
   * caller that is not racing a platform timeout wants.
   */
  deadline?: Date;
}

/**
 * Remove aged delivery rows for one retention class.
 *
 * Scoped by class rather than by age alone because the column exists to let
 * classes diverge later. That scoping is also the hazard: a class added without
 * a window would match no branch here and grow unbounded while the pass
 * reported success. {@link EMAIL_RETENTION_CLASSES} is what stops that, and the
 * suite asserts every class a writer can stamp appears in it — so the failure
 * is a red test rather than a silently growing table.
 */
async function pruneClass(
  deps: EmailPruneDeps,
  retentionClass: EmailRetentionClass,
  cutoff: Date,
  budget: { batchesLeft: number }
): Promise<number> {
  let deleted = 0;

  const clock = deps.now ?? ((): Date => new Date());

  while (budget.batchesLeft > 0) {
    // Between batches, never inside one. A pass that stopped mid-batch would
    // leave the select's work paid for and nothing deleted.
    if (deps.deadline !== undefined && clock() >= deps.deadline) return deleted;

    const candidates = await deps.adapter.select<{ id: string }>(
      DELIVERIES_TABLE,
      {
        where: {
          and: [
            { column: "retentionClass", op: "=", value: retentionClass },
            { column: "createdAt", op: "<", value: cutoff },
          ],
        },
        orderBy: [{ column: "createdAt", direction: "asc" }],
        limit: EMAIL_PRUNE_BATCH_SIZE,
        columns: ["id"],
      }
    );

    // The steady state is "nothing to prune", which costs one probe of the
    // `(retention_class, created_at)` index and takes no write lock.
    if (candidates.length === 0) return deleted;

    budget.batchesLeft -= 1;
    deleted += await deps.adapter.delete(DELIVERIES_TABLE, {
      and: [{ column: "id", op: "IN", value: candidates.map(row => row.id) }],
    });

    // A short read means nothing older remains; a full one may have more.
    if (candidates.length < EMAIL_PRUNE_BATCH_SIZE) return deleted;
  }

  return deleted;
}

export interface EmailPruneResult {
  /** Rows removed, summed across every class the policy governs. */
  deliveries: number;
}

/**
 * Prune every retention class the policy governs.
 *
 * The batch budget is shared across classes rather than granted per class, so
 * one pass costs a bounded amount of work however many classes exist.
 */
export async function pruneEmailData(
  deps: EmailPruneDeps,
  policy: ResolvedEmailRetentionConfig,
  maxBatches?: number
): Promise<EmailPruneResult> {
  const now = (deps.now ?? (() => new Date()))();
  const budget = { batchesLeft: maxBatches ?? policy.maxBatchesPerRun };
  let deliveries = 0;

  for (const retentionClass of EMAIL_RETENTION_CLASSES) {
    const window = windowForEmailClass(policy, retentionClass);
    // `false` is an operator keeping this class indefinitely.
    if (window === false) continue;
    deliveries += await pruneClass(
      deps,
      retentionClass,
      new Date(now.getTime() - window),
      budget
    );
  }

  return { deliveries };
}

/**
 * {@link pruneEmailData}, with failure absorbed and reported.
 *
 * A send must not fail because housekeeping did. The failure is logged with its
 * cause rather than swallowed, because a pass that silently stops leaves the
 * table growing while the configuration reads as enforced — which is the exact
 * state this task existed to end.
 */
export async function pruneEmailDataSafely(
  deps: EmailPruneDeps,
  policy: ResolvedEmailRetentionConfig,
  maxBatches?: number
): Promise<EmailPruneResult> {
  try {
    return await pruneEmailData(deps, policy, maxBatches);
  } catch (error) {
    // `warnQuietly` rather than the logger directly: this is inside the catch
    // that exists to keep a prune failure away from the send, so an
    // app-supplied logger throwing here would reintroduce exactly the escape
    // this function was written to prevent.
    warnQuietly(deps.logger, "Email retention pass failed", { error });
    return { deliveries: 0 };
  }
}
