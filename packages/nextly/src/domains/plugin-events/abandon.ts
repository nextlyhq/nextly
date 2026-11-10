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
import type { WhereClause } from "@nextlyhq/adapter-drizzle/types";

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
const OPEN = {
  column: "status",
  op: "IN" as const,
  value: ["pending", "held", "failed"],
};
/** Deliveries read, and abandoned, per page at most. */
const ABANDON_PAGE = 500;

/** No dispatcher holds the delivery's lease at `at`. */
function leaseFree(at: Date) {
  return {
    or: [
      { column: "lockedUntil", op: "IS NULL" as const },
      { column: "lockedUntil", op: "<" as const, value: at },
    ],
  };
}

/**
 * Abandon one delivery, closing its event when it was the last one open.
 * Only while it is still open and free: delivered meanwhile, it stays
 * delivered, and leased meanwhile, its attempt goes on. Whether it changed.
 */
function abandonOne(
  adapter: DispatchAdapter,
  delivery: AbandonedDelivery,
  at: Date
): Promise<boolean> {
  return adapter.transaction(tx =>
    settleDelivery(tx, adapter.dialect, delivery.eventId, at, () =>
      tx.updateCount(
        PLUGIN_EVENT_DELIVERIES_TABLE,
        {
          status: "abandoned",
          finishedAt: at,
          lockedBy: null,
          lockedUntil: null,
        },
        {
          and: [
            { column: "id", op: "=", value: delivery.id },
            OPEN,
            leaseFree(at),
          ],
        }
      )
    )
  );
}

/**
 * The conditions one page is read by: the deliveries `selector` names, still
 * open, after the last id the page before read. A subscriber is matched by
 * its key, compared exactly on every dialect: the name's own column follows
 * the database's collation, which on MySQL matches names that differ in
 * letter case. A dry run leaves out the deliveries under a lease, as the real
 * run would; the real run reads them all and judges the lease in its update
 * instead, the one place that also sees a lease taken since this read.
 */
function pageConditions(
  selector: AbandonSelector,
  dryRun: boolean | undefined,
  now: () => Date,
  after: string | undefined
): NonNullable<WhereClause["and"]> {
  const named =
    selector.deliveryId !== undefined
      ? { column: "id", op: "=" as const, value: selector.deliveryId }
      : {
          column: "subscriberKey",
          op: "=" as const,
          value: subscriberKeyOf(selector.subscriber ?? ""),
        };
  return [
    named,
    OPEN,
    ...(dryRun ? [leaseFree(now())] : []),
    ...(after === undefined
      ? []
      : [{ column: "id", op: ">" as const, value: after }]),
  ];
}

/**
 * Abandon the open deliveries `selector` names, or with `dryRun`, name them
 * and change nothing. Refused when the selector names neither, or both. A
 * delivery a dispatcher is running under an unexpired lease is left alone:
 * its handler may still succeed, and the operator can try again once the
 * attempt has settled or its lease has run out.
 *
 * Read and abandoned a page at a time, in id order, each page starting after
 * the last id the one before read, so a subscriber's whole backlog is worked
 * through without being read at once.
 */
export async function abandonDurableDeliveries(
  adapter: DispatchAdapter,
  selector: AbandonSelector,
  options: { dryRun?: boolean; now?: () => Date; pageSize?: number } = {}
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
  const pageSize = options.pageSize ?? ABANDON_PAGE;
  const result: AbandonedDelivery[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await adapter.select<AbandonedDelivery>(
      PLUGIN_EVENT_DELIVERIES_TABLE,
      {
        columns: ["id", "eventId", "subscriber", "status"],
        where: { and: pageConditions(selector, options.dryRun, now, after) },
        orderBy: [{ column: "id", direction: "asc" }],
        limit: pageSize,
      }
    );
    for (const delivery of page) {
      if (options.dryRun || (await abandonOne(adapter, delivery, now()))) {
        result.push(delivery);
      }
    }
    if (page.length < pageSize) return result;
    after = page[page.length - 1]?.id;
  }
}
