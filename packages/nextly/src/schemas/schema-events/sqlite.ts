/**
 * `nextly_schema_events` — SQLite (spec §4.3).
 *
 * See ./postgres.ts for the canonical column list (mirrored verbatim with
 * SQLite types). Timestamps are stored as integer epoch-ms (matches the
 * journal + dynamic-collections convention). JSON columns use text(mode:json).
 *
 * @module schemas/schema-events/sqlite
 * @since v0.0.3-alpha (Plan B)
 */

import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type {
  SchemaEventScopeKind,
  SchemaEventSource,
  SchemaEventStatus,
  SchemaEventType,
} from "./types";

export const nextlySchemaEventsSqlite = sqliteTable(
  "nextly_schema_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    eventType: text("event_type").$type<SchemaEventType>().notNull(),
    status: text("status").$type<SchemaEventStatus>().notNull(),
    source: text("source").$type<SchemaEventSource>().notNull(),

    filename: text("filename"),
    sha256: text("sha256"),

    scopeKind: text("scope_kind").$type<SchemaEventScopeKind>(),
    scopeSlug: text("scope_slug"),

    startedAt: integer("started_at", { mode: "timestamp_ms" })
      .$defaultFn(() => new Date())
      .notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    durationMs: integer("duration_ms"),
    appliedBy: text("applied_by"),

    statementsPlanned: integer("statements_planned"),
    statementsExecuted: integer("statements_executed"),
    renamesApplied: integer("renames_applied"),

    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorJson: text("error_json", { mode: "json" }),

    supersededEventIds: text("superseded_event_ids", { mode: "json" }),
    supersededAt: integer("superseded_at", { mode: "timestamp_ms" }),
    supersededBy: text("superseded_by"),
  },
  table => [
    uniqueIndex("nextly_schema_events_filename_applied_idx")
      .on(table.filename)
      .where(
        sql`${table.eventType} = 'file_apply' AND ${table.status} = 'applied'`
      ),
    index("nextly_schema_events_started_at_idx").on(table.startedAt),
    index("nextly_schema_events_scope_idx").on(table.scopeKind, table.scopeSlug),
  ]
);

export type NextlySchemaEventSqlite =
  typeof nextlySchemaEventsSqlite.$inferSelect;
export type NextlySchemaEventInsertSqlite =
  typeof nextlySchemaEventsSqlite.$inferInsert;
