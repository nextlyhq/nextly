/**
 * Webhook + event system tables — PostgreSQL.
 *
 * Three tables back the durable-outbox webhook system:
 * - `nextly_events` — the durable event ledger (outbox). One row per content
 *   event; the JSON payload is the full delivery envelope. Also the substrate
 *   the audit-log and workflow features reuse.
 * - `nextly_webhooks` — the endpoint registry (URL, subscribed events, filter,
 *   hashed secret). Mirrors the api-keys security model (secret never stored
 *   raw; only a hash + a display prefix).
 * - `nextly_webhook_deliveries` — the per-endpoint delivery ledger: retry
 *   state, lease columns for concurrent drain workers, and an attempt log.
 *
 * Drizzle table objects flow through `getCoreSchema` and are created/reconciled
 * by the introspect-diff pipeline, so no hand-written migration is needed.
 *
 * @module schemas/webhooks/postgres
 */

import {
  pgTable,
  text,
  varchar,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "../users/postgres";

/**
 * Durable event ledger (outbox). Rows are written inside the same transaction
 * as the content change, so an event can never be lost or fired for a
 * rolled-back change. `id` is the envelope id and doubles as the idempotency
 * key; it is the primary key, so uniqueness is enforced on every dialect.
 */
export const nextlyEvents = pgTable(
  "nextly_events",
  {
    id: text("id").primaryKey(),
    // Canonical event type, e.g. "entry.published".
    type: varchar("type", { length: 100 }).notNull(),
    // Resource the event is about.
    resourceKind: varchar("resource_kind", { length: 20 }).notNull(),
    resourceCollection: varchar("resource_collection", { length: 255 }),
    resourceId: text("resource_id"),
    // The full delivery envelope (data/previous/changedFields/actor/...).
    payload: jsonb("payload").notNull(),
    // Denormalized actor for audit-log reuse.
    actorType: varchar("actor_type", { length: 20 }),
    actorId: text("actor_id"),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    // Set by the drain's fan-out pass once delivery rows exist for this event;
    // NULL means the event still needs fan-out. Lets the drain find un-fanned
    // events cheaply without rescanning the delivery table.
    fannedOutAt: timestamp("fanned_out_at", { withTimezone: false }),
    // Which retention window governs this row. A single event can serve both
    // roles at once, so this records the LONGEST retention it needs: rows the
    // audit log depends on outlive rows that only ever drove a webhook.
    retentionClass: varchar("retention_class", { length: 20 })
      .notNull()
      .default("webhook"),
  },
  t => [
    // Drain/reporting scans by type and recency.
    index("nextly_events_type_created_at_idx").on(t.type, t.createdAt),
    // The fan-out pass scans for events still needing fan-out, oldest first.
    index("nextly_events_fanned_out_at_idx").on(t.fannedOutAt, t.createdAt),
    // Retention prunes one class at a time, oldest first.
    index("nextly_events_retention_idx").on(t.retentionClass, t.createdAt),
  ]
);

/**
 * Outbound webhook endpoint registry. Secrets follow the api-keys pattern:
 * only the hash and a short display prefix are stored; the raw secret is shown
 * once at creation. `secretHash` is a JSON array of active-secret hashes so
 * zero-downtime rotation can be added later without a migration.
 */
export const nextlyWebhooks = pgTable(
  "nextly_webhooks",
  {
    id: text("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    url: text("url").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    // JSON array of subscribed event types.
    eventTypes: jsonb("event_types").notNull(),
    // Structured, versioned filter spec (collections, changedFields, ...).
    filter: jsonb("filter"),
    // Static request headers merged into every delivery.
    headers: jsonb("headers"),
    // JSON array of active signing-secret hashes (list-shaped for rotation).
    secretHash: jsonb("secret_hash").notNull(),
    // Short prefix of the current secret for display, never the raw secret.
    secretPrefix: varchar("secret_prefix", { length: 16 }).notNull(),
    // Optional per-endpoint field allowlist (projection; reserved for later).
    fieldAllowlist: jsonb("field_allowlist"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    // Soft-delete marker. Deleting an endpoint stamps this instead of removing
    // the row, so its delivery history survives with its attribution intact
    // (the delivery foreign key still resolves to a real endpoint). NULL means
    // live; a timestamp means retired and hidden from every read.
    deletedAt: timestamp("deleted_at", { withTimezone: false }),
  },
  t => [index("nextly_webhooks_enabled_idx").on(t.enabled)]
);

/**
 * Per-endpoint delivery ledger. One row per (event, matching webhook). Carries
 * the retry state, a lease (`lockedBy`/`lockedUntil`) for concurrent drain
 * workers, and a JSON attempt log for observability.
 */
export const nextlyWebhookDeliveries = pgTable(
  "nextly_webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => nextlyWebhooks.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => nextlyEvents.id, { onDelete: "cascade" }),
    // pending | processing | delivered | retrying | failed
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: false }),
    // Lease for the claim-fallback dialects (SQLite / MySQL < 8).
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: false }),
    lastStatusCode: integer("last_status_code"),
    lastLatencyMs: integer("last_latency_ms"),
    lastError: text("last_error"),
    lastResponseSnippet: text("last_response_snippet"),
    // JSON array of per-attempt records (timestamp, status, latency, error).
    attempts: jsonb("attempts"),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    // The drain query claims due rows by (status, next_attempt_at).
    index("nextly_webhook_deliveries_status_next_idx").on(
      t.status,
      t.nextAttemptAt
    ),
    // One delivery per (webhook, event): fan-out and retry both insert with
    // ON CONFLICT DO NOTHING, so a duplicate capture can never double-send.
    // The leading webhook_id column also serves lookups scoped to an endpoint.
    uniqueIndex("nextly_webhook_deliveries_webhook_event_unique").on(
      t.webhookId,
      t.eventId
    ),
    // Postgres does not auto-index FK columns, so index event_id explicitly for
    // the event -> deliveries cascade delete and event-scoped admin queries.
    index("nextly_webhook_deliveries_event_idx").on(t.eventId),
    // Retention scans terminal rows oldest-first; without this the prune would
    // sequentially scan the fastest-growing table in the system.
    index("nextly_webhook_deliveries_retention_idx").on(t.status, t.updatedAt),
  ]
);
