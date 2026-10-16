/**
 * `nextly_notices` on PostgreSQL: a person's own notices.
 *
 * One row is one notice for one person, so the person's read state is the
 * row's own `read_at` rather than a second table. A notice is stored once per
 * occurrence: `dedupe_key` is a digest of who it is for, its kind, what it is
 * about and which occurrence, and is unique. It sits on a digest rather than
 * the source columns to stay inside MySQL's index key limit, as
 * `nextly_release_members.member_key` does.
 *
 * `data` is the kind's snapshot of what the notice is about, so it still reads
 * correctly after its subject is deleted.
 *
 * @module schemas/notices/postgres
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

import { NOTICES_INDEXES, pgIndexes } from "../_internal/core-indexes";
import { users } from "../users/postgres";

import { NOTICES_TABLE } from "./table-name";

export const nextlyNoticesPg = pgTable(
  NOTICES_TABLE,
  {
    id: text("id").primaryKey(),
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
    data: jsonb("data"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => pgIndexes(NOTICES_INDEXES, table)
);

export type NextlyNoticePg = typeof nextlyNoticesPg.$inferSelect;
