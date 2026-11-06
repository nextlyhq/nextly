/**
 * `nextly_plugin_events` and `nextly_plugin_event_deliveries`, SQLite. The
 * same columns as PostgreSQL's (see `postgres.ts`), with times in
 * milliseconds, as the backoff and leases read them. The boot DDL in
 * `database/sqlite-core-tables.ts` matches it.
 *
 * @module schemas/plugin-events/sqlite
 */
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import {
  PLUGIN_EVENT_DELIVERIES_TABLE,
  PLUGIN_EVENTS_TABLE,
} from "./table-name";

export const nextlyPluginEvents = sqliteTable(
  PLUGIN_EVENTS_TABLE,
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    payload: text("payload").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    fannedOutAt: integer("fanned_out_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  table => [
    index("nextly_plugin_events_fan_out_idx").on(
      table.fannedOutAt,
      table.createdAt
    ),
    index("nextly_plugin_events_finished_idx").on(table.finishedAt),
  ]
);

export const nextlyPluginEventDeliveries = sqliteTable(
  PLUGIN_EVENT_DELIVERIES_TABLE,
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    subscriber: text("subscriber").notNull(),
    subscriberKey: text("subscriber_key").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", {
      mode: "timestamp_ms",
    }).notNull(),
    lockedBy: text("locked_by"),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  table => [
    uniqueIndex("nextly_plugin_event_deliveries_event_subscriber_unique").on(
      table.eventId,
      table.subscriberKey
    ),
    index("nextly_plugin_event_deliveries_due_idx").on(
      table.status,
      table.nextAttemptAt
    ),
  ]
);
