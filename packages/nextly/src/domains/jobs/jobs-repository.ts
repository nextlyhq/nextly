/**
 * Repository for `nextly_jobs`.
 *
 * The only place in the domain that writes SQL. Column names are the Drizzle
 * property names (camelCase) on reads; the adapter maps them to snake_case,
 * and writes name the snake_case column directly, matching how the webhook
 * delivery claim addresses its own lease columns.
 *
 * ## Why the claim is a lease and not `FOR UPDATE SKIP LOCKED`
 *
 * `SKIP LOCKED` is a stronger claim and exists on PostgreSQL and MySQL. SQLite
 * has no such clause and Nextly ships a SQLite adapter, so expressing the
 * claim in ORDINARY columns is what lets ONE implementation serve all three
 * dialects. `nextly_webhook_deliveries` made this exact trade and has run on
 * it; this inherits the decision rather than re-opening it.
 *
 * ## Why `enqueue` does not check before it inserts
 *
 * Duplicate suppression is a UNIQUE constraint, and the insert is allowed to
 * fail. Reading for an existing row and then inserting is the shape that lets
 * two writers interleave and both be told they won — the defect already filed
 * as `plugins-cannot-compare-and-set-through-direct-api`. A periodic sweep and
 * a queue trigger enqueueing the same work concurrently is the ordinary case
 * here, not an exotic one, so the rule has to hold where the database enforces
 * it.
 *
 * @module domains/jobs/jobs-repository
 */

import type {
  SelectOptions,
  UpdateOptions,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";
import type { JobState } from "../../schemas/jobs/types";
import { isUniqueViolation } from "../../shared/lib/unique-violation";

import { MAX_PORTABLE_KEY_LENGTH } from "./portable-key";

const JOBS = "nextly_jobs";

/** The longest value every supported dialect can store in an indexed column. */

/**
 * The transaction surface the lease claim needs (subset of the adapter tx).
 *
 * `where` and `options` name the ADAPTER's own types rather than restating
 * their shape. A restated `{ column, op, value }` looks equivalent and is not:
 * the adapter constrains the operator and the parameter, so a hand-written copy
 * is a different type that the real transaction context does not satisfy —
 * which the compiler reports at the call site, a long way from the mistake.
 */
export interface JobsTx {
  select<T = unknown>(table: string, options?: SelectOptions): Promise<T[]>;
  update<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause,
    options?: UpdateOptions
  ): Promise<T[]>;
}

/**
 * The database surface this repository needs.
 *
 * Declared here rather than aliased from `VersionsDbApi` because it is
 * genuinely wider: that port has neither `transaction` nor a `forUpdate`
 * select, and the claim cannot be written without both. Widening the shared
 * port to fit would hand every one of its consumers a transaction capability
 * none of them asked for.
 */
export interface JobsDatabase {
  insert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options?: { returning?: string[] | "*" }
  ): Promise<T>;
  select<T = unknown>(table: string, options?: SelectOptions): Promise<T[]>;
  // `returning` names COLUMNS or "*" — it is not a boolean. `finalize` depends
  // on the returned row count to know whether the fence let its write through,
  // so asking for rows in a way the adapter does not understand would make that
  // count meaningless.
  update<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause,
    options?: UpdateOptions
  ): Promise<T[]>;
  /**
   * Update and report how many rows CHANGED.
   *
   * Used by `finalize` instead of `update({ returning })`, because MySQL has no
   * RETURNING: the adapter emulates it by re-selecting with the original
   * predicate, and `finalize`'s predicate includes `locked_by` — which the same
   * write clears. The re-select therefore matches nothing and the fenced update
   * reports failure even when it succeeded. `updateCount` is the adapter's
   * documented path for a conditional update that moves a predicate column.
   */
  delete(table: string, where: WhereClause): Promise<number>;
  updateCount(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause
  ): Promise<number>;
  transaction<T>(fn: (tx: JobsTx) => Promise<T>): Promise<T>;
}

/** One stored job, as the runner reads it. */
export interface JobRow {
  id: string;
  slug: string;
  input: unknown;
  state: JobState;
  runAt: Date | null;
  runAsUserId: string | null;
  dedupeKey: string | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lockedBy: string | null;
  lockedUntil: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewJob {
  slug: string;
  input: unknown;
  /** `null` means "as soon as a trigger sees it". */
  runAt: Date | null;
  /** `null` means the job acts as nobody; it does NOT mean "as the system". */
  runAsUserId: string | null;
  /** `null` opts out of duplicate suppression entirely. */
  dedupeKey: string | null;
  now: Date;
}

export interface EnqueueResult {
  id: string;
  /** True when an equal `dedupeKey` already existed and `id` is that row's. */
  deduped: boolean;
}

/** What a finished attempt did. */
export type FinalizeOutcome = "done" | "retry" | "failed";

export interface FinalizeInput {
  id: string;
  /** The lease this runner holds. The write is fenced to it. */
  runnerId: string;
  outcome: FinalizeOutcome;
  /** Set only for `retry`; when the next attempt becomes due. */
  nextAttemptAt: Date | null;
  lastError: string | null;
  now: Date;
}

export class JobsRepository {
  constructor(private readonly db: JobsDatabase) {}

  /**
   * Add a job, or report that an equal one is already queued.
   *
   * The insert is attempted first and allowed to fail; see the module note on
   * why this is not a read-then-write.
   */
  async enqueue(input: NewJob): Promise<EnqueueResult> {
    // The same portable bound the slug is held to. MySQL stores this in
    // varchar(191) — the widest utf8mb4 value it will index — and refuses a
    // longer one in strict mode, while PostgreSQL and SQLite accept it. Without
    // this check a dedupe key works on two dialects and throws on the third, at
    // enqueue time rather than where the caller chose the key.
    // Validated here as well as in `defineJob`. This is an exported surface: a
    // caller can reach it with a slug that never went through a definition, and
    // MySQL would then refuse the insert while the other two dialects accepted
    // it.
    if (input.slug.length > MAX_PORTABLE_KEY_LENGTH) {
      throw NextlyError.invalidInput({
        message: `A job slug may be at most ${MAX_PORTABLE_KEY_LENGTH} characters.`,
        logContext: { length: input.slug.length },
      });
    }
    if (
      input.dedupeKey !== null &&
      input.dedupeKey.length > MAX_PORTABLE_KEY_LENGTH
    ) {
      throw NextlyError.invalidInput({
        message: `A job dedupe key may be at most ${MAX_PORTABLE_KEY_LENGTH} characters.`,
        logContext: { slug: input.slug, length: input.dedupeKey.length },
      });
    }

    return this.insertOrDedupe(input, true);
  }

  /**
   * One insert attempt, resolving a duplicate-key refusal.
   *
   * `mayRetry` is spent by the one case that deserves a second attempt: the row
   * holding the key vacated it between our failed insert and the read that
   * looked for it.
   */
  private async insertOrDedupe(
    input: NewJob,
    mayRetry: boolean
  ): Promise<EnqueueResult> {
    const id = crypto.randomUUID();
    try {
      await this.db.insert(JOBS, {
        id,
        slug: input.slug,
        input: input.input ?? null,
        state: "pending" satisfies JobState,
        run_at: input.runAt,
        run_as_user_id: input.runAsUserId,
        dedupe_key: input.dedupeKey,
        attempt_count: 0,
        next_attempt_at: null,
        locked_by: null,
        locked_until: null,
        last_error: null,
        created_at: input.now,
        updated_at: input.now,
      });
      return { id, deduped: false };
    } catch (error) {
      // A duplicate key reaches here in one of several shapes and nested a
      // couple of wrappers deep; `isUniqueViolation` is the one place that
      // knows all of them. Deliberately NOT re-derived locally — there were
      // already three spellings of this question in the codebase, and a fourth
      // in this file is how they stay out of step.
      //
      // `database/errors.ts#toDbError` looks like the obvious choice and is the
      // wrong one: for SQLite it decides by matching the message, and by this
      // point the adapter has replaced the driver's message with the SQL
      // statement. Measured, not assumed.
      if (!isUniqueViolation(error)) throw error;
      // A job with no dedupe key can never reach this branch: all three
      // dialects treat NULL as distinct from NULL in a unique index, so such
      // rows never collide. Reaching here therefore means `dedupeKey` is set
      // and some row already holds it.
      const existing = await this.db.select<JobRow>(JOBS, {
        where: {
          and: [{ column: "dedupeKey", op: "=", value: input.dedupeKey }],
        },
        limit: 1,
      });
      const winner = existing[0];
      // The row that held the key is gone from under us — it reached a terminal
      // state and released the key, or was pruned, between the failed insert
      // and this read. Nothing is outstanding, so the caller's work is NOT a
      // duplicate and reporting it as one would drop it silently. Insert again.
      //
      // Once, not in a loop: a second collision means another writer is
      // actively winning the race, and that IS a live duplicate rather than a
      // vacated key.
      if (!winner) {
        if (!mayRetry) throw error;
        return this.insertOrDedupe(input, false);
      }
      return { id: winner.id, deduped: true };
    }
  }

  /**
   * Jobs whose time has come and whose lease is free, oldest first.
   *
   * Every predicate is applied by the DATABASE, before the limit. Filtering in
   * memory afterwards looks equivalent and is not: a page filled with rows that
   * are not yet due comes back, is filtered to nothing, and a runnable row
   * behind them is never reached — on this pass or any later one, because the
   * same rows fill the page every time. That is head-of-line blocking, and it
   * is permanent rather than transient.
   *
   * `nextly_webhook_deliveries` selects its due rows the same way, for the same
   * reason.
   */
  async findDue(input: { now: Date; limit: number }): Promise<JobRow[]> {
    return this.db.select<JobRow>(JOBS, {
      where: {
        and: [
          { column: "state", op: "=", value: "pending" },
          // `runAt` is the schedule and `nextAttemptAt` is the retry. Either
          // being unset means "no constraint from that side", which is why each
          // is a null-or-past pair rather than a single comparison.
          {
            or: [
              { column: "runAt", op: "IS NULL", value: null },
              { column: "runAt", op: "<=", value: input.now },
            ],
          },
          {
            or: [
              { column: "nextAttemptAt", op: "IS NULL", value: null },
              { column: "nextAttemptAt", op: "<=", value: input.now },
            ],
          },
          // A row another runner currently holds is not due. It stays `pending`
          // so a retry can find it once the lease lapses, so state alone cannot
          // answer this.
          {
            or: [
              { column: "lockedUntil", op: "IS NULL", value: null },
              { column: "lockedUntil", op: "<=", value: input.now },
            ],
          },
        ],
      },
      orderBy: [{ column: "createdAt", direction: "asc" }],
      limit: input.limit,
    });
  }

  /**
   * Claim one job by taking a lease inside a transaction.
   *
   * Returns the row if this runner won, else null (another runner holds it, it
   * is no longer due, or it vanished). The read-check-write runs in ONE
   * transaction under a `forUpdate` row lock — a no-op on SQLite, whose
   * transactions already serialize writers — so a concurrent claim cannot slip
   * between the read and the lease write.
   */
  async claim(
    id: string,
    runnerId: string,
    now: Date,
    leaseMs: number
  ): Promise<JobRow | null> {
    return this.db.transaction(async tx => {
      const rows = await tx.select<JobRow>(JOBS, {
        where: { and: [{ column: "id", op: "=", value: id }] },
        limit: 1,
        forUpdate: true,
      });
      const row = rows[0];
      if (!row) return null;
      if (row.state !== "pending") return null;
      if (!isDue(row, now)) return null;
      if (!isLeaseFree(row, now)) return null;

      const lockedUntil = new Date(now.getTime() + leaseMs);
      await tx.update(
        JOBS,
        { locked_by: runnerId, locked_until: lockedUntil, updated_at: now },
        { and: [{ column: "id", op: "=", value: id }] }
      );
      // Reflect the lease just taken onto the returned row so `finalize` can
      // fence on ownership: `lockedBy` now identifies this runner.
      return { ...row, lockedBy: runnerId, lockedUntil };
    });
  }

  /**
   * Extend this runner's lease while its handler is still working.
   *
   * Without renewal the lease is a wall-clock guess about how long a handler
   * takes, and a handler that outruns it is reclaimed and run a second time
   * CONCURRENTLY — the fence then refuses the first runner's write but cannot
   * undo whatever it already did outside the database.
   *
   * Fenced on `locked_by` like every other write here, so a runner whose lease
   * has already been taken cannot extend a lease it no longer holds. `false`
   * says exactly that, and the runner uses it to stop renewing.
   */
  async renewLease(
    id: string,
    runnerId: string,
    now: Date,
    leaseMs: number
  ): Promise<boolean> {
    const affected = await this.db.updateCount(
      JOBS,
      { locked_until: new Date(now.getTime() + leaseMs), updated_at: now },
      {
        and: [
          { column: "id", op: "=", value: id },
          { column: "lockedBy", op: "=", value: runnerId },
        ],
      }
    );
    return affected > 0;
  }

  /**
   * Remove terminal rows older than `before`, at most `limit` of them.
   *
   * A queue without this grows forever: every completed and every permanently
   * failed execution keeps its input and its error, and a recurring workload
   * writes one row per run. Bounded per call so a sweep cannot become a long
   * delete that outlives the pass it runs in.
   *
   * Only `done` and `failed` rows are eligible. A `pending` row is outstanding
   * work and a `running` one is somebody's in flight.
   */
  async pruneTerminal(before: Date, limit: number): Promise<number> {
    const rows = await this.db.select<{ id: string }>(JOBS, {
      columns: ["id"],
      where: {
        and: [
          { column: "state", op: "IN", value: ["done", "failed"] },
          { column: "updatedAt", op: "<", value: before },
        ],
      },
      orderBy: [{ column: "updatedAt", direction: "asc" }],
      limit,
    });
    if (rows.length === 0) return 0;
    return this.db.delete(JOBS, {
      and: [{ column: "id", op: "IN", value: rows.map(r => r.id) }],
    });
  }

  /**
   * Record what an attempt did, ONLY if this runner still holds the lease.
   *
   * Returns false when the lease had been handed to someone else — a slow
   * runner whose lease expired must not write its stale outcome across its
   * successor's work. The fence is the `locked_by` term in the where clause,
   * so it is the database that refuses, not a check this code performs first.
   */
  async finalize(input: FinalizeInput): Promise<boolean> {
    const data: Record<string, unknown> =
      input.outcome === "retry"
        ? {
            state: "pending" satisfies JobState,
            next_attempt_at: input.nextAttemptAt,
            last_error: input.lastError,
            // The lease is dropped so the next attempt is claimable.
            locked_by: null,
            locked_until: null,
            updated_at: input.now,
          }
        : {
            state: (input.outcome === "done"
              ? "done"
              : "failed") satisfies JobState,
            next_attempt_at: null,
            last_error: input.lastError,
            locked_by: null,
            locked_until: null,
            // Release the dedupe key. It exists to stop a SECOND copy of work
            // that is still outstanding; once this row is terminal there is no
            // outstanding work, and holding the key would report the next
            // request for the same logical job as a duplicate of one that has
            // already been and gone. Recurring work with a stable key — "apply
            // release r1", a nightly sweep — would be enqueued exactly once
            // ever.
            dedupe_key: null,
            updated_at: input.now,
          };

    // The write always moves `locked_by` (to null), so on MySQL — which counts
    // CHANGED rows rather than matched ones — a matched row is always a counted
    // row. `updateCount`'s own docblock requires exactly that of a caller using
    // it as a compare-and-set.
    const affected = await this.db.updateCount(JOBS, data, {
      and: [
        { column: "id", op: "=", value: input.id },
        { column: "lockedBy", op: "=", value: input.runnerId },
      ],
    });
    return affected > 0;
  }

  /**
   * Increment the attempt counter, ONLY while this runner holds the lease.
   *
   * Fenced for the same reason `finalize` is. A runner that pauses between
   * claiming and this write can have its lease expire and be reclaimed; the
   * successor then advances the count, and an unfenced write from the stale
   * runner would put it back — so a job that has been attempted three times
   * reports two, and outlives the budget meant to stop it.
   */
  async markAttempt(
    id: string,
    runnerId: string,
    attemptCount: number,
    now: Date
  ): Promise<boolean> {
    const affected = await this.db.updateCount(
      JOBS,
      { attempt_count: attemptCount, updated_at: now },
      {
        and: [
          { column: "id", op: "=", value: id },
          { column: "lockedBy", op: "=", value: runnerId },
        ],
      }
    );
    // `false` says the lease is no longer ours: a successor holds the job, and
    // everything this runner does from here produces a result the fence will
    // refuse anyway. The caller stops rather than running the handler twice.
    return affected > 0;
  }
}

/**
 * Whether a pending row is ready to run.
 *
 * `runAt` is the schedule and `nextAttemptAt` is the retry; a row is due when
 * neither is set in the future. Shared by `findDue` and `claim` so a job
 * cannot be listed as due by one and refused as not-due by the other — the
 * divergence that makes a queue appear to stall with work visibly waiting in
 * it.
 */
function isDue(row: JobRow, now: Date): boolean {
  const ms = now.getTime();
  if (row.runAt != null && row.runAt.getTime() > ms) return false;
  if (row.nextAttemptAt != null && row.nextAttemptAt.getTime() > ms) {
    return false;
  }
  return true;
}

/**
 * Whether nobody currently holds this row.
 *
 * Shared by `findDue` and `claim` for the same reason `isDue` is: two spellings
 * of "is it free" lets one report a job as available that the other then
 * refuses, which presents as a queue that stalls with work visibly waiting.
 */
function isLeaseFree(row: JobRow, now: Date): boolean {
  return row.lockedUntil == null || row.lockedUntil.getTime() <= now.getTime();
}
