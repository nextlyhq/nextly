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

import { RECEIVED_WEBHOOKS_TABLE } from "../../schemas/received-webhooks";

import {
  pruneInBatches,
  type PruneInBatchesAdapter,
  type PruneInBatchesLimits,
} from "./prune-in-batches";

/** How long a claim is kept after its delivery was processed or its lease ended. */
const RECEIVED_WEBHOOKS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** How often the sweep is offered. */
export const RECEIVED_WEBHOOKS_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** What the sweep needs from the database adapter. */
export type ReceivedWebhooksPruneAdapter = PruneInBatchesAdapter;

/** Bounds on one sweep. */
export type ReceivedWebhooksPruneLimits = PruneInBatchesLimits;

/**
 * Remove every claim past its retention, oldest first, in batches, within the
 * limits given. Returns how many rows went, and whether any batch was
 * attempted, which the drain tells apart from a sweep of an empty table.
 */
export function pruneReceivedWebhooks(
  adapter: ReceivedWebhooksPruneAdapter,
  now: Date,
  limits: ReceivedWebhooksPruneLimits = {}
): Promise<{ removed: number; started: boolean }> {
  return pruneInBatches(
    adapter,
    {
      table: RECEIVED_WEBHOOKS_TABLE,
      key: "deliveryKey",
      at: "pruneAt",
      cutoff: new Date(now.getTime() - RECEIVED_WEBHOOKS_RETENTION_MS),
      oldestFirst: true,
    },
    limits
  );
}
