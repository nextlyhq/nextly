/**
 * Abandoning durable-event deliveries: an operator's decision that a delivery
 * will never be made, for one held for a subscriber that is gone, or one that
 * ran out of attempts.
 *
 * An abandoned delivery keeps its attempts and its last failure as the record
 * of what happened, is never tried again, and counts as finished: an event
 * whose deliveries are all delivered or abandoned is finished, and pruned
 * after the retention.
 *
 * @module domains/plugin-events/abandon
 * @experimental
 */
import { NextlyError } from "../../errors/nextly-error";
import { PLUGIN_EVENT_DELIVERIES_TABLE } from "../../schemas/plugin-events";

import { settleDelivery, type DispatchAdapter } from "./dispatch";

/** Which deliveries to abandon: one by id, or every one owed to a subscriber. */
export interface AbandonSelector {
  deliveryId?: string;
  /** `<plugin>:<name>`, as the report shows it. */
  subscriber?: string;
}

/** A delivery abandoned, or that would be. */
export interface AbandonedDelivery {
  id: string;
  eventId: string;
  subscriber: string;
  status: string;
}

/** The statuses a delivery may be abandoned from: any not yet finished. */
const OPEN = ["pending", "held", "failed"];

/**
 * Abandon the open deliveries `selector` names, or with `dryRun`, name them
 * and change nothing. Refused when the selector names neither, or both.
 */
export async function abandonDurableDeliveries(
  adapter: DispatchAdapter,
  selector: AbandonSelector,
  options: { dryRun?: boolean; now?: () => Date } = {}
): Promise<AbandonedDelivery[]> {
  const byId = selector.deliveryId !== undefined;
  const bySubscriber = selector.subscriber !== undefined;
  if (byId === bySubscriber) {
    throw NextlyError.invalidInput({
      message:
        "Name the deliveries to abandon by a delivery id or by a subscriber, and only one of the two.",
    });
  }
  const open = { column: "status", op: "IN" as const, value: OPEN };
  const named = byId
    ? { column: "id", op: "=" as const, value: selector.deliveryId }
    : { column: "subscriber", op: "=" as const, value: selector.subscriber };
  const deliveries = await adapter.select<AbandonedDelivery>(
    PLUGIN_EVENT_DELIVERIES_TABLE,
    {
      columns: ["id", "eventId", "subscriber", "status"],
      where: { and: [named, open] },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    }
  );
  if (options.dryRun) return deliveries;

  const now = options.now ?? (() => new Date());
  const abandoned: AbandonedDelivery[] = [];
  for (const delivery of deliveries) {
    const at = now();
    // One at a time, each closing its event when it was the last one open.
    const closed = await adapter.transaction(tx =>
      settleDelivery(tx, adapter.dialect, delivery.eventId, at, () =>
        tx.updateCount(
          PLUGIN_EVENT_DELIVERIES_TABLE,
          {
            status: "abandoned",
            finishedAt: at,
            lockedBy: null,
            lockedUntil: null,
          },
          // Only while still open: delivered meanwhile, it stays delivered.
          {
            and: [{ column: "id", op: "=", value: delivery.id }, open],
          }
        )
      )
    );
    if (closed) abandoned.push(delivery);
  }
  return abandoned;
}
