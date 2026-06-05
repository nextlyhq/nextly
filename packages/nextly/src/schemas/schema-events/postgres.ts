/**
 * `nextly_schema_events` — PostgreSQL (spec §4.3).
 *
 * Consolidated bookkeeping table replacing `nextly_migrations` +
 * `nextly_migration_journal`. `id` uses the same client-side UUID pattern as
 * `nextly_migration_journal` (text + `$defaultFn`) for cross-dialect parity.
 *
 * @module schemas/schema-events/postgres
 * @since v0.0.3-alpha (Plan B)
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type {
  SchemaEventScopeKind,
  SchemaEventSource,
  SchemaEventStatus,
  SchemaEventType,
} from "./types";

export const nextlySchemaEventsPg = pgTable(
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

    startedAt: timestamp("started_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    appliedBy: text("applied_by"),
    note: text("note"),

    statementsPlanned: integer("statements_planned"),
    statementsExecuted: integer("statements_executed"),
    renamesApplied: integer("renames_applied"),

    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorJson: jsonb("error_json"),

    supersededEventIds: jsonb("superseded_event_ids"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersededBy: text("superseded_by"),
  },
  table => [
    // "One applied row per file" — partial unique index (PG + SQLite support
    // this; MySQL enforces in app code, see SchemaEventsRepository).
    uniqueIndex("nextly_schema_events_filename_applied_idx")
      .on(table.filename)
      .where(
        sql`${table.eventType} = 'file_apply' AND ${table.status} = 'applied'`
      ),
    index("nextly_schema_events_started_at_idx").on(table.startedAt),
    index("nextly_schema_events_scope_idx").on(
      table.scopeKind,
      table.scopeSlug
    ),
  ]
);

export type NextlySchemaEventPg = typeof nextlySchemaEventsPg.$inferSelect;
export type NextlySchemaEventInsertPg =
  typeof nextlySchemaEventsPg.$inferInsert;
