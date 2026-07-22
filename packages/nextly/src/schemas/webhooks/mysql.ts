/**
 * Webhook + event system tables — MySQL.
 *
 * See `./postgres.ts` for the full documentation of the three tables. MySQL
 * differences: `varchar(191)` for id/FK columns (utf8mb4 index-length limit),
 * `datetime` for timestamps with a DDL-side `CURRENT_TIMESTAMP` default, and
 * `json` for JSON columns.
 *
 * @module schemas/webhooks/mysql
 */

import { sql } from "drizzle-orm";
import {
  mysqlTable,
  varchar,
  text,
  boolean,
  int,
  json,
  datetime,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

import { users } from "../users/mysql";

export const nextlyEvents = mysqlTable(
  "nextly_events",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    type: varchar("type", { length: 100 }).notNull(),
    resourceKind: varchar("resource_kind", { length: 20 }).notNull(),
    resourceCollection: varchar("resource_collection", { length: 255 }),
    resourceId: varchar("resource_id", { length: 191 }),
    payload: json("payload").notNull(),
    actorType: varchar("actor_type", { length: 20 }),
    actorId: varchar("actor_id", { length: 191 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    // Set by the drain's fan-out pass once delivery rows exist for this event;
    // NULL means the event still needs fan-out.
    fannedOutAt: datetime("fanned_out_at"),
    // Which retention window governs this row; see the PostgreSQL definition.
    retentionClass: varchar("retention_class", { length: 20 })
      .notNull()
      .default("webhook"),
  },
  t => [
    index("nextly_events_type_created_at_idx").on(t.type, t.createdAt),
    // The fan-out pass scans for events still needing fan-out, oldest first.
    index("nextly_events_fanned_out_at_idx").on(t.fannedOutAt, t.createdAt),
    // Retention prunes one class at a time, oldest first.
    index("nextly_events_retention_idx").on(t.retentionClass, t.createdAt),
  ]
);

export const nextlyWebhooks = mysqlTable(
  "nextly_webhooks",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    url: text("url").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    eventTypes: json("event_types").notNull(),
    filter: json("filter"),
    headers: json("headers"),
    secretHash: json("secret_hash").notNull(),
    secretPrefix: varchar("secret_prefix", { length: 16 }).notNull(),
    fieldAllowlist: json("field_allowlist"),
    createdBy: varchar("created_by", { length: 191 }).references(
      () => users.id,
      { onDelete: "set null" }
    ),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    // Soft-delete marker; see the PostgreSQL definition. Deleting an endpoint
    // stamps this instead of removing the row, so its delivery history and
    // attribution survive. NULL means live.
    deletedAt: datetime("deleted_at"),
  },
  t => [index("nextly_webhooks_enabled_idx").on(t.enabled)]
);

export const nextlyWebhookDeliveries = mysqlTable(
  "nextly_webhook_deliveries",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    webhookId: varchar("webhook_id", { length: 191 })
      .notNull()
      .references(() => nextlyWebhooks.id, { onDelete: "cascade" }),
    eventId: varchar("event_id", { length: 191 })
      .notNull()
      .references(() => nextlyEvents.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    attemptCount: int("attempt_count").notNull().default(0),
    nextAttemptAt: datetime("next_attempt_at"),
    lockedBy: varchar("locked_by", { length: 191 }),
    lockedUntil: datetime("locked_until"),
    lastStatusCode: int("last_status_code"),
    lastLatencyMs: int("last_latency_ms"),
    lastError: text("last_error"),
    lastResponseSnippet: text("last_response_snippet"),
    attempts: json("attempts"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
    // MySQL auto-indexes FK columns, but declare event_id explicitly so the
    // schema is identical across dialects and the diff pipeline round-trips.
    index("nextly_webhook_deliveries_event_idx").on(t.eventId),
    // Retention scans terminal rows oldest-first; see the PostgreSQL definition.
    index("nextly_webhook_deliveries_retention_idx").on(t.status, t.updatedAt),
  ]
);
