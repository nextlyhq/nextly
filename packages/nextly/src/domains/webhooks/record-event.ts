/**
 * Webhook domain — transactional-outbox capture.
 *
 * `recordEvent` is the single choke-point every write path calls to make a
 * content change observable. It inserts ONLY the durable `nextly_events` row,
 * inside the caller's transaction, so the event commits atomically with the
 * change and can never be lost or fired for a rolled-back change. Fan-out
 * (matching the event to endpoints and creating delivery rows) happens later in
 * the drain, so the content write is never coupled to the webhook registry:
 * this is the canonical transactional-outbox split (business tx enqueues; a
 * relay routes). No network I/O here.
 *
 * @module domains/webhooks/record-event
 */

import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";

import { webhookTables } from "../../schemas/webhooks";

import type { WebhookEvent } from "./types";

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
    // The denormalized scope column: an entry carries its collection slug; a
    // single (or other slugged resource) carries its own slug so the delivery
    // log identifies which resource changed. This is informational only — the
    // endpoint `collections` filter matches on the PAYLOAD's `resource.collection`
    // (undefined for a single), so a single slug here never widens a
    // collection-scoped subscription.
    resource_collection:
      "collection" in envelope.resource
        ? envelope.resource.collection
        : "slug" in envelope.resource
          ? (envelope.resource.slug ?? null)
          : null,
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
 * Durably record an event inside the caller's transaction. The drain fans it
 * out to matching endpoints afterwards, so nothing here touches the webhook
 * registry or the delivery table.
 */
export async function recordEvent(
  tx: TransactionContext,
  params: { envelope: WebhookEvent }
): Promise<void> {
  // Project to `id` only: the result is ignored, and the default insert would
  // otherwise RETURN * (or select the row back), forcing the large JSON payload
  // we just wrote to be read and decoded again inside the content transaction.
  await tx.insert("nextly_events", eventRow(params.envelope, new Date()), {
    returning: ["id"],
  });
}

/**
 * The Drizzle table row for one event (camelCase properties). Unlike
 * {@link eventRow}, the `payload` is passed as an OBJECT: the Drizzle
 * json/jsonb codec serializes it per dialect, and `createdAt`/`retentionClass`
 * are left to the column defaults the Drizzle insert applies.
 */
function eventRowForDrizzle(envelope: WebhookEvent): Record<string, unknown> {
  return {
    id: envelope.id,
    type: envelope.type,
    resourceKind: envelope.resource.kind,
    resourceCollection:
      "collection" in envelope.resource
        ? envelope.resource.collection
        : "slug" in envelope.resource
          ? (envelope.resource.slug ?? null)
          : null,
    resourceId: envelope.resource.id ?? null,
    payload: envelope,
    actorType: envelope.actor?.type ?? null,
    actorId: envelope.actor?.id ?? null,
  };
}

/**
 * Minimal Drizzle-transaction surface: append one row. `BaseService.
 * withTransaction` yields a dialect-specific Drizzle handle whose fluent insert
 * matches this, so a service recording through it stays free of the adapter's
 * positional context.
 */
export interface DrizzleEventTx {
  insert(table: unknown): { values(data: unknown): Promise<unknown> };
}

/**
 * Drizzle-transaction variant of {@link recordEvent}, for services that run
 * their writes through `BaseService.withTransaction` (a Drizzle transaction)
 * rather than the adapter's positional `TransactionContext` — the auth/user
 * service and plugin write paths. It appends the same `nextly_events` row
 * through the standardized Drizzle query API, so the event still commits
 * atomically with the write and the drain fans it out afterwards.
 */
export async function recordEventInTx(
  tx: DrizzleEventTx,
  dialect: SupportedDialect,
  params: { envelope: WebhookEvent }
): Promise<void> {
  const { nextlyEvents } = webhookTables(dialect);
  await tx.insert(nextlyEvents).values(eventRowForDrizzle(params.envelope));
}
