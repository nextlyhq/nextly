/**
 * `nextly_notices` on MySQL. See `postgres.ts` for what each column is for.
 *
 * Every indexed text column is a bounded `varchar`: MySQL cannot index
 * `text`, and the lengths keep each index inside its 3072-byte key limit.
 *
 * @module schemas/notices/mysql
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { mysqlTable, varchar, datetime, json } from "drizzle-orm/mysql-core";

import { NOTICES_INDEXES, mysqlIndexes } from "../_internal/core-indexes";
import { users } from "../users/mysql";

import { NOTICES_TABLE } from "./table-name";

export const nextlyNoticesMysql = mysqlTable(
  NOTICES_TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    // The person it is for: deleted with them by the database, so a notice
    // written while their account is being deleted cannot outlive it.
    // As wide as `users.id`, whose key it holds.
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 64 }).notNull(),
    subjectType: varchar("subject_type", { length: 64 }).notNull(),
    subjectId: varchar("subject_id", { length: 191 }).notNull(),
    occurrence: varchar("occurrence", { length: 191 }).notNull(),
    // A sha256 hex digest: 64 characters.
    dedupeKey: varchar("dedupe_key", { length: 64 }).notNull(),
    data: json("data"),
    createdAt: datetime("created_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
    readAt: datetime("read_at", { fsp: 3 }),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => mysqlIndexes(NOTICES_INDEXES, table)
);

export type NextlyNoticeMysql = typeof nextlyNoticesMysql.$inferSelect;
