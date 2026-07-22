/**
 * Webhook domain — fan-out (events to delivery rows).
 *
 * The drain's first phase. `recordEvent` writes only the durable event; this
 * turns each un-fanned event into per-endpoint `nextly_webhook_deliveries`
 * rows. Splitting fan-out out of the content transaction is the transactional
 * outbox pattern: content writes never touch the webhook registry, so a webhook
 * being created, disabled, or deleted can never fail an unrelated content write.
 *
 * Fan-out is idempotent under concurrent drains: each event is fanned out in
 * its own transaction that reads the deliveries already present and inserts only
 * the missing ones, and the unique `(webhook_id, event_id)` index is the hard
 * backstop. If two drains race the same event, the loser's transaction rolls
 * back and the event is simply retried on the next pass. An event with no
 * matching endpoint is still marked fanned out (it needs no delivery).
 *
 * @module domains/webhooks/fan-out
 */

import type { SelectOptions } from "@nextlyhq/adapter-drizzle/types";

import { matchesFilter, matchesSubscribedTypes } from "./filter";
import type { WebhookEndpoint, WebhookEvent } from "./types";

/** Default number of un-fanned events a single `fanOutDueEvents` call claims. */
const DEFAULT_FANOUT_BATCH = 100;
/**
 * Rows per delivery INSERT. A delivery row binds ~8 parameters and SQLite caps
 * a statement at 999 bind parameters, so chunk well under every dialect's limit.
 */
const DELIVERY_INSERT_CHUNK = 100;

/**
 * The endpoints that should receive an event: enabled, subscribed to the
 * event's type, created no later than the event, and passing the endpoint's
 * filter. Pure.
 *
 * The `createdAt <= event time` guard gives standard webhook semantics — an
 * endpoint receives only events that occurred after it was created — and makes
 * fan-out deterministic regardless of drain lag: a webhook created after an
 * event but before the drain runs must not receive that backlog event.
 */
export function selectDeliveryTargets(
  endpoints: readonly WebhookEndpoint[],
  envelope: WebhookEvent
): WebhookEndpoint[] {
  const eventTime = Date.parse(envelope.timestamp);
  return endpoints.filter(
    e =>
      e.enabled &&
      matchesSubscribedTypes(e.eventTypes, envelope.type) &&
      // Fail closed on an unparseable timestamp: never deliver an event we
      // can't place relative to the subscription cutoff. (The fan-out path
      // rejects such events upstream as poison; this guards direct callers.)
      Number.isFinite(eventTime) &&
      e.createdAt.getTime() <= eventTime &&
      matchesFilter(e.filter, envelope)
  );
}

/** The transaction surface `fanOutDueEvents` needs (subset of the adapter tx). */
export interface FanOutTx {
  select<T = unknown>(table: string, options?: SelectOptions): Promise<T[]>;
  insertMany<T = unknown>(
    table: string,
    data: Record<string, unknown>[]
  ): Promise<T[]>;
  update<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    where: { and: Array<{ column: string; op: string; value: unknown }> }
  ): Promise<T[]>;
}

/** The database surface `fanOutDueEvents` needs (satisfied by the adapter). */
export interface FanOutDatabase {
  select<T = unknown>(table: string, options?: SelectOptions): Promise<T[]>;
  transaction<T>(fn: (tx: FanOutTx) => Promise<T>): Promise<T>;
}

/** Minimal logger surface; fan-out only warns on a deferred event. */
export interface FanOutLogger {
  warn(message: string, context?: unknown): void;
}

export interface FanOutDeps {
  db: FanOutDatabase;
  /** Loads the enabled endpoints once per pass (e.g. a `WebhookEndpointRegistry`). */
  loadEndpoints: () => Promise<readonly WebhookEndpoint[]>;
  /** Max events to claim this pass. Defaults to 100. */
  batchSize?: number;
  /** Clock; injectable for deterministic tests. */
  now?: () => Date;
  /** Delivery id generator; injectable for deterministic tests. */
  newId?: () => string;
  logger?: FanOutLogger;
}

export interface FanOutResult {
  /** Events marked fanned out this pass. */
  eventsProcessed: number;
  /** Delivery rows inserted this pass. */
  deliveriesCreated: number;
}

/** Raw `nextly_events` row shape this module reads (camelCased by Drizzle). */
interface EventRow {
  id: string;
  payload: unknown;
}

/**
 * Parse the stored envelope, tolerating both a JSON string and a parsed object,
 * and structurally validate every field matching relies on. An object missing
 * `type`/`resource`, or whose `changedFields` is not an array, would otherwise
 * throw inside `matchesFilter` (which does `new Set(envelope.changedFields)`);
 * returning null routes it through the same skip-and-log path so a corrupt row
 * can never throw and stall the batch.
 */
function parseEnvelope(payload: unknown): WebhookEvent | null {
  let value: unknown = payload;
  if (typeof payload === "string") {
    try {
      value = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (value == null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string") return null;
  if (typeof record.resource !== "object" || record.resource === null) {
    return null;
  }
  if (!Array.isArray(record.changedFields)) return null;
  // timestamp drives the pre-subscription cutoff in selectDeliveryTargets, so a
  // missing/unparseable one is poison rather than something to silently bypass.
  if (
    typeof record.timestamp !== "string" ||
    !Number.isFinite(Date.parse(record.timestamp))
  ) {
    return null;
  }
  return value as WebhookEvent;
}

/** Build a fresh, due-immediately delivery row (snake_case columns). */
function deliveryRow(
  id: string,
  webhookId: string,
  eventId: string,
  now: Date
): Record<string, unknown> {
  return {
    id,
    webhook_id: webhookId,
    event_id: eventId,
    status: "pending",
    attempt_count: 0,
    // Due immediately; the delivery phase claims rows whose next_attempt_at <= now.
    next_attempt_at: now,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Claim a batch of un-fanned events and turn each into delivery rows. Returns
 * how many events were processed and delivery rows created. Bounded work per
 * call (one batch); the caller loops until a pass processes nothing.
 */
export async function fanOutDueEvents(deps: FanOutDeps): Promise<FanOutResult> {
  const batchSize = deps.batchSize ?? DEFAULT_FANOUT_BATCH;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());

  // WHERE/orderBy columns are the Drizzle JS property names (camelCase); the
  // adapter resolves them via getColumns, not the SQL column names.
  const events = await deps.db.select<EventRow>("nextly_events", {
    where: { and: [{ column: "fannedOutAt", op: "IS NULL", value: null }] },
    orderBy: [{ column: "createdAt", direction: "asc" }],
    limit: batchSize,
  });
  if (events.length === 0) {
    return { eventsProcessed: 0, deliveriesCreated: 0 };
  }

  const endpoints = await deps.loadEndpoints();

  let eventsProcessed = 0;
  let deliveriesCreated = 0;

  for (const event of events) {
    const envelope = parseEnvelope(event.payload);
    if (!envelope) {
      // An unparseable/invalid payload is a data-integrity anomaly (recordEvent
      // always writes a valid envelope). It can never be delivered, so mark it
      // fanned out to guarantee forward progress: leaving it un-fanned would let
      // one corrupt row at the head of the queue stall every event behind it
      // forever. Log loudly so it is not silently dropped; a durable
      // dead-letter table is a follow-up.
      deps.logger?.warn(
        `webhook fan-out marking event ${event.id} fanned out (undeliverable: unparseable/invalid payload)`
      );
      try {
        await deps.db.transaction(async tx => {
          await tx.update(
            "nextly_events",
            { fanned_out_at: now() },
            { and: [{ column: "id", op: "=", value: event.id }] }
          );
        });
        eventsProcessed += 1;
      } catch (err) {
        // Could not mark it; it will be retried next pass. Do not abort.
        deps.logger?.warn(
          `webhook fan-out could not mark poison event ${event.id}`,
          err
        );
      }
      continue;
    }

    try {
      // Inside the try so a matching throw (e.g. a structurally-odd envelope)
      // is caught per-event and never aborts the whole batch.
      const targets = selectDeliveryTargets(endpoints, envelope);
      const created = await deps.db.transaction(async tx => {
        let inserted = 0;
        if (targets.length > 0) {
          // Skip endpoints already delivered-to for this event so a retry (or a
          // racing drain that got here first) does not hit the unique index.
          const existing = await tx.select<{ webhookId: string }>(
            "nextly_webhook_deliveries",
            {
              where: { and: [{ column: "eventId", op: "=", value: event.id }] },
            }
          );
          const existingIds = new Set(existing.map(r => r.webhookId));
          const fresh = targets.filter(t => !existingIds.has(t.id));
          const rows = fresh.map(t =>
            deliveryRow(newId(), t.id, event.id, now())
          );
          for (let i = 0; i < rows.length; i += DELIVERY_INSERT_CHUNK) {
            await tx.insertMany(
              "nextly_webhook_deliveries",
              rows.slice(i, i + DELIVERY_INSERT_CHUNK)
            );
          }
          inserted = rows.length;
        }
        // Mark fanned out even with zero targets: the event needs no delivery
        // and must not be reconsidered on the next pass.
        await tx.update(
          "nextly_events",
          { fanned_out_at: now() },
          { and: [{ column: "id", op: "=", value: event.id }] }
        );
        return inserted;
      });
      eventsProcessed += 1;
      deliveriesCreated += created;
    } catch (err) {
      // A concurrent drain likely fanned this event out first (unique-index
      // conflict) or a transient DB error occurred; the transaction rolled back,
      // so fanned_out_at stays NULL and the next pass retries. Do not abort the
      // rest of the batch.
      deps.logger?.warn(`webhook fan-out deferred for event ${event.id}`, err);
    }
  }

  return { eventsProcessed, deliveriesCreated };
}
