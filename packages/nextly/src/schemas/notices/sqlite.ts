/**
 * `nextly_notices` on SQLite. See `postgres.ts` for what each column is for.
 *
 * Instants are stored as whole seconds (timestamp mode), as every other core
 * table here stores them; the time-ordered id keeps "newest first" exact when
 * two notices share a second.
 *
 * @module schemas/notices/sqlite
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { NOTICES_INDEXES, sqliteIndexes } from "../_internal/core-indexes";
import { users } from "../users/sqlite";

import { NOTICES_TABLE } from "./table-name";

export const nextlyNoticesSqlite = sqliteTable(
  NOTICES_TABLE,
  {
    id: text("id").primaryKey().notNull(),
    // The person it is for: deleted with them by the database, so a notice
    // written while their account is being deleted cannot outlive it.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    occurrence: text("occurrence").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    data: text("data", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    readAt: integer("read_at", { mode: "timestamp" }),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => sqliteIndexes(NOTICES_INDEXES, table)
);

export type NextlyNoticeSqlite = typeof nextlyNoticesSqlite.$inferSelect;
