/**
 * Removing received-webhook claims once they no longer stand for anything.
 *
 * A processed delivery's record is kept 30 days after it was processed: a
 * provider's retries come within hours, and the record is also what refuses a
 * replay of a delivery whose scheme signs no time, for those 30 days. A
 * pending claim whose lease ended goes 30 days after its end, never processed;
 * a retry that late is processed afresh. A live lease is never removed: its
 * lease ends within the hour, so it is never older than the cutoff. Sweeps run
 * on the retention runner, offered by the write paths and by the scheduled
 * drain.
 *
 * @module plugins/security/received-webhooks-prune
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { RECEIVED_WEBHOOKS_TABLE } from "../../schemas/received-webhooks";

/** How long a claim is kept after its delivery was processed or its lease ended. */
const RECEIVED_WEBHOOKS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** How often the sweep is offered. */
export const RECEIVED_WEBHOOKS_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Rows removed per batch, each batch in a transaction of its own. */
const BATCH = 500;

/**
 * What the sweep needs from the database adapter. `transaction` is optional
 * only so a test double of the retention adapter need not supply one; every
 * real adapter has it, and the sweep uses it whenever it is there.
 */
export type ReceivedWebhooksPruneAdapter = Pick<
  DrizzleAdapter,
  "select" | "delete"
> &
  Partial<Pick<DrizzleAdapter, "transaction">>;

/** Bounds on one sweep. */
export interface ReceivedWebhooksPruneLimits {
  /** At most this many batches, for a capped pass offered by a write. */
  maxBatches?: number;
  /** Stop between batches once the clock reaches this moment. */
  deadline?: number;
  /** The clock the deadline is read on; defaults to `Date.now`. */
  clock?: () => number;
}

/**
 * Remove every claim past its retention, oldest first, in batches, within the
 * limits given. Returns how many rows went, and whether any batch was
 * attempted, which the drain tells apart from a sweep of an empty table.
 */
export async function pruneReceivedWebhooks(
  adapter: ReceivedWebhooksPruneAdapter,
  now: Date,
  limits: ReceivedWebhooksPruneLimits = {}
): Promise<{ removed: number; started: boolean }> {
  const cutoff = new Date(now.getTime() - RECEIVED_WEBHOOKS_RETENTION_MS);
  const maxBatches = limits.maxBatches ?? Number.POSITIVE_INFINITY;
  const clock = limits.clock ?? Date.now;
  let removed = 0;
  let started = false;
  for (let batch = 0; batch < maxBatches; batch++) {
    if (limits.deadline !== undefined && clock() >= limits.deadline) break;
    started = true;
    const rows = await adapter.select<{ deliveryKey: string }>(
      RECEIVED_WEBHOOKS_TABLE,
      {
        columns: ["deliveryKey"],
        where: { and: [{ column: "pruneAt", op: "<", value: cutoff }] },
        orderBy: [{ column: "pruneAt", direction: "asc" }],
        limit: BATCH,
      }
    );
    if (rows.length === 0) break;
    // The cutoff again, so a row claimed afresh since it was read is kept.
    const where = {
      and: [
        {
          column: "deliveryKey",
          op: "IN" as const,
          value: rows.map(row => row.deliveryKey),
        },
        { column: "pruneAt", op: "<" as const, value: cutoff },
      ],
    };
    // In a transaction, never as a lone statement: on SQLite a lone statement
    // joins whatever transaction another flow has open and rolls back with it.
    removed += adapter.transaction
      ? await adapter.transaction(tx =>
          tx.delete(RECEIVED_WEBHOOKS_TABLE, where)
        )
      : await adapter.delete(RECEIVED_WEBHOOKS_TABLE, where);
    if (rows.length < BATCH) break;
  }
  return { removed, started };
}
