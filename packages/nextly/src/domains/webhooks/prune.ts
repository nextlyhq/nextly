/**
 * Webhook domain — retention pruning.
 *
 * Deletes aged rows from `nextly_events` and `nextly_webhook_deliveries` in
 * bounded batches. Never runs inside a content write's transaction: pruning is
 * housekeeping, and failing a user's save because it hiccuped is the wrong
 * trade. (Version retention deliberately takes the opposite position, because a
 * violated version cap is a correctness bug rather than untidiness.)
 *
 * Two safety rules govern which events may go, both forced by the schema:
 *
 * 1. `fanned_out_at IS NULL` means the event still needs fan-out. Deleting one
 *    would discard an event nobody ever delivered.
 * 2. `nextly_webhook_deliveries.event_id` cascades, so deleting an event takes
 *    its delivery rows with it — including any still pending or retrying. An
 *    event is therefore only prunable once every child delivery is terminal.
 *
 * Deletion is two round trips per batch (select ids, then delete by id) because
 * no single statement batches a delete across all three dialects: PostgreSQL has
 * no `DELETE ... LIMIT`, MySQL rejects a subquery against the delete target, and
 * SQLite only supports it when compiled with a non-default flag. Selecting ids
 * first also confines MySQL's locks to specific records rather than gap-locking
 * a range of the index that concurrent inserts need.
 *
 * @module domains/webhooks/prune
 */

import type { WhereCondition } from "@nextlyhq/adapter-drizzle/types";

import type { Logger } from "../../shared/types";

import {
  EVENT_RETENTION_CLASSES,
  windowForClass,
  type EventRetentionClass,
  type ResolvedWebhookRetentionConfig,
} from "./retention-config";

const EVENTS_TABLE = "nextly_events";
const DELIVERIES_TABLE = "nextly_webhook_deliveries";
const WEBHOOKS_TABLE = "nextly_webhooks";

/** Delivery states that still represent work the drain may pick up. */
const LIVE_DELIVERY_STATUSES = ["pending", "processing", "retrying"] as const;

/** Delivery states that are finished and therefore prunable. */
const TERMINAL_DELIVERY_STATUSES = ["delivered", "failed"] as const;

/** The subset of the adapter this module needs, so tests can supply a double. */
export interface PruneAdapter {
  select<T = unknown>(
    table: string,
    options?: {
      where?: { and: WhereCondition[] };
      orderBy?: { column: string; direction: "asc" | "desc" }[];
      limit?: number;
      offset?: number;
      columns?: string[];
    }
  ): Promise<T[]>;
  delete(table: string, where: { and: WhereCondition[] }): Promise<number>;
}

export interface PruneDeps {
  adapter: PruneAdapter;
  /** Injectable so tests can pin the cutoff instead of sleeping. */
  now?: () => Date;
  logger?: Logger;
}

export interface PruneOptions {
  /** Count what would be deleted without deleting it. */
  dryRun?: boolean;
}

export interface PruneResult {
  /** Events removed, per retention class. */
  events: Record<EventRetentionClass, number>;
  /** Terminal delivery rows removed ahead of their event. */
  deliveries: number;
  /** Batches issued, across both tables. */
  batches: number;
  /** True when a bound stopped the pass before it ran out of rows. */
  truncated: boolean;
}

function emptyResult(): PruneResult {
  return {
    events: { webhook: 0, audit: 0 },
    deliveries: 0,
    batches: 0,
    truncated: false,
  };
}

/** A cutoff instant, or null when this class is kept forever. */
function cutoffFor(now: Date, maxAgeMs: number | false): Date | null {
  return maxAgeMs === false ? null : new Date(now.getTime() - maxAgeMs);
}

/**
 * Whether any endpoint could ever receive an event.
 *
 * With no enabled endpoint there is nothing to fan out to, so `fanned_out_at`
 * stays NULL forever — the drain only runs where webhooks are configured. That
 * is the majority install, and requiring a completed fan-out there would make
 * retention delete nothing at all, leaving the ledger unbounded for exactly the
 * population the policy exists for.
 *
 * An endpoint added later does not get a backlog of historical events, which is
 * the intended contract: webhooks deliver what happens after you subscribe, not
 * what happened before.
 */
async function deliveryIsPossible(adapter: PruneAdapter): Promise<boolean> {
  const rows = await adapter.select<{ id: string }>(WEBHOOKS_TABLE, {
    where: { and: [{ column: "enabled", op: "=", value: true }] },
    limit: 1,
    columns: ["id"],
  });
  return rows.length > 0;
}

/**
 * Of the given event ids, those whose deliveries must outlive them.
 *
 * Two reasons a delivery holds its event back. It may still be live, in which
 * case removing the event would cascade away work the drain has not finished.
 * Or it may be terminal but younger than the delivery window: the attempt log is
 * the only record of how a webhook was behaving, and a delayed drain routinely
 * produces a fresh terminal delivery on an event that is already past its own
 * window — deleting the event then would cascade an attempt log that is seconds
 * old and silently defeat the configured delivery retention.
 *
 * Expressed as two queries rather than one disjunction because the narrow
 * adapter surface this module declares takes conjunctions only, and widening it
 * to carry an `or` for a single call site buys nothing. The `(event_id)` index
 * serves both.
 */
async function eventIdsWithRetainedDeliveries(
  adapter: PruneAdapter,
  eventIds: string[],
  deliveryCutoff: Date | null
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();

  const live = await adapter.select<{ eventId: string }>(DELIVERIES_TABLE, {
    where: {
      and: [
        { column: "eventId", op: "IN", value: eventIds },
        { column: "status", op: "IN", value: [...LIVE_DELIVERY_STATUSES] },
      ],
    },
    columns: ["event_id"],
  });
  const retained = new Set(live.map(r => r.eventId));

  // With deliveries kept forever there is no cutoff to compare against, so any
  // delivery at all pins its event.
  const young = await adapter.select<{ eventId: string }>(DELIVERIES_TABLE, {
    where: {
      and: [
        { column: "eventId", op: "IN", value: eventIds },
        ...(deliveryCutoff
          ? ([
              { column: "updatedAt", op: ">=", value: deliveryCutoff },
            ] as const)
          : []),
      ],
    },
    columns: ["event_id"],
  });
  for (const row of young) retained.add(row.eventId);

  return retained;
}

/**
 * Prune one class of event. Returns the number deleted.
 *
 * Each batch selects candidate ids oldest-first, drops the ones still holding
 * live deliveries, and deletes the remainder by id. A batch that yields fewer
 * candidates than the batch size means the table is exhausted for this class.
 */
async function pruneEventClass(
  deps: PruneDeps,
  policy: ResolvedWebhookRetentionConfig,
  eventClass: EventRetentionClass,
  cutoff: Date,
  budget: { batchesLeft: number },
  options: PruneOptions,
  requireFanOut: boolean,
  deliveryCutoff: Date | null
): Promise<{ deleted: number; exhausted: boolean }> {
  let deleted = 0;
  // Rows this pass has looked at and will not delete: those held by a live
  // delivery, and in a dry run every row it merely counted. Deleted rows leave
  // the table, so the skipped ones collect at the front of the next read and
  // the cursor steps over them. Without it a batch-sized wall of stuck
  // deliveries would hide every younger eligible row behind it forever, and a
  // dry run would keep recounting its first batch.
  let skipped = 0;

  while (budget.batchesLeft > 0) {
    const candidates = await deps.adapter.select<{ id: string }>(EVENTS_TABLE, {
      where: {
        and: [
          { column: "retentionClass", op: "=", value: eventClass },
          ...(requireFanOut
            ? ([{ column: "fannedOutAt", op: "IS NOT NULL" }] as const)
            : []),
          { column: "createdAt", op: "<", value: cutoff },
        ],
      },
      orderBy: [{ column: "createdAt", direction: "asc" }],
      limit: policy.batchSize,
      offset: skipped,
      columns: ["id"],
    });

    // The steady state is "nothing to prune"; that costs one index probe and
    // takes no write lock.
    if (candidates.length === 0) return { deleted, exhausted: true };

    const ids = candidates.map(c => c.id);
    const blocked = await eventIdsWithRetainedDeliveries(
      deps.adapter,
      ids,
      deliveryCutoff
    );
    const deletable = ids.filter(id => !blocked.has(id));

    budget.batchesLeft -= 1;

    if (options.dryRun) {
      deleted += deletable.length;
      skipped += candidates.length;
    } else {
      if (deletable.length > 0) {
        deleted += await deps.adapter.delete(EVENTS_TABLE, {
          and: [{ column: "id", op: "IN", value: deletable }],
        });
      }
      skipped += blocked.size;
    }

    // A short read means no more rows match; a full one may have more behind it.
    if (candidates.length < policy.batchSize) {
      return { deleted, exhausted: true };
    }
  }

  return { deleted, exhausted: false };
}

/** Prune terminal delivery rows that have aged out ahead of their event. */
async function pruneDeliveries(
  deps: PruneDeps,
  policy: ResolvedWebhookRetentionConfig,
  cutoff: Date,
  budget: { batchesLeft: number },
  options: PruneOptions
): Promise<{ deleted: number; exhausted: boolean }> {
  let deleted = 0;
  // Only meaningful in a dry run, where nothing leaves the table; a real pass
  // deletes every row it reads here, so the next read starts fresh.
  let skipped = 0;

  while (budget.batchesLeft > 0) {
    const candidates = await deps.adapter.select<{ id: string }>(
      DELIVERIES_TABLE,
      {
        where: {
          and: [
            {
              column: "status",
              op: "IN",
              value: [...TERMINAL_DELIVERY_STATUSES],
            },
            // Aged from the terminal transition, which `finalizeDelivery`
            // stamps on `updated_at`, not from creation. A delivery that
            // retried for days before succeeding would otherwise be deleted the
            // moment it finished, losing the attempt log exactly when it became
            // worth reading.
            { column: "updatedAt", op: "<", value: cutoff },
          ],
        },
        orderBy: [{ column: "updatedAt", direction: "asc" }],
        limit: policy.batchSize,
        offset: skipped,
        columns: ["id"],
      }
    );

    if (candidates.length === 0) return { deleted, exhausted: true };

    budget.batchesLeft -= 1;
    const ids = candidates.map(c => c.id);

    if (options.dryRun) {
      deleted += ids.length;
      skipped += ids.length;
    } else {
      deleted += await deps.adapter.delete(DELIVERIES_TABLE, {
        and: [{ column: "id", op: "IN", value: ids }],
      });
    }

    if (candidates.length < policy.batchSize) {
      return { deleted, exhausted: true };
    }
  }

  return { deleted, exhausted: false };
}

/**
 * Run one retention pass.
 *
 * Deliveries are pruned first and on their own, shorter window: they grow as
 * events x matching endpoints and carry the per-attempt log, so they are the
 * larger share of the volume. Only terminal rows are eligible, which makes the
 * prune set disjoint from the set the drain claims — the two cannot contend for
 * the same rows by construction rather than by locking.
 */
export async function pruneWebhookData(
  deps: PruneDeps,
  policy: ResolvedWebhookRetentionConfig,
  options: PruneOptions = {}
): Promise<PruneResult> {
  const now = (deps.now ?? (() => new Date()))();
  const result = emptyResult();
  const budget = { batchesLeft: policy.maxBatchesPerRun };

  const deliveryCutoff = cutoffFor(now, policy.deliveriesMaxAgeMs);
  if (deliveryCutoff) {
    const outcome = await pruneDeliveries(
      deps,
      policy,
      deliveryCutoff,
      budget,
      options
    );
    result.deliveries = outcome.deleted;
    if (!outcome.exhausted) result.truncated = true;
  }

  // Resolved once per pass rather than per class: an install either has an
  // endpoint or it does not, and this decides whether an un-fanned-out event is
  // safe to remove. Skipped entirely when every class is kept forever, so a
  // policy that prunes nothing costs no queries at all.
  const anyClassPrunable = EVENT_RETENTION_CLASSES.some(
    c => windowForClass(policy, c) !== false
  );
  const requireFanOut = anyClassPrunable
    ? await deliveryIsPossible(deps.adapter)
    : false;

  for (const eventClass of EVENT_RETENTION_CLASSES) {
    const cutoff = cutoffFor(now, windowForClass(policy, eventClass));
    if (!cutoff) continue;
    // A delivery can only hold its event back within the event's own window.
    // Otherwise a long delivery window would silently override a short event
    // one — with events kept an hour and deliveries a week, any event that was
    // ever delivered would live the full week. The later of the two cutoffs is
    // the shorter effective window, and a null delivery cutoff means keep
    // forever, which the config already documents as winning over the cascade.
    const pinCutoff =
      deliveryCutoff === null
        ? null
        : new Date(Math.max(deliveryCutoff.getTime(), cutoff.getTime()));

    const outcome = await pruneEventClass(
      deps,
      policy,
      eventClass,
      cutoff,
      budget,
      options,
      requireFanOut,
      pinCutoff
    );
    result.events[eventClass] = outcome.deleted;
    if (!outcome.exhausted) result.truncated = true;
  }

  result.batches = policy.maxBatchesPerRun - budget.batchesLeft;

  if (result.batches > 0) {
    deps.logger?.debug?.("webhook retention pass complete", {
      events: result.events,
      deliveries: result.deliveries,
      batches: result.batches,
      truncated: result.truncated,
      dryRun: options.dryRun === true,
    });
  }

  return result;
}

/**
 * Run a pass without letting a failure reach the caller.
 *
 * Used by the seams that hang off a user write. Retention must never turn a
 * successful content save into a failed request, so a prune error is logged and
 * swallowed; the next pass will retry the same rows.
 */
export async function pruneWebhookDataSafely(
  deps: PruneDeps,
  policy: ResolvedWebhookRetentionConfig,
  options: PruneOptions = {}
): Promise<PruneResult> {
  try {
    return await pruneWebhookData(deps, policy, options);
  } catch (error) {
    deps.logger?.warn?.(
      "webhook retention pass failed; rows stay until the next pass",
      {
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return emptyResult();
  }
}
