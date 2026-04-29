// MySQL schema for nextly_migration_journal — F8 PR 5.
// See ../types.ts for type docs and ./postgres.ts for the canonical
// column list (mirrored verbatim with MySQL types).

import {
  mysqlTable,
  varchar,
  int,
  datetime,
  text,
  index,
} from "drizzle-orm/mysql-core";

import type {
  MigrationJournalSource,
  MigrationJournalStatus,
} from "./types.js";

export const nextlyMigrationJournalMysql = mysqlTable(
  "nextly_migration_journal",
  {
    // MySQL has no native UUID type; varchar(36) is the standard
    // pattern (matches the `nextly_migrations` legacy ledger).
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    source: varchar("source", { length: 20 })
      .$type<MigrationJournalSource>()
      .notNull(),
    status: varchar("status", { length: 20 })
      .$type<MigrationJournalStatus>()
      .default("in_progress")
      .notNull(),

    // datetime(3) gives ms precision so duration_ms math stays exact.
    // $defaultFn matches PG + SQLite — keeps cross-dialect parity even
    // for callers that omit startedAt at insert time.
    startedAt: datetime("started_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
    endedAt: datetime("ended_at", { fsp: 3 }),
    durationMs: int("duration_ms"),

    statementsPlanned: int("statements_planned").notNull().default(0),
    statementsExecuted: int("statements_executed"),
    renamesApplied: int("renames_applied"),

    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
  },
  table => [
    index("nextly_migration_journal_status_idx").on(table.status),
    index("nextly_migration_journal_started_at_idx").on(table.startedAt),
    index("nextly_migration_journal_source_idx").on(table.source),
  ]
);

export type NextlyMigrationJournalMysql =
  typeof nextlyMigrationJournalMysql.$inferSelect;
export type NextlyMigrationJournalInsertMysql =
  typeof nextlyMigrationJournalMysql.$inferInsert;
