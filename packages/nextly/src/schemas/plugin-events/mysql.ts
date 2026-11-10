/**
 * `nextly_plugin_events` and `nextly_plugin_event_deliveries`, MySQL. The
 * same columns as PostgreSQL's (see `postgres.ts`); every column a key or an
 * index reads is bounded, because MySQL cannot index a TEXT column without a
 * prefix length.
 *
 * @module schemas/plugin-events/mysql
 */
import {
  datetime,
  index,
  int,
  mediumtext,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import {
  PLUGIN_EVENT_DELIVERIES_TABLE,
  PLUGIN_EVENTS_TABLE,
} from "./table-name";

export const nextlyPluginEvents = mysqlTable(
  PLUGIN_EVENTS_TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    // Unbounded, as a plugin's name is: nothing is indexed on it.
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    // MEDIUMTEXT: TEXT holds 65,535 bytes, one short of the 64 KiB a payload
    // may be.
    payload: mediumtext("payload").notNull(),
    // DATETIME, not TIMESTAMP, which ends in 2038, and to the millisecond,
    // as the backoff and leases read them.
    createdAt: datetime("created_at", { fsp: 3 }).notNull(),
    fannedOutAt: datetime("fanned_out_at", { fsp: 3 }),
    finishedAt: datetime("finished_at", { fsp: 3 }),
  },
  table => [
    index("nextly_plugin_events_fan_out_idx").on(
      table.fannedOutAt,
      table.createdAt
    ),
    index("nextly_plugin_events_finished_idx").on(table.finishedAt),
  ]
);

export const nextlyPluginEventDeliveries = mysqlTable(
  PLUGIN_EVENT_DELIVERIES_TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    eventId: varchar("event_id", { length: 36 }).notNull(),
    subscriber: text("subscriber").notNull(),
    // Lower-case SHA-256 hex, which compares exactly under any collation,
    // where a subscriber's own name would not: the default matches "A" to "a".
    subscriberKey: varchar("subscriber_key", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    attemptCount: int("attempt_count").notNull().default(0),
    nextAttemptAt: datetime("next_attempt_at", { fsp: 3 }).notNull(),
    lockedBy: varchar("locked_by", { length: 64 }),
    lockedUntil: datetime("locked_until", { fsp: 3 }),
    lastError: text("last_error"),
    createdAt: datetime("created_at", { fsp: 3 }).notNull(),
    finishedAt: datetime("finished_at", { fsp: 3 }),
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
