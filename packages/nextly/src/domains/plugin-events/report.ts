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

/** The deliveries one page of the report reads. */
const REPORT_PAGE = 500;
/** How often a subscriber that stays stuck is warned about again. */
const WARN_INTERVAL_MS = 60 * 60 * 1000;
/** The statuses that need an operator. */
const STUCK = { column: "status", op: "IN" as const, value: ["held", "failed"] };

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

/**
 * Every delivery that needs an operator, oldest first, read a page at a time
 * so none is left out however many there are.
 */
export async function reportStuckDeliveries(
  adapter: Pick<DrizzleAdapter, "select">,
  options: { pageSize?: number } = {}
): Promise<StuckDelivery[]> {
  const pageSize = options.pageSize ?? REPORT_PAGE;
  const all: StuckDelivery[] = [];
  for (;;) {
    const page = await adapter.select<StuckDelivery>(
      PLUGIN_EVENT_DELIVERIES_TABLE,
      {
        columns: [
          "id",
          "eventId",
          "subscriber",
          "status",
          "attemptCount",
          "lastError",
        ],
        where: { and: [STUCK] },
        // The id breaks ties, so pages neither repeat nor skip a delivery.
        orderBy: [
          { column: "createdAt", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        limit: pageSize,
        offset: all.length,
      }
    );
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

/** One subscriber's held and failed deliveries, counted in the database. */
async function stuckCountsOf(
  adapter: Pick<DrizzleAdapter, "count">,
  subscriberKey: string
): Promise<{ held: number; failed: number }> {
  const countOf = (status: string) =>
    adapter.count(PLUGIN_EVENT_DELIVERIES_TABLE, {
      where: {
        and: [
          { column: "subscriberKey", op: "=", value: subscriberKey },
          { column: "status", op: "=", value: status },
        ],
      },
    });
  return { held: await countOf("held"), failed: await countOf("failed") };
}

/**
 * The dispatcher's warnings about stuck subscribers: one when a subscriber
 * first becomes stuck, then at most one an hour while it stays so. Kept in
 * memory, so a restart warns again, which is as it should be. The
 * subscribers are read distinct and each one's deliveries counted in the
 * database, so none is missed and no count is short, however many are stuck.
 * A logger that throws fails nothing, and the subscriber is warned about
 * again on the next pass.
 */
export function createStuckWarnings(logger: Pick<Logger, "warn">): {
  check(
    adapter: Pick<DrizzleAdapter, "select" | "count">,
    now: Date
  ): Promise<void>;
} {
  const warnedAt = new Map<string, number>();
  return {
    async check(adapter, now) {
      const stuck = await adapter.select<{
        subscriber: string;
        subscriberKey: string;
      }>(PLUGIN_EVENT_DELIVERIES_TABLE, {
        columns: ["subscriber", "subscriberKey"],
        where: { and: [STUCK] },
        distinct: true,
      });
      const keys = new Set(stuck.map(row => row.subscriberKey));
      // A subscriber no longer stuck is forgotten: stuck again later, it is
      // warned about at once.
      for (const key of warnedAt.keys()) {
        if (!keys.has(key)) warnedAt.delete(key);
      }
      for (const { subscriber, subscriberKey } of stuck) {
        const last = warnedAt.get(subscriberKey);
        if (last !== undefined && now.getTime() - last < WARN_INTERVAL_MS) {
          continue;
        }
        const { held, failed } = await stuckCountsOf(adapter, subscriberKey);
        try {
          logger.warn(
            `Durable event deliveries to "${subscriber}" are stuck: ${held} held for a subscriber that is not registered, ${failed} out of attempts. List them with \`nextly events report\`; give them up with \`nextly events abandon --subscriber ${subscriber}\`.`,
            { subscriber, held, failed }
          );
          // Only once the warning is written.
          warnedAt.set(subscriberKey, now.getTime());
        } catch {
          // An app-supplied logger that throws must not fail a dispatch whose
          // deliveries are already recorded; the next pass warns again.
        }
      }
    },
  };
}
