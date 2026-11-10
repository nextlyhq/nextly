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
/**
 * How long past due a held delivery whose subscriber is registered again may
 * wait before it is warned about: it is due to run, but a lasting backlog can
 * keep every pass from reaching it.
 */
const OVERDUE_MS = 60 * 60 * 1000;
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

/**
 * What a subscriber has stuck: deliveries held for it while it is not
 * registered, held over an hour past due though it is, out of attempts, or
 * any of these.
 */
interface Stuck {
  subscriber: string;
  held: boolean;
  overdue: boolean;
  failed: boolean;
}

/** The warning for one stuck subscriber. */
function warningOf({ subscriber, held, overdue, failed }: Stuck): string {
  const what = [
    ...(held ? ["some are held for a subscriber that is not registered"] : []),
    ...(overdue
      ? ["some are held and have waited over an hour past due to run"]
      : []),
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
 * What each subscriber has stuck, by its key. A delivery held for a
 * subscriber that is registered again is left out, as a pass will run it,
 * unless it has waited over an hour past due (`overdue`): then a backlog is
 * keeping every pass from reaching it.
 */
function stuckBySubscriber(
  rows: readonly StuckRow[],
  isRegistered: (subscriber: string) => boolean,
  overdue: ReadonlySet<string>
): Map<string, Stuck> {
  const stuck = new Map<string, Stuck>();
  for (const row of rows) {
    const kind = kindOf(row, isRegistered, overdue);
    if (kind === undefined) continue;
    const entry = stuck.get(row.subscriberKey) ?? {
      subscriber: row.subscriber,
      held: false,
      overdue: false,
      failed: false,
    };
    entry[kind] = true;
    stuck.set(row.subscriberKey, entry);
  }
  return stuck;
}

/**
 * Why one stuck row is warned about, or undefined when it is not: a held
 * delivery whose subscriber is back and not yet overdue will be run.
 */
function kindOf(
  row: StuckRow,
  isRegistered: (subscriber: string) => boolean,
  overdue: ReadonlySet<string>
): "held" | "overdue" | "failed" | undefined {
  if (row.status !== "held") return "failed";
  if (!isRegistered(row.subscriber)) return "held";
  return overdue.has(row.subscriberKey) ? "overdue" : undefined;
}

/**
 * The subscribers with a held delivery over an hour past due, read only when
 * some held delivery's subscriber is registered again.
 */
async function overdueHeld(
  adapter: Pick<DrizzleAdapter, "select">,
  rows: readonly StuckRow[],
  isRegistered: (subscriber: string) => boolean,
  now: Date
): Promise<ReadonlySet<string>> {
  const anyBack = rows.some(
    row => row.status === "held" && isRegistered(row.subscriber)
  );
  if (!anyBack) return new Set();
  const late = await adapter.select<{ subscriberKey: string }>(
    PLUGIN_EVENT_DELIVERIES_TABLE,
    {
      columns: ["subscriberKey"],
      where: {
        and: [
          { column: "status", op: "=", value: "held" },
          {
            column: "nextAttemptAt",
            op: "<",
            value: new Date(now.getTime() - OVERDUE_MS),
          },
        ],
      },
      distinct: true,
    }
  );
  return new Set(late.map(row => row.subscriberKey));
}

/**
 * The dispatcher's warnings about stuck subscribers: one when a subscriber
 * first becomes stuck, then at most one an hour while it stays so. Kept in
 * memory, so a restart warns again, which is as it should be.
 *
 * One read a pass, however many subscribers are stuck: the distinct
 * subscribers and statuses, with no count of each (the report has those),
 * and a second only when a held delivery's subscriber is registered again. Such
 * a delivery is left out until it has waited over an hour past due. A logger that throws fails nothing, and the subscriber is
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
        overdue: entry.overdue,
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
      const stuck = stuckBySubscriber(
        rows,
        isRegistered,
        await overdueHeld(adapter, rows, isRegistered, now)
      );
      // A subscriber no longer stuck is forgotten: stuck again later, it is
      // warned about at once.
      for (const key of warnedAt.keys()) {
        if (!stuck.has(key)) warnedAt.delete(key);
      }
      for (const [key, entry] of stuck) warnOnce(key, entry, now);
    },
  };
}
