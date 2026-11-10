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

import {
  settleDelivery,
  subscriberKeyOf,
  type DispatchAdapter,
} from "./dispatch";

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
 * and change nothing. Refused when the selector names neither, or both. A
 * delivery a dispatcher is running under an unexpired lease is left alone:
 * its handler may still succeed, and the operator can try again once the
 * attempt has settled or its lease has run out.
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
  const now = options.now ?? (() => new Date());
  const open = { column: "status", op: "IN" as const, value: OPEN };
  // A subscriber is matched by its key, compared exactly on every dialect:
  // the name's own column follows the database's collation, which on MySQL
  // matches names that differ in letter case.
  const named = byId
    ? { column: "id", op: "=" as const, value: selector.deliveryId }
    : {
        column: "subscriberKey",
        op: "=" as const,
        value: subscriberKeyOf(selector.subscriber ?? ""),
      };
  const leaseFree = (at: Date) => ({
    or: [
      { column: "lockedUntil", op: "IS NULL" as const },
      { column: "lockedUntil", op: "<" as const, value: at },
    ],
  });
  const deliveries = await adapter.select<AbandonedDelivery>(
    PLUGIN_EVENT_DELIVERIES_TABLE,
    {
      columns: ["id", "eventId", "subscriber", "status"],
      // A dry run leaves out the deliveries under a lease, as the real run
      // would; the real run reads them all and judges the lease in its update
      // instead, the one place that also sees a lease taken since this read.
      where: {
        and: options.dryRun ? [named, open, leaseFree(now())] : [named, open],
      },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    }
  );
  if (options.dryRun) return deliveries;

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
          // Only while still open and free: delivered meanwhile, it stays
          // delivered, and leased meanwhile, its attempt goes on.
          {
            and: [
              { column: "id", op: "=", value: delivery.id },
              open,
              leaseFree(at),
            ],
          }
        )
      )
    );
    if (closed) abandoned.push(delivery);
  }
  return abandoned;
}
