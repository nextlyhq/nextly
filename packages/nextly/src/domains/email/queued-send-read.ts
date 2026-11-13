/**
 * Where a caller's own queued emails stand, read by id: what a plugin asks
 * before it offers to send an email again, so it can say one is still in
 * progress, and how it learns of a cancel no change told it of (an erasure,
 * `queued-cancel`).
 *
 * Only the caller's own: an id another caller queued reads as absent, as one
 * that never existed or was pruned does. Nothing of the message is read, so
 * no address leaves here.
 *
 * @module domains/email/queued-send-read
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { loadedDialect } from "../../database/dialect-tables";
import { NextlyError } from "../../errors";

import type { EmailFailure } from "./failure";

/** The dialects whose tables these reads take. */
export type QueueDialect = "postgresql" | "mysql" | "sqlite";

/**
 * @experimental Where a queued email stands, as its caller reads it:
 * `retrying` is waiting with a failure recorded, so another attempt follows.
 */
export type QueuedEmailStanding =
  | "waiting"
  | "retrying"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

/** @experimental One of the caller's queued emails, as `readQueued` answers it. */
export interface QueuedEmailStatus {
  id: string;
  state: QueuedEmailStanding;
  /** Attempts made so far: the one in flight counts once it has started. */
  attempts: number;
  /**
   * Whether its message is still held: only then could it be sent at all,
   * by an attempt to come or a retry.
   */
  messageHeld: boolean;
  /** The last failed attempt's failure, with no address in it. */
  failure?: EmailFailure;
  updatedAt: Date;
  /** When it was sent, failed for good, or cancelled. */
  settledAt?: Date;
}

/** The Drizzle surface these reads need. */
interface ReadDb {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): PromiseLike<unknown[]>;
    };
  };
}

/** How many attempts each job has made, by job id, read on `db`. */
async function attemptsOf(
  db: ReadDb,
  dialect: QueueDialect,
  jobIds: readonly string[]
): Promise<Map<string, number>> {
  if (jobIds.length === 0) return new Map();
  const jobs = loadedDialect(dialect).tables.nextlyJobs;
  const rows = (await db
    .select({ id: jobs.id, attemptCount: jobs.attemptCount })
    .from(jobs)
    .where(inArray(jobs.id, [...jobIds]))) as Array<{
    id: string;
    attemptCount: number;
  }>;
  return new Map(rows.map(row => [row.id, Number(row.attemptCount)]));
}

/** {@link attemptsOf}, on a transaction, so it sees what that wrote. */
export function attemptsOn(
  tx: TransactionContext,
  dialect: QueueDialect,
  jobIds: readonly string[]
): Promise<Map<string, number>> {
  return attemptsOf(tx.getDrizzle<ReadDb>(), dialect, jobIds);
}

/** The most ids one read takes. */
const MAX_IDS = 500;

const IDS = z.array(z.string().min(1).max(36)).max(MAX_IDS);

const STORED_FAILURE = z.object({
  retryable: z.boolean(),
  status: z.number().optional(),
  reason: z.string(),
});

/** A stored failure as the row keeps it, or undefined for none or garbage. */
function storedFailureOf(text: unknown): EmailFailure | undefined {
  if (typeof text !== "string") return undefined;
  try {
    const parsed = STORED_FAILURE.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

interface QueueRow {
  id: string;
  state: string;
  jobId: string | null;
  held: unknown;
  failure: string | null;
  updatedAt: number | string;
  settledAt: number | string | null;
}

/** How a row's state reads to its caller. */
function standingOf(row: QueueRow): QueuedEmailStanding {
  if (row.state === "waiting" && row.failure !== null) return "retrying";
  return row.state as QueuedEmailStanding;
}

/** One row as its caller reads it. */
function statusOf(
  row: QueueRow,
  attempts: ReadonlyMap<string, number>
): QueuedEmailStatus {
  const failure = storedFailureOf(row.failure);
  return {
    id: row.id,
    state: standingOf(row),
    attempts: row.jobId ? (attempts.get(row.jobId) ?? 0) : 0,
    messageHeld: Number(row.held) === 1,
    ...(failure ? { failure } : {}),
    updatedAt: new Date(Number(row.updatedAt)),
    ...(row.settledAt !== null
      ? { settledAt: new Date(Number(row.settledAt)) }
      : {}),
  };
}

/**
 * Where the queued emails among `ids` that `scope` queued stand. An id that
 * is not one of them is left out.
 *
 * @throws {NextlyError} `VALIDATION_ERROR` for more than 500 ids, or one that
 *   is not an id.
 */
export async function readQueuedEmails(
  adapter: DrizzleAdapter,
  scope: string,
  ids: readonly string[]
): Promise<QueuedEmailStatus[]> {
  const parsed = IDS.safeParse(ids);
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: [
        {
          path: "ids",
          code: "INVALID",
          message: `At most ${MAX_IDS} queued email ids, each as \`queue\` answered it.`,
        },
      ],
    });
  }
  if (parsed.data.length === 0) return [];
  const dialect: QueueDialect = adapter.getCapabilities().dialect;
  const queue = loadedDialect(dialect).tables.emailQueue;
  const db = adapter.getDrizzle<ReadDb>();
  const rows = (await db
    .select({
      id: queue.id,
      state: queue.state,
      jobId: queue.jobId,
      // Whether a message is held, never the message.
      held: sql`case when ${queue.message} is null then 0 else 1 end`,
      failure: queue.failure,
      updatedAt: queue.updatedAt,
      settledAt: queue.settledAt,
    })
    .from(queue)
    .where(
      and(
        inArray(queue.id, [...new Set(parsed.data)]),
        eq(queue.scope, scope),
        // By the exact bytes of the scope, as every read of a caller's own
        // rows is: MySQL's collation would match another plugin's name.
        dialect === "mysql"
          ? sql`CAST(${queue.scope} AS BINARY) = CAST(${scope} AS BINARY)`
          : undefined
      )
    )) as QueueRow[];
  const attempts = await attemptsOf(
    db,
    dialect,
    rows.flatMap(row => (row.jobId ? [row.jobId] : []))
  );
  return rows.map(row => statusOf(row, attempts));
}
