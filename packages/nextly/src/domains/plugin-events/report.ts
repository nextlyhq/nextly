/**
 * Reporting durable-event deliveries that need an operator: those held for a
 * subscriber no longer registered, and those that ran out of attempts.
 *
 * The report reads the deliveries' own status, so it answers the same in any
 * process, the CLI included, where no plugin has registered a subscriber. The
 * dispatcher also warns about them in its log, when a subscriber first becomes
 * stuck and then at most once an hour while it stays so, naming the commands
 * that show and give them up.
 *
 * @module domains/plugin-events/report
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { PLUGIN_EVENT_DELIVERIES_TABLE } from "../../schemas/plugin-events";
import type { Logger } from "../../shared/types";

/** The most deliveries one report reads. */
const REPORT_LIMIT = 500;
/** How often a subscriber that stays stuck is warned about again. */
const WARN_INTERVAL_MS = 60 * 60 * 1000;

/** @experimental A delivery that needs an operator. */
export interface StuckDelivery {
  id: string;
  eventId: string;
  subscriber: string;
  /** `held` (its subscriber is not registered) or `failed` (out of attempts). */
  status: "held" | "failed";
  attemptCount: number;
  lastError: string | null;
}

/** The deliveries that need an operator, oldest first. */
export async function reportStuckDeliveries(
  adapter: Pick<DrizzleAdapter, "select">
): Promise<StuckDelivery[]> {
  return adapter.select<StuckDelivery>(PLUGIN_EVENT_DELIVERIES_TABLE, {
    columns: [
      "id",
      "eventId",
      "subscriber",
      "status",
      "attemptCount",
      "lastError",
    ],
    where: {
      and: [{ column: "status", op: "IN", value: ["held", "failed"] }],
    },
    orderBy: [{ column: "createdAt", direction: "asc" }],
    limit: REPORT_LIMIT,
  });
}

/** How many of a subscriber's deliveries are held, and how many failed. */
interface StuckCounts {
  held: number;
  failed: number;
}

/** `deliveries` counted by subscriber. */
function stuckBySubscriber(
  deliveries: readonly StuckDelivery[]
): Map<string, StuckCounts> {
  const counts = new Map<string, StuckCounts>();
  for (const delivery of deliveries) {
    const entry = counts.get(delivery.subscriber) ?? { held: 0, failed: 0 };
    entry[delivery.status] += 1;
    counts.set(delivery.subscriber, entry);
  }
  return counts;
}

/**
 * The dispatcher's warnings about stuck subscribers: one when a subscriber
 * first becomes stuck, then at most one an hour while it stays so. Kept in
 * memory, so a restart warns again, which is as it should be.
 */
export function createStuckWarnings(logger: Pick<Logger, "warn">): {
  check(adapter: Pick<DrizzleAdapter, "select">, now: Date): Promise<void>;
} {
  const warnedAt = new Map<string, number>();
  return {
    async check(adapter, now) {
      const counts = stuckBySubscriber(await reportStuckDeliveries(adapter));
      // A subscriber no longer stuck is forgotten: stuck again later, it is
      // warned about at once.
      for (const subscriber of warnedAt.keys()) {
        if (!counts.has(subscriber)) warnedAt.delete(subscriber);
      }
      for (const [subscriber, { held, failed }] of counts) {
        const last = warnedAt.get(subscriber);
        if (last !== undefined && now.getTime() - last < WARN_INTERVAL_MS) {
          continue;
        }
        warnedAt.set(subscriber, now.getTime());
        logger.warn(
          `Durable event deliveries to "${subscriber}" are stuck: ${held} held for a subscriber that is not registered, ${failed} out of attempts. List them with \`nextly events report\`; give them up with \`nextly events abandon --subscriber ${subscriber}\`.`,
          { subscriber, held, failed }
        );
      }
    },
  };
}
