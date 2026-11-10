/**
 * Removing durable plugin events once they are finished and old: every
 * delivery succeeded or was abandoned, more than 30 days ago. An event with a
 * delivery still owed (pending, held or failed) has no finish time, so it is
 * never removed. An event goes with its deliveries, in the same transaction,
 * so no delivery outlives its event. Sweeps run on the retention runner and
 * in the scheduled drain, apart from the webhook outbox's.
 *
 * @module domains/plugin-events/prune
 */
import {
  pruneInBatches,
  type PruneInBatchesAdapter,
  type PruneInBatchesLimits,
} from "../../plugins/security/prune-in-batches";
import {
  PLUGIN_EVENT_DELIVERIES_TABLE,
  PLUGIN_EVENTS_TABLE,
} from "../../schemas/plugin-events";

/** How long a finished event is kept. */
const PLUGIN_EVENTS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** How often the sweep is offered. */
export const PLUGIN_EVENTS_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Remove every event finished more than 30 days ago, oldest first, with its
 * deliveries, in batches within `limits`.
 */
export function prunePluginEvents(
  adapter: PruneInBatchesAdapter,
  now: Date,
  limits: PruneInBatchesLimits = {}
): Promise<{ removed: number; started: boolean }> {
  return pruneInBatches(
    adapter,
    {
      table: PLUGIN_EVENTS_TABLE,
      key: "id",
      at: "finishedAt",
      cutoff: new Date(now.getTime() - PLUGIN_EVENTS_RETENTION_MS),
      oldestFirst: true,
      dependents: [{ table: PLUGIN_EVENT_DELIVERIES_TABLE, key: "eventId" }],
    },
    limits
  );
}
