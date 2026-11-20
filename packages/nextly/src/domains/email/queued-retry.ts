/**
 * Retrying a queued email now, as a person who may manage email deliveries.
 *
 * A retry asks for the next attempt now, while the email's message is still
 * held:
 *
 * - **Waiting or retrying**: its pending job is made due now, unless a
 *   runner has already claimed it, in which case its attempt is about to go
 *   to the provider and the retry is refused as one made while sending.
 * - **Failed**, its message still held: it waits again, with a new job due
 *   now, and so with the attempts a new email has. Its last failure stays on
 *   the row until the next attempt replaces it, so it reads as retrying.
 * - **Sending**: refused while a runner holds its job's lease: the attempt
 *   with the provider decides the outcome, and a second one could send the
 *   message twice. Once that lease has lapsed (its runner stopped), the job
 *   is made due now, as the job queue would take it over.
 * - **Sent, cancelled, or its message cleared** (sent, erased or pruned):
 *   refused, saying why. Nothing is left to send.
 *
 * Each attempt renders a template-sent email from the template as it is
 * saved at that moment (`sendWithTemplate`), so a retry after the template
 * is fixed sends the fixed one; only the copies it was queued with are kept.
 *
 * Everything is decided and written in one transaction, under the row's
 * lock on PostgreSQL and MySQL, as a cancel is (`queued-cancel`).
 *
 * @module domains/email/queued-retry
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";

import { loadedDialect } from "../../database/dialect-tables";
import { NextlyError } from "../../errors";
import { rowLockStrength } from "../../shared/lib/row-lock";
import { runAdapterTransaction } from "../../shared/lib/run-adapter-transaction";
import { enqueueInTransaction } from "../jobs/jobs-repository";

import { QUEUED_EMAIL_JOB } from "./queued-email-job";
import type { QueueDialect } from "./queued-send-read";

/** The row a retry decides on. */
interface RetryRow {
  id: string;
  state: string;
  jobId: string | null;
  held: boolean | number;
}

/** The Drizzle surface a retry needs, on the retry's own transaction. */
interface RetryDb {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(count: number): PromiseLike<unknown[]> & {
          for?(strength: string): PromiseLike<unknown[]>;
        };
      };
    };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): PromiseLike<unknown>;
    };
  };
}

/** Refused: the email cannot be retried, and why, with no address in it. */
function refused(message: string, id: string, state: string): NextlyError {
  return NextlyError.conflict({
    message,
    logContext: { queuedId: id, state },
  });
}

/**
 * What a retry did: the email's id, the state it stands in, and the state it
 * was retried from, which says what changed (`waiting` or `sending`: its
 * job's next attempt; `failed`: its state and job).
 */
export interface QueuedEmailRetried {
  id: string;
  state: "waiting" | "sending";
  from: "waiting" | "sending" | "failed";
}

/**
 * Retry queued email `id` now, as the module describes.
 *
 * @throws {NextlyError} `NOT_FOUND` for no such email; `CONFLICT` for one
 *   being sent now, sent, cancelled, or whose message was cleared.
 */
export async function retryQueuedEmailAsPerson(
  adapter: DrizzleAdapter,
  id: string,
  now: Date = new Date()
): Promise<QueuedEmailRetried> {
  const dialect: QueueDialect = adapter.getCapabilities().dialect;
  const { emailQueue: queue, nextlyJobs: jobs } = loadedDialect(dialect).tables;
  return runAdapterTransaction<QueuedEmailRetried, TransactionContext>(
    run => adapter.transaction(ctx => run(ctx)),
    async tx => {
      const db = tx.getDrizzle<RetryDb>();
      const read = db
        .select({
          id: queue.id,
          state: queue.state,
          jobId: queue.jobId,
          // Whether a message is held, never the message.
          held: isNotNull(queue.message),
        })
        .from(queue)
        .where(eq(queue.id, id))
        .limit(1);
      const strength = rowLockStrength({ dialect }, "exclusive");
      const [row] = (await (strength !== null && read.for
        ? read.for(strength)
        : read)) as RetryRow[];
      if (!row) throw NextlyError.notFound({ logContext: { queuedId: id } });
      const from = retryableFrom(row);
      if (
        (from === "waiting" || from === "sending") &&
        row.jobId !== null &&
        (await bringForward(db, jobs, row.jobId, now))
      ) {
        return { id: row.id, state: from, from };
      }
      if (
        from === "sending" ||
        (row.jobId !== null && (await jobHeld(db, jobs, row.jobId, now)))
      ) {
        throw refused(
          "This email is being sent now. Retry it once this attempt ends.",
          row.id,
          "sending"
        );
      }

      // Failed, or waiting on a job that is gone: a new job, due now.
      const { id: jobId } = await enqueueInTransaction(tx, {
        slug: QUEUED_EMAIL_JOB,
        input: { queuedId: row.id },
        runAt: null,
        runAsUserId: null,
        now,
      });
      await db
        .update(queue)
        .set({
          state: "waiting",
          jobId,
          settledAt: null,
          updatedAt: now.getTime(),
        })
        .where(eq(queue.id, row.id));
      return { id: row.id, state: "waiting", from };
    }
  );
}

/**
 * The state a retry starts from, or the refusal of one that cannot be
 * retried: sent or cancelled, or with its message cleared.
 */
function retryableFrom(row: RetryRow): QueuedEmailRetried["from"] {
  if (row.state === "sent" || row.state === "cancelled") {
    throw refused(
      "This email has already been sent or cancelled.",
      row.id,
      row.state
    );
  }
  if (!row.held) {
    throw refused(
      "This email's message has been cleared, so it can't be sent again.",
      row.id,
      row.state
    );
  }
  return row.state as QueuedEmailRetried["from"];
}

/**
 * Make pending job `jobId` due now, unless a runner holds its lease: that
 * attempt is with the provider, or about to reach it. A lease ending now is
 * free, as the job queue reads it. Answers whether it was made due.
 */
async function bringForward(
  db: RetryDb,
  jobs: ReturnType<typeof loadedDialect>["tables"]["nextlyJobs"],
  jobId: string,
  now: Date
): Promise<boolean> {
  const claimable = and(
    eq(jobs.id, jobId),
    eq(jobs.state, "pending"),
    or(isNull(jobs.lockedUntil), lte(jobs.lockedUntil, now))
  );
  const [job] = (await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(claimable)
    .limit(1)) as Array<{ id: string }>;
  if (!job) return false;
  await db
    .update(jobs)
    .set({ runAt: null, nextAttemptAt: null, updatedAt: now })
    .where(claimable);
  return true;
}

/** Whether job `id` is held by a runner now: pending, under a live lease. */
async function jobHeld(
  db: RetryDb,
  jobs: ReturnType<typeof loadedDialect>["tables"]["nextlyJobs"],
  id: string,
  now: Date
): Promise<boolean> {
  const [held] = (await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.id, id),
        eq(jobs.state, "pending"),
        isNotNull(jobs.lockedBy),
        gt(jobs.lockedUntil, now)
      )
    )
    .limit(1)) as Array<{ id: string }>;
  return held !== undefined;
}
