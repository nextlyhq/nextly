/**
 * `nextly_plugin_events` and `nextly_plugin_event_deliveries`, PostgreSQL.
 *
 * The canonical column lists; `./mysql.ts` and `./sqlite.ts` mirror them with
 * their own types. An event is recorded in the transaction that emitted it;
 * a dispatcher later fans it out into one delivery per subscriber registered
 * then, and runs each until it succeeds. The unique key on a delivery's event
 * and subscriber is what holds two dispatchers to one delivery each, so an
 * upgraded database cannot lack it.
 *
 * @module schemas/plugin-events/postgres
 */
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  PLUGIN_EVENT_DELIVERIES_TABLE,
  PLUGIN_EVENTS_TABLE,
} from "./table-name";

export const nextlyPluginEvents = pgTable(
  PLUGIN_EVENTS_TABLE,
  {
    id: text("id").primaryKey(),
    /** The plugin that emitted it, as declared in its manifest. */
    owner: text("owner").notNull(),
    /** The event's name, in the plugin's own namespace, declared durable. */
    name: text("name").notNull(),
    /** What subscribers receive, as JSON. */
    payload: text("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull(),
    /** When the dispatcher gave it its deliveries; null until then. */
    fannedOutAt: timestamp("fanned_out_at", { withTimezone: false }),
    /**
     * When its last delivery succeeded or was abandoned: what pruning reads,
     * so an event with a delivery still owed is never pruned.
     */
    finishedAt: timestamp("finished_at", { withTimezone: false }),
  },
  table => [
    // The dispatcher reads the events not yet fanned out, oldest first.
    index("nextly_plugin_events_fan_out_idx").on(
      table.fannedOutAt,
      table.createdAt
    ),
    index("nextly_plugin_events_finished_idx").on(table.finishedAt),
  ]
);

export const nextlyPluginEventDeliveries = pgTable(
  PLUGIN_EVENT_DELIVERIES_TABLE,
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    /** The subscriber, `<plugin>:<name>`, as it was registered. */
    subscriber: text("subscriber").notNull(),
    /**
     * SHA-256 hex of the subscriber: what a delivery is keyed by, so every
     * dialect compares it exactly, whatever its collation.
     */
    subscriberKey: text("subscriber_key").notNull(),
    /** `pending`, `delivered`, `failed` (attempts spent) or `abandoned`. */
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: false,
    }).notNull(),
    /** The dispatcher running it, and until when: a lease, not a lock. */
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: false }),
    /** The last failure, bounded and with credentials redacted. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: false }),
  },
  table => [
    uniqueIndex("nextly_plugin_event_deliveries_event_subscriber_unique").on(
      table.eventId,
      table.subscriberKey
    ),
    // The dispatcher reads the deliveries due, soonest first.
    index("nextly_plugin_event_deliveries_due_idx").on(
      table.status,
      table.nextAttemptAt
    ),
  ]
);
