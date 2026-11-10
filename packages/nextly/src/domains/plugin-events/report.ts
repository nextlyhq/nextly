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
 * Every delivery that needs an operator, in id order, read a page at a time
 * so none is left out however many there are. Each page starts after the
 * last id the one before it read, not at a count of rows: a delivery settled
 * or newly stuck while the report reads cannot shift a page past another.
 */
export async function reportStuckDeliveries(
  adapter: Pick<DrizzleAdapter, "select">,
  options: { pageSize?: number } = {}
): Promise<StuckDelivery[]> {
  const pageSize = options.pageSize ?? REPORT_PAGE;
  const all: StuckDelivery[] = [];
  let after: string | undefined;
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
        where: {
          and:
            after === undefined
              ? [STUCK]
              : [STUCK, { column: "id", op: ">", value: after }],
        },
        orderBy: [{ column: "id", direction: "asc" }],
        limit: pageSize,
      }
    );
    all.push(...page);
    if (page.length < pageSize) return all;
    after = page[page.length - 1]?.id;
  }
}

/** What a subscriber has stuck: deliveries held for it, out of attempts, or both. */
interface Stuck {
  subscriber: string;
  held: boolean;
  failed: boolean;
}

/** The warning for one stuck subscriber. */
function warningOf({ subscriber, held, failed }: Stuck): string {
  const what = [
    ...(held ? ["some are held for a subscriber that is not registered"] : []),
    ...(failed ? ["some ran out of attempts"] : []),
  ].join(", and ");
  return `Durable event deliveries to "${subscriber}" are stuck: ${what}. List them with \`nextly events report\`; give them up with \`nextly events abandon --subscriber ${subscriber}\`.`;
}

/** A stored (subscriber, status) pair of a stuck delivery. */
interface StuckRow {
  subscriber: string;
  subscriberKey: string;
  status: string;
}

/**
 * What each subscriber has stuck, by its key, leaving out a delivery held for
 * a subscriber that is registered again: the pass runs it.
 */
function stuckBySubscriber(
  rows: readonly StuckRow[],
  isRegistered: (subscriber: string) => boolean
): Map<string, Stuck> {
  const stuck = new Map<string, Stuck>();
  for (const row of rows) {
    const held = row.status === "held";
    if (held && isRegistered(row.subscriber)) continue;
    const entry = stuck.get(row.subscriberKey) ?? {
      subscriber: row.subscriber,
      held: false,
      failed: false,
    };
    entry.held ||= held;
    entry.failed ||= !held;
    stuck.set(row.subscriberKey, entry);
  }
  return stuck;
}

/**
 * The dispatcher's warnings about stuck subscribers: one when a subscriber
 * first becomes stuck, then at most one an hour while it stays so. Kept in
 * memory, so a restart warns again, which is as it should be.
 *
 * One read a pass, however many subscribers are stuck: the distinct
 * subscribers and statuses, with no count of each (the report has those).
 * A delivery held for a subscriber that is registered again is left out: the
 * pass runs it. A logger that throws fails nothing, and the subscriber is
 * warned about again on the next pass.
 */
export function createStuckWarnings(logger: Pick<Logger, "warn">): {
  check(
    adapter: Pick<DrizzleAdapter, "select">,
    now: Date,
    isRegistered: (subscriber: string) => boolean
  ): Promise<void>;
} {
  const warnedAt = new Map<string, number>();

  /** Warn about `entry` unless it was warned about within the hour. */
  const warnOnce = (key: string, entry: Stuck, now: Date): void => {
    const last = warnedAt.get(key);
    if (last !== undefined && now.getTime() - last < WARN_INTERVAL_MS) return;
    try {
      logger.warn(warningOf(entry), {
        subscriber: entry.subscriber,
        held: entry.held,
        failed: entry.failed,
      });
      // Only once the warning is written.
      warnedAt.set(key, now.getTime());
    } catch {
      // An app-supplied logger that throws must not fail a dispatch whose
      // deliveries are already recorded; the next pass warns again.
    }
  };

  return {
    async check(adapter, now, isRegistered) {
      const rows = await adapter.select<StuckRow>(
        PLUGIN_EVENT_DELIVERIES_TABLE,
        {
          columns: ["subscriber", "subscriberKey", "status"],
          where: { and: [STUCK] },
          distinct: true,
        }
      );
      const stuck = stuckBySubscriber(rows, isRegistered);
      // A subscriber no longer stuck is forgotten: stuck again later, it is
      // warned about at once.
      for (const key of warnedAt.keys()) {
        if (!stuck.has(key)) warnedAt.delete(key);
      }
      for (const [key, entry] of stuck) warnOnce(key, entry, now);
    },
  };
}
