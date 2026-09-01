/**
 * `nextly_jobs` - MySQL.
 *
 * Mirrors `./postgres.ts` column for column; see that module for why the claim
 * is a lease rather than `FOR UPDATE SKIP LOCKED`, and why `dedupe_key` is
 * nullable and unique.
 *
 * `datetime(..., { fsp: 3 })` throughout, matching the other core tables:
 * without fractional seconds two writes in the same second serialize to the
 * same value, and a lease whose expiry cannot be ordered against its
 * replacement is not a lease.
 *
 * @module schemas/jobs/mysql
 */

import {
  mysqlTable,
  varchar,
  int,
  datetime,
  json,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

import type { JobState } from "./types";

export const nextlyJobsMysql = mysqlTable(
  "nextly_jobs",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    slug: varchar("slug", { length: 191 }).notNull(),
    input: json("input"),

    state: varchar("state", { length: 32 }).$type<JobState>().notNull(),

    runAt: datetime("run_at", { fsp: 3 }),

    // Matched to `users.id`, which MySQL stores as varchar(191). A narrower
    // column here refuses a job queued by a legitimate user whose id is longer
    // in strict mode, and truncates it to an id that resolves to nobody
    // otherwise — and `resolveRunAs` fails a job closed when the id it reads
    // resolves to no user, so a truncation would look like a deleted account.
    runAsUserId: varchar("run_as_user_id", { length: 191 }),

    // 191 rather than 255: this column carries a unique index, and 191 is the
    // longest utf8mb4 key MySQL will index under the 767-byte prefix limit on
    // older row formats. `nextly_webhook_deliveries.locked_by` uses the same
    // bound for the same reason.
    dedupeKey: varchar("dedupe_key", { length: 191 }),

    attemptCount: int("attempt_count").notNull().default(0),
    nextAttemptAt: datetime("next_attempt_at", { fsp: 3 }),

    lockedBy: varchar("locked_by", { length: 191 }),
    lockedUntil: datetime("locked_until", { fsp: 3 }),

    lastError: text("last_error"),

    createdAt: datetime("created_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: datetime("updated_at", { fsp: 3 })
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

export type NextlyJobMysql = typeof nextlyJobsMysql.$inferSelect;
export type NextlyJobInsertMysql = typeof nextlyJobsMysql.$inferInsert;
