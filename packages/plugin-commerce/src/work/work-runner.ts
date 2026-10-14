import { NextlyError } from "@nextlyhq/plugin-sdk";
import { asc, eq, lte } from "@nextlyhq/plugin-sdk/db";
import type {
  PluginDatabase,
  PluginTransaction,
} from "@nextlyhq/plugin-sdk/schema";

import { allOf } from "../cart/conditions";
import { ownTransaction } from "../own-transaction";
import { work } from "../schema/tables";

/**
 * The work table: steps that must follow a committed change, recorded in the
 * change's own transaction and run afterwards until each succeeds or is given
 * up with an alert.
 *
 * A step runs outside any transaction, since it calls an outside service. It
 * is claimed first by a compare-and-set that also sets a short lease, so two
 * runners never run one row at once; a runner that dies mid-step leaves the
 * row to be claimed again once its lease runs out. Every step is therefore
 * written to be repeat-safe by its own operation id, which the outside
 * service takes as the operation's key.
 */

/** A recorded step, as a handler is given it. */
export interface WorkItem {
  readonly id: string;
  readonly kind: string;
  readonly subjectId: string;
  readonly operationId: string;
  /** How many attempts have been claimed, this one included. */
  readonly attempt: number;
  /** When the first attempt was made, against which a key lifetime runs. */
  readonly firstAttemptAt: Date;
}

/** What runs one kind of step. It throws to have the step tried again. */
export type WorkHandler = (item: WorkItem) => Promise<void>;

/** How a failed step is retried, and when it is given up. */
export interface WorkRetry {
  /** Attempts before the step is abandoned with an alert. */
  readonly maxAttempts: number;
  /** The wait before the second attempt; it doubles after each failure. */
  readonly firstDelayMs: number;
  /** The longest wait between attempts. */
  readonly maxDelayMs: number;
  /** How long a claimed attempt holds the row before another may take it. */
  readonly leaseMs: number;
}

/**
 * A time as the work table stores it: whole seconds, rounded down. SQLite
 * stores no finer, and MySQL rounds a fraction to the nearest second, which
 * can put a step due now a moment into the future, where `now` does not
 * reach it. Rounding down first, as every time this module writes is, keeps a
 * step due at the moment it is written on every dialect.
 */
export function wholeSecond(time: Date): Date {
  return new Date(Math.floor(time.getTime() / 1000) * 1000);
}

export const DEFAULT_WORK_RETRY: WorkRetry = {
  maxAttempts: 12,
  firstDelayMs: 5_000,
  maxDelayMs: 3_600_000,
  leaseMs: 120_000,
};

/** Where an abandoned step is reported, so staff hear of it. */
export interface WorkAlerts {
  abandoned(item: WorkItem, error: unknown): void;
}

/**
 * Record a step in the transaction that makes it necessary, due at once.
 * The operation id is unique, so recording the same step twice fails the
 * transaction rather than doubling the work.
 */
export async function recordWork(
  tx: PluginTransaction,
  step: {
    readonly kind: string;
    readonly subjectId: string;
    readonly operationId: string;
    readonly now: Date;
  }
): Promise<void> {
  await tx.insert(work, {
    kind: step.kind,
    subjectId: step.subjectId,
    operationId: step.operationId,
    state: "pending",
    nextAttemptAt: wholeSecond(step.now),
    createdAt: step.now,
    updatedAt: step.now,
  });
}

/** The outcome of one runner pass. */
export interface WorkPass {
  readonly done: number;
  readonly retried: number;
  readonly abandoned: number;
}

/**
 * Run the steps that are due, oldest first, until none is left or the
 * deadline passes, checked before each step. With `subjectId`, only that
 * subject's steps: completion runs its own order's work at once this way,
 * without waiting for the work job.
 */
export async function runDueWork(options: RunOptions): Promise<WorkPass> {
  const retry = options.retry ?? DEFAULT_WORK_RETRY;
  const batchSize = options.batchSize ?? 50;
  const tally = { done: 0, retried: 0, abandoned: 0 };
  for (;;) {
    const due = await dueSteps(options, batchSize);
    const finished = await runBatch(options, due, retry, tally);
    // A batch shorter than asked for was everything due; anything retried in
    // it now waits for a later time, so reading again would find only what
    // became due meanwhile.
    if (!finished || due.length < batchSize) return tally;
  }
}

interface RunOptions {
  readonly db: PluginDatabase;
  readonly handlers: Readonly<Record<string, WorkHandler>>;
  readonly alerts: WorkAlerts;
  readonly now: () => Date;
  readonly deadline?: Date;
  readonly subjectId?: string;
  readonly retry?: WorkRetry;
  readonly batchSize?: number;
}

/** Run one batch of due steps; `false` when the deadline stopped it. */
async function runBatch(
  options: RunOptions,
  due: Awaited<ReturnType<typeof dueSteps>>,
  retry: WorkRetry,
  tally: { done: number; retried: number; abandoned: number }
): Promise<boolean> {
  for (const row of due) {
    if (options.deadline && options.now() >= options.deadline) return false;
    const item = await claim(options.db, row, options.now(), retry);
    if (item) tally[await runOne(options, item, retry)] += 1;
  }
  return true;
}

async function dueSteps(
  options: {
    readonly db: PluginDatabase;
    readonly now: () => Date;
    readonly subjectId?: string;
  },
  limit: number
) {
  const w = options.db.table(work);
  const conditions = [
    eq(w.state, "pending"),
    lte(w.nextAttemptAt, options.now()),
  ];
  if (options.subjectId !== undefined) {
    conditions.push(eq(w.subjectId, options.subjectId));
  }
  const [first, ...rest] = conditions;
  if (!first) return [];
  return options.db
    .select(work)
    .where(allOf(first, ...rest))
    .orderBy(asc(w.nextAttemptAt), asc(w.id))
    .limit(limit)
    .all();
}

/**
 * Take a due step for one attempt: count it, start its lease, and fix when
 * its first attempt was made. Only one claimant's compare-and-set matches, so
 * of two runners reaching the same row one runs it and the other moves on.
 */
async function claim(
  db: PluginDatabase,
  row: {
    readonly id: string;
    readonly kind: string;
    readonly subjectId: string;
    readonly operationId: string;
    readonly attempts: number;
    readonly version: number;
    readonly firstAttemptAt: Date | null;
  },
  now: Date,
  retry: WorkRetry
): Promise<WorkItem | null> {
  const firstAttemptAt = row.firstAttemptAt ?? wholeSecond(now);
  const claimed = await ownTransaction(db, tx => {
    const w = tx.table(work);
    return tx
      .update(work, {
        attempts: row.attempts + 1,
        version: row.version + 1,
        firstAttemptAt,
        nextAttemptAt: wholeSecond(new Date(now.getTime() + retry.leaseMs)),
        updatedAt: now,
      })
      .where(
        allOf(
          eq(w.id, row.id),
          eq(w.version, row.version),
          eq(w.state, "pending"),
          lte(w.nextAttemptAt, now)
        )
      );
  });
  if (claimed !== 1) return null;
  return {
    id: row.id,
    kind: row.kind,
    subjectId: row.subjectId,
    operationId: row.operationId,
    attempt: row.attempts + 1,
    firstAttemptAt,
  };
}

async function runOne(
  options: {
    readonly db: PluginDatabase;
    readonly handlers: Readonly<Record<string, WorkHandler>>;
    readonly alerts: WorkAlerts;
    readonly now: () => Date;
  },
  item: WorkItem,
  retry: WorkRetry
): Promise<"done" | "retried" | "abandoned"> {
  const handler = options.handlers[item.kind];
  try {
    if (!handler) {
      throw new Error(`no handler for work of kind "${item.kind}"`);
    }
    await handler(item);
    await settle(options.db, item, { state: "done", now: options.now() });
    return "done";
  } catch (error) {
    const now = options.now();
    if (item.attempt >= retry.maxAttempts) {
      await settle(options.db, item, {
        state: "abandoned",
        now,
        error: describe(error),
      });
      options.alerts.abandoned(item, error);
      return "abandoned";
    }
    await settle(options.db, item, {
      state: "pending",
      now,
      error: describe(error),
      nextAttemptAt: wholeSecond(
        new Date(now.getTime() + backoff(item.attempt, retry))
      ),
    });
    return "retried";
  }
}

/**
 * Record an attempt's outcome on its row. Written against the row as this
 * attempt claimed it, so a runner whose lease ran out, and whose row another
 * runner has since claimed, records nothing over the newer attempt.
 */
async function settle(
  db: PluginDatabase,
  item: WorkItem,
  outcome: {
    readonly state: "pending" | "done" | "abandoned";
    readonly now: Date;
    readonly error?: string;
    readonly nextAttemptAt?: Date;
  }
): Promise<void> {
  await ownTransaction(db, tx => {
    const w = tx.table(work);
    return tx
      .update(work, {
        state: outcome.state,
        lastError: outcome.error ?? null,
        updatedAt: outcome.now,
        ...(outcome.nextAttemptAt
          ? { nextAttemptAt: outcome.nextAttemptAt }
          : {}),
      })
      .where(allOf(eq(w.id, item.id), eq(w.attempts, item.attempt)));
  });
}

/** The wait after the given attempt failed: doubling, up to the most allowed. */
export function backoff(attempt: number, retry: WorkRetry): number {
  return Math.min(retry.firstDelayMs * 2 ** (attempt - 1), retry.maxDelayMs);
}

/**
 * What a failed attempt is recorded as: a commerce or core error's code, or
 * an error's kind. Never its message, since an outside service's client can
 * put a request URL, and a key in it, into the message, and this is stored
 * where operators read it.
 */
function describe(error: unknown): string {
  if (NextlyError.is(error)) return String(error.code);
  return error instanceof Error ? error.name : typeof error;
}
