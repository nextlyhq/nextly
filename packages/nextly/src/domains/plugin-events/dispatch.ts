/**
 * Dispatching durable plugin events: one pass of the `events:dispatch` job.
 *
 * A pass first fans out each event not yet dispatched, into one delivery per
 * subscriber registered now; then runs each delivery that is due, with a
 * lease, until its handler succeeds. A failed try is retried with the jobs
 * runner's backoff, across restarts, since what a delivery is owed lives only
 * in the database; one that runs out of attempts is kept as `failed`. A
 * delivery whose subscriber is no longer registered is not run, and never
 * given to another: it is held, looked at again every quarter of an hour,
 * until its subscriber returns or an operator abandons it.
 *
 * Two dispatchers at once make one delivery per event and subscriber: fanning
 * an event out and finishing it both lock the event's row first, so they run
 * one at a time per event, always event before delivery, and a delivery is run
 * only by the dispatcher whose lease it holds. A handler runs outside any
 * transaction, and may run again (a lease can run out): handlers de-duplicate
 * on the event's id.
 *
 * Times are stored to the second on SQLite, so every time this writes ahead
 * of now is rounded up to a whole second: a backoff or a lease is never
 * shorter than it was meant to be, on any dialect.
 *
 * @module domains/plugin-events/dispatch
 * @experimental
 */
import { createHash, randomUUID } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SupportedDialect,
  TransactionContext,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";
import { eq } from "drizzle-orm";

import {
  PLUGIN_EVENT_DELIVERIES_TABLE,
  PLUGIN_EVENTS_TABLE,
  pluginEventsTables,
} from "../../schemas/plugin-events";
import { redactCredentialsInText } from "../../observability/mask-emails";
import { nextAttempt } from "../jobs/job-backoff";

import type { DurableSubscribers } from "./subscribers";

/** Tries before a delivery is kept as failed. */
const DEFAULT_MAX_ATTEMPTS = 10;
/** How long a dispatcher holds a delivery it is running. */
const DEFAULT_LEASE_MS = 60_000;
/** Events fanned out, and deliveries run, per pass at most. */
const DEFAULT_BATCH = 100;
/** The longest failure kept on a delivery. */
const MAX_ERROR_LENGTH = 1000;
/**
 * How long a delivery whose subscriber is not registered waits for its next
 * look. Fixed, since a held delivery is charged no attempt: short enough that
 * one an instance without the subscriber held during a rolling deployment is
 * soon run by one that has it, long enough that deliveries held for a
 * subscriber removed for good are not read on every pass.
 */
const HOLD_MS = 15 * 60 * 1000;

/** What dispatching needs from the database adapter. */
export type DispatchAdapter = Pick<
  DrizzleAdapter,
  // `count` for the stuck-subscriber warnings' exact counts.
  "transaction" | "select" | "count" | "dialect"
>;

/** One pass's inputs. */
export interface DispatchOptions {
  adapter: DispatchAdapter;
  /** The subscribers registered in this process now. */
  subscribers: DurableSubscribers;
  /** The clock deliveries are judged by; injectable for tests. */
  now?: () => Date;
  /** Stop starting work once the wall clock reaches this, in ms. */
  deadline?: number;
  maxAttempts?: number;
  leaseMs?: number;
  batch?: number;
  /** For the backoff's jitter; injectable for tests. */
  random?: () => number;
  /**
   * Told of stuck deliveries after each pass, to warn about them at a pace
   * of its own (`createStuckWarnings`).
   */
  warnings?: { check(adapter: DispatchAdapter, now: Date): Promise<void> };
}

/** What one pass did. */
export interface DispatchResult {
  /** Events given their deliveries. */
  fannedOut: number;
  /** Deliveries whose handler succeeded. */
  delivered: number;
  /** Deliveries whose handler failed, to be tried again. */
  retried: number;
  /** Deliveries that ran out of attempts, kept as failed. */
  failed: number;
  /** Deliveries held because their subscriber is not registered. */
  held: number;
}

interface DeliveryRow {
  id: string;
  eventId: string;
  subscriber: string;
  attemptCount: number;
}

interface EventLockRow {
  name: string;
  payload: string;
  fannedOutAt: Date | null;
}

/** A read of one event, which can lock its row. */
interface EventReadDb {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): PromiseLike<EventLockRow[]> & {
        for(strength: "update"): PromiseLike<EventLockRow[]>;
      };
    };
  };
}

/** `ms` as a date, rounded up to a whole second. */
function ceilToSecond(ms: number): Date {
  return new Date(Math.ceil(ms / 1000) * 1000);
}

/**
 * The event's row, locked until the transaction ends, so one dispatcher at a
 * time fans it out or finishes it. SQLite runs one writer at a time, so its
 * writer reads the latest without a lock.
 */
async function lockEvent(
  tx: TransactionContext,
  dialect: SupportedDialect,
  eventId: string
): Promise<EventLockRow | undefined> {
  const table = pluginEventsTables(dialect).nextlyPluginEvents;
  const read = tx
    .getDrizzle<EventReadDb>()
    .select({
      name: table.name,
      payload: table.payload,
      fannedOutAt: table.fannedOutAt,
    })
    .from(table)
    .where(eq(table.id, eventId));
  const [row] = dialect === "sqlite" ? await read : await read.for("update");
  return row;
}

/**
 * A failure as kept on a delivery: its message with any credential in it
 * taken out, bounded, and storable on every dialect. PostgreSQL's text cannot
 * hold NUL, so a NUL would fail the write there alone, leaving the delivery
 * leased and its attempt uncounted; each is replaced instead.
 */
function failureOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const bounded = redactCredentialsInText(message)
    .replaceAll("\u0000", "\uFFFD")
    .slice(0, MAX_ERROR_LENGTH);
  // A cut between the halves of a surrogate pair leaves a lone half.
  return /[\uD800-\uDBFF]$/.test(bounded) ? bounded.slice(0, -1) : bounded;
}

/** Run one dispatch pass. */
export async function dispatchDurableEvents(
  options: DispatchOptions
): Promise<DispatchResult> {
  const now = options.now ?? (() => new Date());
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const batch = options.batch ?? DEFAULT_BATCH;
  const runnerId = randomUUID();
  const { adapter, subscribers } = options;
  const dialect = adapter.dialect;
  const spent = () =>
    options.deadline !== undefined && Date.now() >= options.deadline;
  const result: DispatchResult = {
    fannedOut: 0,
    delivered: 0,
    retried: 0,
    failed: 0,
    held: 0,
  };

  // The stuck-subscriber warnings first, before any bounded work: a pass that
  // runs out of time below returns early, and under a lasting backlog every
  // pass would.
  await options.warnings?.check(adapter, now());

  // Fan out the events not yet dispatched, oldest first.
  const undispatched = await adapter.select<{ id: string }>(
    PLUGIN_EVENTS_TABLE,
    {
      columns: ["id"],
      where: { and: [{ column: "fannedOutAt", op: "IS NULL" }] },
      orderBy: [{ column: "createdAt", direction: "asc" }],
      limit: batch,
    }
  );
  for (const { id } of undispatched) {
    if (spent()) return result;
    const fanned = await adapter.transaction(async tx => {
      const event = await lockEvent(tx, dialect, id);
      // Fanned out already, by another dispatcher, while this one waited.
      if (!event || event.fannedOutAt !== null) return false;
      const at = now();
      const owed = subscribers.forEvent(event.name);
      for (const subscriber of owed) {
        await tx.insert(PLUGIN_EVENT_DELIVERIES_TABLE, {
          id: randomUUID(),
          eventId: id,
          subscriber: subscriber.key,
          subscriberKey: subscriberKeyOf(subscriber.key),
          status: "pending",
          attemptCount: 0,
          nextAttemptAt: at,
          createdAt: at,
        });
      }
      // An event no one subscribes to is finished as it is dispatched.
      await tx.updateCount(
        PLUGIN_EVENTS_TABLE,
        owed.length > 0
          ? { fannedOutAt: at }
          : { fannedOutAt: at, finishedAt: at },
        { and: [{ column: "id", op: "=", value: id }] }
      );
      return true;
    });
    if (fanned) result.fannedOut += 1;
  }

  // Run the deliveries due, soonest first.
  const at = now();
  const leaseFree = {
    or: [
      { column: "lockedUntil", op: "IS NULL" as const },
      { column: "lockedUntil", op: "<" as const, value: at },
    ],
  };
  const dueWhere: DueWhere = [
    // Held deliveries too: one whose subscriber is registered again runs.
    { column: "status", op: "IN" as const, value: ["pending", "held"] },
    { column: "nextAttemptAt", op: "<=" as const, value: at },
    leaseFree,
  ];
  const due = await adapter.select<DeliveryRow>(PLUGIN_EVENT_DELIVERIES_TABLE, {
    columns: ["id", "eventId", "subscriber", "attemptCount"],
    where: { and: dueWhere },
    orderBy: [{ column: "nextAttemptAt", direction: "asc" }],
    limit: batch,
  });
  for (const delivery of due) {
    if (spent()) return result;
    const outcome = await runDelivery({
      adapter,
      dialect,
      subscribers,
      delivery,
      runnerId,
      at: now(),
      now,
      leaseMs,
      maxAttempts,
      random: options.random,
      dueWhere,
    });
    if (outcome !== "skipped") result[outcome] += 1;
  }
  return result;
}

/**
 * The SHA-256 hex a delivery is keyed by, for its subscriber: compared
 * exactly on every dialect, whatever its collation.
 */
export function subscriberKeyOf(subscriber: string): string {
  return createHash("sha256").update(subscriber, "utf8").digest("hex");
}

/** The conditions a delivery is due under, read and claimed alike. */
type DueWhere = NonNullable<WhereClause["and"]>;

interface RunDelivery {
  adapter: DispatchAdapter;
  dialect: SupportedDialect;
  subscribers: DurableSubscribers;
  delivery: DeliveryRow;
  runnerId: string;
  /** When the delivery was claimed. */
  at: Date;
  /** The pass's clock, read again after a handler fails. */
  now: () => Date;
  leaseMs: number;
  maxAttempts: number;
  random?: () => number;
  dueWhere: DueWhere;
}

/** Claim one delivery, run it, and record what happened. */
async function runDelivery(
  run: RunDelivery
): Promise<"delivered" | "retried" | "failed" | "held" | "skipped"> {
  const { adapter, delivery, runnerId, at } = run;
  const byId = { column: "id", op: "=" as const, value: delivery.id };
  // Taken only while still due and free: another dispatcher may hold it, or
  // have run it, since it was read.
  const claimed = await adapter.transaction(tx =>
    tx.updateCount(
      PLUGIN_EVENT_DELIVERIES_TABLE,
      {
        lockedBy: runnerId,
        lockedUntil: ceilToSecond(at.getTime() + run.leaseMs),
      },
      { and: [byId, ...run.dueWhere] }
    )
  );
  if (claimed === 0) return "skipped";
  const mine = [
    byId,
    { column: "lockedBy", op: "=" as const, value: runnerId },
  ];
  const released = { lockedBy: null, lockedUntil: null };

  const handler = run.subscribers.handlerOf(delivery.subscriber);
  if (!handler) {
    // Held for its own subscriber, never another's, its next look put off so
    // a long-gone subscriber is not read on every pass.
    await adapter.transaction(tx =>
      tx.updateCount(
        PLUGIN_EVENT_DELIVERIES_TABLE,
        {
          ...released,
          // Held, which says why it waits: its last failure, if any, is kept
          // as the record of what went wrong.
          status: "held",
          nextAttemptAt: ceilToSecond(at.getTime() + HOLD_MS),
        },
        { and: mine }
      )
    );
    return "held";
  }

  const event = await adapter.transaction(tx =>
    lockEvent(tx, run.dialect, delivery.eventId)
  );
  if (!event) return "skipped";
  const attempt = delivery.attemptCount + 1;
  try {
    await handler({
      id: delivery.eventId,
      name: event.name,
      payload: JSON.parse(event.payload) as Record<string, unknown>,
      attempt,
    });
  } catch (error) {
    // The backoff counts from the failure, not from the claim: a handler
    // slower than its delay would otherwise be due again at once.
    const next = nextAttempt({
      attemptCount: attempt,
      maxAttempts: run.maxAttempts,
      now: run.now(),
      random: run.random,
    });
    const recorded = {
      ...released,
      attemptCount: attempt,
      lastError: failureOf(error),
    };
    await adapter.transaction(tx =>
      tx.updateCount(
        PLUGIN_EVENT_DELIVERIES_TABLE,
        next.outcome === "retry"
          ? {
              ...recorded,
              // A held delivery whose subscriber came back is pending again.
              status: "pending",
              nextAttemptAt: ceilToSecond(next.at.getTime()),
            }
          : { ...recorded, status: "failed" },
        { and: mine }
      )
    );
    return next.outcome === "retry" ? "retried" : "failed";
  }

  // Delivered: and when it was the event's last open delivery, the event is
  // finished.
  await adapter.transaction(tx =>
    settleDelivery(tx, run.dialect, delivery.eventId, at, () =>
      tx.updateCount(
        PLUGIN_EVENT_DELIVERIES_TABLE,
        {
          ...released,
          status: "delivered",
          attemptCount: attempt,
          finishedAt: at,
        },
        // Only while this dispatcher holds the lease: if it ran out and
        // another took it, that one records the outcome.
        { and: mine }
      )
    )
  );
  return "delivered";
}

/** The statuses a delivery is still owed in: its event is not finished. */
const OPEN_STATUSES = ["pending", "held", "failed"];

/**
 * Close one delivery of `eventId` with `close`, and when it was the event's
 * last open delivery, finish the event. Under the event's lock, taken first,
 * so two deliveries of one event closing at once still see each other, and in
 * the same order (event, then delivery) as every other writer here. Whether
 * `close` changed a row.
 */
export async function settleDelivery(
  tx: TransactionContext,
  dialect: SupportedDialect,
  eventId: string,
  at: Date,
  close: () => Promise<number>
): Promise<boolean> {
  await lockEvent(tx, dialect, eventId);
  if ((await close()) === 0) return false;
  const open = await tx.select<{ id: string }>(PLUGIN_EVENT_DELIVERIES_TABLE, {
    columns: ["id"],
    where: {
      and: [
        { column: "eventId", op: "=", value: eventId },
        { column: "status", op: "IN", value: OPEN_STATUSES },
      ],
    },
    limit: 1,
  });
  if (open.length === 0) {
    await tx.updateCount(
      PLUGIN_EVENTS_TABLE,
      { finishedAt: at },
      {
        and: [
          { column: "id", op: "=", value: eventId },
          { column: "finishedAt", op: "IS NULL" },
        ],
      }
    );
  }
  return true;
}
