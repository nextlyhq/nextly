/**
 * Webhook + event system tables — SQLite.
 *
 * See `./postgres.ts` for the full documentation of the three tables. SQLite
 * differences: `text` for all string and JSON columns (JSON is stored as text),
 * `integer { mode: "timestamp" }` for datetimes, and `integer { mode: "boolean" }`
 * for booleans.
 *
 * @module schemas/webhooks/sqlite
 */

import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "../users/sqlite";

export const nextlyEvents = sqliteTable(
  "nextly_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    resourceKind: text("resource_kind").notNull(),
    resourceCollection: text("resource_collection"),
    resourceId: text("resource_id"),
    // JSON stored as TEXT on SQLite; `mode: "json"` gives Drizzle the same
    // object-in/object-out interface as the PG jsonb / MySQL json columns, so
    // delivery code never special-cases SQLite. Same TEXT DDL either way.
    payload: text("payload", { mode: "json" }).notNull(),
    actorType: text("actor_type"),
    actorId: text("actor_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    // Set by the drain's fan-out pass once delivery rows exist for this event;
    // NULL means the event still needs fan-out.
    fannedOutAt: integer("fanned_out_at", { mode: "timestamp" }),
    // Which retention window governs this row; see the PostgreSQL definition.
    retentionClass: text("retention_class").notNull().default("webhook"),
  },
  t => [
    index("nextly_events_type_created_at_idx").on(t.type, t.createdAt),
    // The fan-out pass scans for events still needing fan-out, oldest first.
    index("nextly_events_fanned_out_at_idx").on(t.fannedOutAt, t.createdAt),
    // Retention prunes one class at a time, oldest first.
    index("nextly_events_retention_idx").on(t.retentionClass, t.createdAt),
  ]
);

export const nextlyWebhooks = sqliteTable(
  "nextly_webhooks",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    // JSON columns use `mode: "json"` for parity with the PG/MySQL
    // jsonb/json columns (same TEXT DDL on SQLite).
    eventTypes: text("event_types", { mode: "json" }).notNull(),
    filter: text("filter", { mode: "json" }),
    headers: text("headers", { mode: "json" }),
    secretHash: text("secret_hash", { mode: "json" }).notNull(),
    secretPrefix: text("secret_prefix").notNull(),
    fieldAllowlist: text("field_allowlist", { mode: "json" }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [index("nextly_webhooks_enabled_idx").on(t.enabled)]
);

export const nextlyWebhookDeliveries = sqliteTable(
  "nextly_webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => nextlyWebhooks.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => nextlyEvents.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),
    lockedBy: text("locked_by"),
    lockedUntil: integer("locked_until", { mode: "timestamp" }),
    lastStatusCode: integer("last_status_code"),
    lastLatencyMs: integer("last_latency_ms"),
    lastError: text("last_error"),
    lastResponseSnippet: text("last_response_snippet"),
    // JSON array of per-attempt records; `mode: "json"` matches PG/MySQL.
    attempts: text("attempts", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
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
    // Index event_id for the event -> deliveries cascade delete and
    // event-scoped admin queries.
    index("nextly_webhook_deliveries_event_idx").on(t.eventId),
    // Retention scans terminal rows oldest-first; see the PostgreSQL definition.
    index("nextly_webhook_deliveries_retention_idx").on(t.status, t.createdAt),
  ]
);
