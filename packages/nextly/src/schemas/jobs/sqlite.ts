/**
 * `nextly_jobs` - SQLite.
 *
 * Mirrors `./postgres.ts` column for column; see that module for why the claim
 * is a lease rather than `FOR UPDATE SKIP LOCKED` — this dialect is the reason
 * — and why `dedupe_key` is nullable and unique.
 *
 * @module schemas/jobs/sqlite
 */

import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { JobState } from "./types";

export const nextlyJobsSqlite = sqliteTable(
  "nextly_jobs",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),

    slug: text("slug").notNull(),
    input: text("input", { mode: "json" }),

    state: text("state").$type<JobState>().notNull(),

    runAt: integer("run_at", { mode: "timestamp" }),

    runAsUserId: text("run_as_user_id"),

    dedupeKey: text("dedupe_key"),

    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),

    lockedBy: text("locked_by"),
    lockedUntil: integer("locked_until", { mode: "timestamp" }),

    lastError: text("last_error"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    index("nextly_jobs_due_idx").on(table.state, table.runAt),
    // See `schemas/jobs/postgres.ts` for what this index is for and why a
    // declaration alone does not put it on an existing database.
    index("nextly_jobs_recent_idx").on(table.updatedAt),
    uniqueIndex("nextly_jobs_dedupe_idx").on(table.dedupeKey),
  ]
);

export type NextlyJobSqlite = typeof nextlyJobsSqlite.$inferSelect;
export type NextlyJobInsertSqlite = typeof nextlyJobsSqlite.$inferInsert;
