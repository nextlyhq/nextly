/**
 * `nextly_schema_events` — MySQL (spec §4.3).
 *
 * See ./postgres.ts for the canonical column list (mirrored verbatim with
 * MySQL types). MySQL has no partial indexes, so the "one applied row per
 * file" uniqueness is enforced in application code (SchemaEventsRepository),
 * not by a DB index.
 *
 * @module schemas/schema-events/mysql
 * @since v0.0.3-alpha (Plan B)
 */

import {
  mysqlTable,
  varchar,
  int,
  datetime,
  text,
  json,
  index,
} from "drizzle-orm/mysql-core";

import type {
  SchemaEventScopeKind,
  SchemaEventSource,
  SchemaEventStatus,
  SchemaEventType,
} from "./types";

export const nextlySchemaEventsMysql = mysqlTable(
  "nextly_schema_events",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    eventType: varchar("event_type", { length: 32 })
      .$type<SchemaEventType>()
      .notNull(),
    status: varchar("status", { length: 32 })
      .$type<SchemaEventStatus>()
      .notNull(),
    source: varchar("source", { length: 32 })
      .$type<SchemaEventSource>()
      .notNull(),

    filename: varchar("filename", { length: 255 }),
    sha256: varchar("sha256", { length: 64 }),

    scopeKind: varchar("scope_kind", { length: 32 }).$type<SchemaEventScopeKind>(),
    scopeSlug: varchar("scope_slug", { length: 255 }),

    startedAt: datetime("started_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
    endedAt: datetime("ended_at", { fsp: 3 }),
    durationMs: int("duration_ms"),
    appliedBy: varchar("applied_by", { length: 255 }),

    statementsPlanned: int("statements_planned"),
    statementsExecuted: int("statements_executed"),
    renamesApplied: int("renames_applied"),

    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    errorJson: json("error_json"),

    supersededEventIds: json("superseded_event_ids"),
    supersededAt: datetime("superseded_at", { fsp: 3 }),
    supersededBy: varchar("superseded_by", { length: 36 }),
  },
  table => [
    index("nextly_schema_events_started_at_idx").on(table.startedAt),
    index("nextly_schema_events_scope_idx").on(table.scopeKind, table.scopeSlug),
  ]
);

export type NextlySchemaEventMysql = typeof nextlySchemaEventsMysql.$inferSelect;
export type NextlySchemaEventInsertMysql =
  typeof nextlySchemaEventsMysql.$inferInsert;
