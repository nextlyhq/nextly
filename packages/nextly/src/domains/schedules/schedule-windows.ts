/**
 * A plugin schedule's windows: each enqueued once.
 *
 * A window is the latest time a schedule's cron fired at or before the pass
 * that looks at it. Claiming it and enqueuing its job happen in one
 * transaction: the window's row is inserted unless it is there already, and
 * only the transaction that inserted it enqueues the job. A runner that stops
 * before the commit leaves neither, so a later pass claims the window again;
 * one that stops after it leaves both, so no later pass enqueues it twice,
 * whether or not the job has finished. The job queue's own dedupe key cannot
 * say this: it is released when a job finishes.
 *
 * The insert lets the database ignore a conflict rather than raising it: on
 * PostgreSQL a raised one aborts the transaction, and with it the read that
 * says who won.
 *
 * A schedule's first window is the one that opens after a pass first sees
 * it: on first sight its latest window is recorded with no job, so a yearly
 * schedule deployed in November waits for January rather than running at
 * once for a January already gone. A schedule whose cron or time zone
 * changed is seen for the first time again, for the same reason. Windows
 * missed while no pass ran are not run later; only the latest is, and never
 * one older than a window already recorded, which a runner whose clock is
 * behind would otherwise claim.
 *
 * @module domains/schedules/schedule-windows
 * @experimental
 */
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import { and, asc, desc, eq, lt, lte } from "drizzle-orm";

import { scheduleWindowsTables } from "../../schemas/schedule-windows";
import { affectedRowCount } from "../../shared/lib/affected-row-count";
import type { JobSchedules } from "../jobs/job-registry";
import { enqueueInTransaction } from "../jobs/jobs-repository";

import type { CollectedSchedule } from "./collect-schedules";
import { latestFireAtOrBefore } from "./cron";

/** What the windows need of the database: its dialect and transactions. */
export interface ScheduleWindowsDatabase {
  readonly dialect: SupportedDialect;
  transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

/** The enqueue a window's transaction runs: `enqueueInTransaction` unless a test stands in. */
type Enqueue = typeof enqueueInTransaction;

/** A read the windows make through a handle's Drizzle builders. */
interface WindowReadDb {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        orderBy(order: unknown): {
          limit(
            count: number
          ): PromiseLike<{ windowAt: Date; definition: string }[]>;
        };
      };
    };
  };
}

/** The writes the windows make through a handle's Drizzle builders. */
interface WindowWriteDb extends WindowReadDb {
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): PromiseLike<unknown>;
    };
  };
  delete(table: unknown): { where(condition: unknown): PromiseLike<unknown> };
}

/** An insert that yields to a row already there, on PostgreSQL and SQLite. */
interface ConflictInsertDb {
  insert(table: unknown): {
    values(row: unknown): {
      onConflictDoNothing(): {
        returning(fields: Record<string, unknown>): PromiseLike<unknown[]>;
      };
    };
  };
}

/** The same on MySQL, which spells it `INSERT IGNORE`. */
interface IgnoreInsertDb {
  insert(table: unknown): {
    ignore(): { values(row: unknown): PromiseLike<unknown> };
  };
}

/** The window row's columns, as each dialect's table declares them. */
function tableOf(dialect: SupportedDialect) {
  return scheduleWindowsTables(dialect).nextlyScheduleWindows;
}

/**
 * Insert `row` unless its window is recorded already; whether this insert
 * wrote it.
 */
async function insertIfAbsent(
  tx: TransactionContext,
  dialect: SupportedDialect,
  row: Record<string, unknown>
): Promise<boolean> {
  const table = tableOf(dialect);
  if (dialect === "mysql") {
    const result = await tx
      .getDrizzle<IgnoreInsertDb>()
      .insert(table)
      .ignore()
      .values(row);
    return affectedRowCount(result, dialect) > 0;
  }
  const written = await tx
    .getDrizzle<ConflictInsertDb>()
    .insert(table)
    .values(row)
    .onConflictDoNothing()
    .returning({ scheduleKey: table.scheduleKey });
  return written.length > 0;
}

/** The latest window recorded for `scheduleKey`, and what it was read with. */
async function latestWindowOf(
  drizzle: WindowReadDb,
  dialect: SupportedDialect,
  scheduleKey: string
): Promise<{ windowAt: Date; definition: string } | undefined> {
  const table = tableOf(dialect);
  const [latest] = await drizzle
    .select({ windowAt: table.windowAt, definition: table.definition })
    .from(table)
    .where(eq(table.scheduleKey, scheduleKey))
    .orderBy(desc(table.windowAt))
    .limit(1);
  return latest;
}

/** What a window is read with: the schedule's cron and its time zone. */
function definitionOf(schedule: CollectedSchedule): string {
  return JSON.stringify([schedule.cron.source.trim(), schedule.timeZone]);
}

/** Claim `schedule`'s latest window at `now`, and enqueue its job if this claim is the one. */
async function sweepOne(
  db: ScheduleWindowsDatabase,
  schedule: CollectedSchedule,
  now: Date,
  enqueue: Enqueue
): Promise<void> {
  const windowAt = latestFireAtOrBefore(schedule.cron, now, schedule.timeZone);
  if (windowAt === null) return;
  const table = tableOf(db.dialect);
  await db.transaction(async tx => {
    const drizzle = tx.getDrizzle<WindowWriteDb>();
    const known = await latestWindowOf(drizzle, db.dialect, schedule.key);
    // Never a window at or before one already recorded: a clock behind
    // another runner's, or a cron moved earlier, would reach back for one.
    if (known !== undefined && windowAt <= known.windowAt) return;
    const definition = definitionOf(schedule);
    const claimed = await insertIfAbsent(tx, db.dialect, {
      scheduleKey: schedule.key,
      windowAt,
      jobId: null,
      definition,
      createdAt: now,
    });
    // First sight, of the schedule or of its current definition: the window
    // is recorded with no job, so its first job is for the next window.
    if (!claimed || known === undefined || known.definition !== definition) {
      return;
    }
    const { id } = await enqueue(tx, db.dialect, {
      slug: schedule.job,
      // The window last, so the schedule's own input cannot replace it.
      input: { ...schedule.input, window: windowAt.toISOString() },
      // Due at once: the window opening is what was waited for.
      runAt: null,
      // No principal: a schedule acts as nobody, as a sweep does.
      runAsUserId: null,
      now,
    });
    await drizzle
      .update(table)
      .set({ jobId: id })
      .where(
        and(eq(table.scheduleKey, schedule.key), eq(table.windowAt, windowAt))
      );
  });
}

/**
 * Remove up to `limit` of `schedule`'s windows from before `before`, keeping
 * its latest, however old: under "latest window only" an older window can
 * never come due again, but the latest can, for a schedule that fires less
 * often than the retention.
 */
async function pruneOne(
  db: ScheduleWindowsDatabase,
  schedule: CollectedSchedule,
  before: Date,
  limit: number
): Promise<number> {
  const table = tableOf(db.dialect);
  return db.transaction(async tx => {
    const drizzle = tx.getDrizzle<WindowWriteDb>();
    const latest = (await latestWindowOf(drizzle, db.dialect, schedule.key))
      ?.windowAt;
    if (latest === undefined) return 0;
    const cutoff = latest < before ? latest : before;
    const old = await drizzle
      .select({ windowAt: table.windowAt })
      .from(table)
      .where(
        and(eq(table.scheduleKey, schedule.key), lt(table.windowAt, cutoff))
      )
      .orderBy(asc(table.windowAt))
      .limit(limit);
    const last = old.at(-1);
    if (last === undefined) return 0;
    // Bounded by the oldest `limit` windows: the newest of them is the edge.
    await drizzle
      .delete(table)
      .where(
        and(
          eq(table.scheduleKey, schedule.key),
          lte(table.windowAt, last.windowAt)
        )
      );
    return old.length;
  });
}

/**
 * The windows of `schedules`, swept and pruned as a jobs pass asks.
 *
 * A schedule that cannot be swept does not stop the others, and does not fail
 * the pass: the jobs already queued are real work. `onError` hears of it.
 */
export function scheduleWindows(
  db: ScheduleWindowsDatabase,
  schedules: readonly CollectedSchedule[],
  options: {
    enqueue?: Enqueue;
    onError?: (error: unknown, scheduleKey: string) => void;
  } = {}
): JobSchedules {
  const enqueue = options.enqueue ?? enqueueInTransaction;
  return {
    async sweep(now) {
      for (const schedule of schedules) {
        try {
          await sweepOne(db, schedule, now, enqueue);
        } catch (error) {
          options.onError?.(error, schedule.key);
        }
      }
    },
    async prune(before, limit) {
      // One bound for the whole pass, shared out in turn, so many schedules
      // cannot make the pass a long delete.
      let pruned = 0;
      for (const schedule of schedules) {
        if (pruned >= limit) break;
        try {
          pruned += await pruneOne(db, schedule, before, limit - pruned);
        } catch (error) {
          options.onError?.(error, schedule.key);
        }
      }
      return pruned;
    },
  };
}
