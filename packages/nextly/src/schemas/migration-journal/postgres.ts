// PostgreSQL schema for nextly_migration_journal — F8 PR 5.
//
// Records every pipeline apply (success, failure, abort) so admins
// can audit schema changes. See ../types.ts for type docs.

import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  text,
  index,
} from "drizzle-orm/pg-core";

import type {
  MigrationJournalSource,
  MigrationJournalStatus,
} from "./types.js";

export const nextlyMigrationJournalPg = pgTable(
  "nextly_migration_journal",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Lifecycle.
    source: varchar("source", { length: 20 })
      .$type<MigrationJournalSource>()
      .notNull(),
    status: varchar("status", { length: 20 })
      .$type<MigrationJournalStatus>()
      .default("in_progress")
      .notNull(),

    // Timing. `started_at` set at recordStart; `ended_at` + `duration_ms`
    // set at recordEnd. Rows stuck at `started_at` only indicate a crash
    // between recordStart and recordEnd.
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),

    // Counters: planned set at start; executed + renames set at end.
    statementsPlanned: integer("statements_planned").notNull().default(0),
    statementsExecuted: integer("statements_executed"),
    renamesApplied: integer("renames_applied"),

    // Failure details: only populated when status === 'failed'.
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
  },
  table => [
    // Filter rows by lifecycle state (e.g. find stuck `in_progress` rows).
    index("nextly_migration_journal_status_idx").on(table.status),
    // Order most-recent first in admin views (F10).
    index("nextly_migration_journal_started_at_idx").on(table.startedAt),
    // Filter by HMR vs admin origin.
    index("nextly_migration_journal_source_idx").on(table.source),
  ]
);

export type NextlyMigrationJournalPg =
  typeof nextlyMigrationJournalPg.$inferSelect;
export type NextlyMigrationJournalInsertPg =
  typeof nextlyMigrationJournalPg.$inferInsert;
