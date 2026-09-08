/**
 * `nextly_jobs` - PostgreSQL.
 *
 * The canonical column list; `./mysql.ts` and `./sqlite.ts` mirror it with
 * their own types. `id` uses the client-side UUID pattern (text +
 * `$defaultFn`) for cross-dialect parity with the other system tables.
 *
 * ## Why the lease, and not `FOR UPDATE SKIP LOCKED`
 *
 * `locked_by`/`locked_until` express the claim in ORDINARY columns, so one
 * implementation serves all three dialects. `SKIP LOCKED` is stronger and
 * exists on PostgreSQL and MySQL; SQLite has no such clause, and Nextly ships
 * a SQLite adapter. `nextly_webhook_deliveries` made the same trade for the
 * same reason and has run on it in production, so this inherits a decision
 * rather than re-opening one.
 *
 * ## Why `dedupe_key` is nullable AND unique
 *
 * All three dialects allow unlimited NULLs in a unique index, so a job that
 * names no dedupe key is never deduplicated while a job that names one can be
 * enqueued exactly once. `nextly_versions.draft_key` relies on the same
 * property. This is what makes duplicate suppression a DATABASE constraint
 * rather than a read-then-write: a periodic sweep and a queue trigger can both
 * try to enqueue the same work, and the second insert is refused rather than
 * prevented by a check that another writer could interleave with.
 *
 * @module schemas/jobs/postgres
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { JobState } from "./types";

export const nextlyJobsPg = pgTable(
  "nextly_jobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /** Which registered job type runs this row. */
    slug: text("slug").notNull(),
    /** The handler's input, opaque to this domain. */
    input: jsonb("input"),

    state: text("state").$type<JobState>().notNull(),

    // NULL means "as soon as a trigger sees it". A stored placeholder would be
    // indistinguishable from a job deliberately scheduled for the epoch.
    runAt: timestamp("run_at", { withTimezone: true }),

    // The identity the handler acts AS. NULL means the job genuinely acts as
    // nobody (webhook delivery reads nothing access-controlled); it does NOT
    // mean "system". A row whose id is set but no longer resolves is a
    // terminal failure, never a downgrade to this NULL case.
    runAsUserId: text("run_as_user_id"),

    // See the module note: nullable, unique, and the reason duplicate
    // suppression is a constraint rather than a check.
    dedupeKey: text("dedupe_key"),

    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),

    // The lease. Taken inside a transaction, released before the work runs (a
    // handler must never hold a row lock), and fenced on write so a runner
    // whose lease expired cannot record an outcome over its successor's.
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),

    /** Why a `failed` row failed. Surfaced in the admin. */
    lastError: text("last_error"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    // The due-job query reads exactly these two columns together.
    index("nextly_jobs_due_idx").on(table.state, table.runAt),
    // Ordering index for the recent-jobs read, which sorts the whole table by
    // `updatedAt` before its small limit applies. Without it that is a full
    // scan and sort on every monitoring request, and it degrades with queue
    // volume rather than staying bounded — the due index above cannot serve it,
    // because its leading column is `state`.
    //
    // A DECLARATION IS NOT AN UPGRADE PATH. A fresh install gets this index
    // when the table is pushed; an existing one does not, because
    // `drizzleTableToTableSpec` records only names and columns, so index-only
    // drift produces no operations and `reconcileCore` returns early before the
    // push that would create it. SQLite is repaired by the hand-written core
    // DDL in `database/sqlite-core-tables.ts`, which re-runs idempotently;
    // PostgreSQL and MySQL need a general core index-repair step in
    // `nextly upgrade`, which is filed rather than built here — see
    // `schemas/nextly-i18n-archive/ddl.ts` for the same problem solved for one
    // table.
    index("nextly_jobs_recent_idx").on(table.updatedAt),
    uniqueIndex("nextly_jobs_dedupe_idx").on(table.dedupeKey),
  ]
);

export type NextlyJobPg = typeof nextlyJobsPg.$inferSelect;
export type NextlyJobInsertPg = typeof nextlyJobsPg.$inferInsert;
