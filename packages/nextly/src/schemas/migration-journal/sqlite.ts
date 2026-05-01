// SQLite schema for nextly_migration_journal — F8 PR 5.
// See ../types.ts for type docs and ./postgres.ts for the canonical
// column list (mirrored verbatim with SQLite types).

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import type {
  MigrationJournalScopeKind,
  MigrationJournalSource,
  MigrationJournalStatus,
} from "./types.js";

export const nextlyMigrationJournalSqlite = sqliteTable(
  "nextly_migration_journal",
  {
    // SQLite stores UUIDs as text; matches the convention used by
    // nextly_migrations and dynamic_collections.
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    source: text("source").$type<MigrationJournalSource>().notNull(),
    status: text("status")
      .$type<MigrationJournalStatus>()
      .default("in_progress")
      .notNull(),

    // SQLite stores timestamps as integer epoch-ms (matches the
    // dynamic-collections convention). The journal service computes
    // ms-precision durations from these. $defaultFn matches PG + MySQL.
    startedAt: integer("started_at", { mode: "timestamp_ms" })
      .$defaultFn(() => new Date())
      .notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    durationMs: integer("duration_ms"),

    statementsPlanned: integer("statements_planned").notNull().default(0),
    statementsExecuted: integer("statements_executed"),
    renamesApplied: integer("renames_applied"),

    errorCode: text("error_code"),
    errorMessage: text("error_message"),

    // F10 PR 1: scope + summary columns. All nullable for forward-compat
    // with rows written before this migration ran. Pipeline starts
    // populating these in F10 PR 2.
    scopeKind: text("scope_kind").$type<MigrationJournalScopeKind>(),
    scopeSlug: text("scope_slug"),
    summaryAdded: integer("summary_added"),
    summaryRemoved: integer("summary_removed"),
    summaryRenamed: integer("summary_renamed"),
    summaryChanged: integer("summary_changed"),

    // Phase 5 (2026-05-01): batch sentinel for distinguishing dev-time
    // pushes from production migrations. -1 = HMR/dev push (the
    // pipeline sets this when source=="code"); 0+ = production migration
    // batch numbers (incremented by the migration runner — currently
    // unused but reserved for symmetry with Payload's pattern). Default
    // 0 keeps existing audit queries simple: `WHERE batch >= 0` returns
    // production migrations, `WHERE batch < 0` returns dev pushes.
    batch: integer("batch").notNull().default(0),
  },
  table => [
    index("nextly_migration_journal_status_idx").on(table.status),
    index("nextly_migration_journal_started_at_idx").on(table.startedAt),
    index("nextly_migration_journal_source_idx").on(table.source),
  ]
);

export type NextlyMigrationJournalSqlite =
  typeof nextlyMigrationJournalSqlite.$inferSelect;
export type NextlyMigrationJournalInsertSqlite =
  typeof nextlyMigrationJournalSqlite.$inferInsert;
