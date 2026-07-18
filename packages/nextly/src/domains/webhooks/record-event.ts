/**
 * Webhook domain — transactional-outbox capture.
 *
 * `recordEvent` is the single choke-point every write path calls to make a
 * content change observable: it inserts the durable `nextly_events` row and one
 * `pending` delivery row per matching enabled endpoint, all through the caller's
 * transaction context so the delivery obligation commits atomically with the
 * change (true at-least-once). No network I/O — the delivery engine drains the
 * rows later.
 *
 * @module domains/webhooks/record-event
 */

import { randomUUID } from "node:crypto";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { matchesFilter } from "./filter";
import type { WebhookEndpoint, WebhookEvent } from "./types";

/** Delivery rows inserted per statement; keeps bind-parameter count safe. */
const DELIVERY_INSERT_CHUNK = 100;

/**
 * The enabled endpoints that should receive `envelope`: subscribed to its type
 * and accepted by their filter. Pure, so fan-out selection is unit-testable
 * without a database.
 */
export function selectDeliveryTargets(
  endpoints: readonly WebhookEndpoint[],
  envelope: WebhookEvent
): WebhookEndpoint[] {
  return endpoints.filter(
    e =>
      e.enabled &&
      e.eventTypes.includes(envelope.type) &&
      matchesFilter(e.filter, envelope)
  );
}

/**
 * Row shape written to `nextly_events` (snake_case column names). `created_at`
 * is set explicitly: the transactional insert path is a raw INSERT that
 * bypasses Drizzle's runtime `$defaultFn`, so a NOT NULL timestamp must be
 * provided rather than left to the column default.
 */
function eventRow(envelope: WebhookEvent, now: Date): Record<string, unknown> {
  return {
    id: envelope.id,
    type: envelope.type,
    resource_kind: envelope.resource.kind,
    // `collection` only exists on the entry resource variant.
    resource_collection:
      "collection" in envelope.resource ? envelope.resource.collection : null,
    resource_id: envelope.resource.id ?? null,
    // Serialize the payload here rather than passing the object through: the
    // transactional insert is a raw INSERT, and only some dialect drivers
    // stringify an object bound to a JSON column (SQLite does; mysql2 would
    // mis-format it). A JSON string is accepted by jsonb/json/text alike and
    // round-trips through the column's json codec on read.
    payload: JSON.stringify(envelope),
    actor_type: envelope.actor?.type ?? null,
    actor_id: envelope.actor?.id ?? null,
    created_at: now,
  };
}

/**
 * Row shape written to `nextly_webhook_deliveries` for one target. Timestamps
 * are set explicitly for the same raw-insert reason as {@link eventRow}.
 */
function deliveryRow(
  endpoint: WebhookEndpoint,
  eventId: string,
  now: Date
): Record<string, unknown> {
  return {
    id: randomUUID(),
    webhook_id: endpoint.id,
    event_id: eventId,
    // Fresh deliveries are due immediately; the drain claims them by
    // (status, next_attempt_at).
    status: "pending",
    attempt_count: 0,
    next_attempt_at: now,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Persist an event and fan out its deliveries inside the caller's transaction.
 * Insert the event row first (the delivery FKs reference it), then one delivery
 * row per matching enabled endpoint. Returns how many deliveries were enqueued.
 */
export async function recordEvent(
  tx: TransactionContext,
  params: { envelope: WebhookEvent; endpoints: readonly WebhookEndpoint[] }
): Promise<{ deliveries: number }> {
  const { envelope, endpoints } = params;
  const now = new Date();

  await tx.insert("nextly_events", eventRow(envelope, now));

  const candidates = selectDeliveryTargets(endpoints, envelope);
  if (candidates.length === 0) return { deliveries: 0 };

  // The endpoint set is a (possibly stale) registry snapshot. Confirm each
  // target still exists before inserting: a webhook deleted between the
  // snapshot and this write would otherwise fail the delivery's foreign key and
  // roll back the surrounding content transaction. A missing target is skipped
  // (a deleted endpoint should get no delivery), so webhook admin changes can
  // never make an unrelated content write fail.
  const existing = await tx.select<{ id: string }>("nextly_webhooks", {
    where: {
      and: [{ column: "id", op: "IN", value: candidates.map(c => c.id) }],
    },
  });
  const existingIds = new Set(existing.map(row => row.id));
  const targets = candidates.filter(c => existingIds.has(c.id));
  if (targets.length === 0) return { deliveries: 0 };

  // Chunk the fan-out: a delivery row binds 8 parameters, and SQLite caps a
  // statement at 999 bind parameters, so a site with many matching endpoints
  // would otherwise overflow one multi-row INSERT and roll back the content
  // write. 100 rows/statement stays well under every dialect's limit.
  const rows = targets.map(e => deliveryRow(e, envelope.id, now));
  for (let i = 0; i < rows.length; i += DELIVERY_INSERT_CHUNK) {
    await tx.insertMany(
      "nextly_webhook_deliveries",
      rows.slice(i, i + DELIVERY_INSERT_CHUNK)
    );
  }

  return { deliveries: targets.length };
}
