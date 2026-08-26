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

import type { JobState } from "../../schemas/jobs/types";
import { isUniqueViolation } from "../../shared/lib/unique-violation";

const JOBS = "nextly_jobs";

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
      // The row was deleted between the failed insert and this read. Nothing
      // is queued and nothing was written, so say so rather than reporting a
      // deduplication against a row that no longer exists.
      if (!winner) throw error;
      return { id: winner.id, deduped: true };
    }
  }

  /** Jobs whose time has come and whose lease is free, oldest first. */
  async findDue(input: { now: Date; limit: number }): Promise<JobRow[]> {
    const rows = await this.db.select<JobRow>(JOBS, {
      where: { and: [{ column: "state", op: "=", value: "pending" }] },
      orderBy: [{ column: "createdAt", direction: "asc" }],
      limit: input.limit,
    });
    // A row another runner currently holds is NOT due. It is still `pending`,
    // because a retry has to be able to find it again once the lease lapses,
    // so state alone cannot answer this.
    // The due predicate is applied here rather than in SQL because it spans
    // two nullable columns with different meanings — `runAt` is the schedule
    // and `nextAttemptAt` is the retry — and expressing "either is null or
    // either has passed" as a portable where-clause across three dialects
    // costs more than filtering a bounded page.
    return rows.filter(
      row => isDue(row, input.now) && isLeaseFree(row, input.now)
    );
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
            updated_at: input.now,
          };

    const affected = await this.db.update(
      JOBS,
      data,
      {
        and: [
          { column: "id", op: "=", value: input.id },
          { column: "lockedBy", op: "=", value: input.runnerId },
        ],
      },
      { returning: "*" }
    );
    return affected.length > 0;
  }

  /** Increment the attempt counter. Called by the runner as it starts work. */
  async markAttempt(
    id: string,
    attemptCount: number,
    now: Date
  ): Promise<void> {
    await this.db.update(
      JOBS,
      { attempt_count: attemptCount, updated_at: now },
      { and: [{ column: "id", op: "=", value: id }] }
    );
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
