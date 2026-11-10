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
 * once for a January already gone. A schedule's key carries its cron and
 * time zone, so each definition keeps windows of its own: a changed one is
 * seen for the first time, a reverted one still within the retention
 * resumes (running its latest window once if one opened in between), and
 * during a rolling deploy whose versions differ each definition runs its own.
 * Windows missed while no pass ran are not run later; only the latest is,
 * and never one older than a window already recorded, which a runner whose
 * clock is behind would otherwise claim.
 *
 * A pass sweeps only the schedules with a window to claim, the longest
 * waiting first, as the windows recorded say: a pass cut short by its
 * deadline leaves the rest to the next, which reaches them before any it
 * has just swept, however often passes run. Pruning takes the oldest windows
 * first, whichever schedule they belong to, for the same reason.
 *
 * @module domains/schedules/schedule-windows
 * @experimental
 */
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import { and, asc, eq, inArray, lt, lte, max, or } from "drizzle-orm";

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

/** A read of each schedule's latest window, grouped by schedule. */
interface LatestReadDb {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        groupBy(column: unknown): PromiseLike<
          // MySQL hands a binary key back as bytes.
          { scheduleKey: unknown; latest: Date | null }[]
        >;
      };
    };
  };
}

/** A read of windows with the schedule they belong to, oldest first. */
interface KeyedReadDb {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        orderBy(order: unknown): {
          limit(
            count: number
          ): PromiseLike<{ scheduleKey: unknown; windowAt: Date }[]>;
        };
      };
    };
  };
}

/** The writes the windows make through a handle's Drizzle builders. */
interface WindowWriteDb {
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

/**
 * The latest window recorded for each of `keys`, in one read on the table's
 * key. A key never seen has none.
 */
async function latestWindowsOf(
  tx: TransactionContext,
  dialect: SupportedDialect,
  keys: readonly string[]
): Promise<Map<string, Date>> {
  const latest = new Map<string, Date>();
  if (keys.length === 0) return latest;
  const table = tableOf(dialect);
  const rows = await tx
    .getDrizzle<LatestReadDb>()
    .select({ scheduleKey: table.scheduleKey, latest: max(table.windowAt) })
    .from(table)
    .where(inArray(table.scheduleKey, [...keys]))
    .groupBy(table.scheduleKey);
  for (const row of rows) {
    // MySQL hands a binary key back as bytes: keyed by its text.
    if (row.latest !== null) latest.set(String(row.scheduleKey), row.latest);
  }
  return latest;
}

/** A schedule with a window to claim, and the window. */
interface DueSchedule {
  readonly schedule: CollectedSchedule;
  readonly windowAt: Date;
  readonly waitingSince: number;
}

/**
 * The schedules with a window to claim at `now`: never seen, or with a
 * window later than their latest recorded. The longest waiting come first,
 * never-seen ones before all, so a schedule swept goes behind every one
 * still waiting. A pass sweeps the first it has time for; the next pass,
 * reading again, reaches the rest before any it swept, however often passes
 * run.
 */
async function dueSchedules(
  db: ScheduleWindowsDatabase,
  schedules: readonly CollectedSchedule[],
  now: Date
): Promise<DueSchedule[]> {
  const latest = await db.transaction(tx =>
    latestWindowsOf(
      tx,
      db.dialect,
      schedules.map(schedule => schedule.key)
    )
  );
  const due: DueSchedule[] = [];
  for (const schedule of schedules) {
    const windowAt = latestFireAtOrBefore(
      schedule.cron,
      now,
      schedule.timeZone
    );
    const known = latest.get(schedule.key);
    if (windowAt === null || (known !== undefined && windowAt <= known)) {
      continue;
    }
    due.push({
      schedule,
      windowAt,
      waitingSince: known?.getTime() ?? Number.NEGATIVE_INFINITY,
    });
  }
  // Stable: schedules waiting as long keep their declared order.
  return due.sort((a, b) =>
    a.waitingSince === b.waitingSince
      ? 0
      : a.waitingSince < b.waitingSince
        ? -1
        : 1
  );
}

/**
 * Claim `due`'s window, and enqueue its job if this claim is the one. The
 * read that found it due is checked again here, in the claim's transaction:
 * another runner may have claimed since.
 */
async function sweepOne(
  db: ScheduleWindowsDatabase,
  { schedule, windowAt }: DueSchedule,
  now: Date,
  enqueue: Enqueue
): Promise<void> {
  const table = tableOf(db.dialect);
  await db.transaction(async tx => {
    const drizzle = tx.getDrizzle<WindowWriteDb>();
    const atWindow = and(
      eq(table.scheduleKey, schedule.key),
      eq(table.windowAt, windowAt)
    );
    const known = (await latestWindowsOf(tx, db.dialect, [schedule.key])).get(
      schedule.key
    );
    const row = {
      scheduleKey: schedule.key,
      windowAt,
      jobId: null,
      createdAt: now,
    };
    if (known === undefined) {
      // First sight of this schedule, as now defined (its key carries its
      // cron and time zone): the window is recorded with no job, so the
      // first job is for the next.
      await insertIfAbsent(tx, db.dialect, row);
      return;
    }
    // Never a window at or before one already recorded: a clock behind
    // another runner's would reach back for one the others have passed.
    if (windowAt <= known) return;
    const claimed = await insertIfAbsent(tx, db.dialect, row);
    if (!claimed) return;
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
    await drizzle.update(table).set({ jobId: id }).where(atWindow);
  });
}

/**
 * Remove up to `limit` windows from before `before`, oldest first, whichever
 * schedule they belong to, so every old window goes in turn however passes
 * fall. A declared schedule keeps its latest, however old: under "latest
 * window only" an older window can never come due again, but the latest can,
 * for a schedule that fires less often than the retention. A schedule no
 * longer declared keeps nothing: should it come back it is seen for the
 * first time.
 */
async function pruneOldest(
  db: ScheduleWindowsDatabase,
  declared: readonly string[],
  before: Date,
  limit: number
): Promise<number> {
  const table = tableOf(db.dialect);
  return db.transaction(async tx => {
    const latest = await latestWindowsOf(tx, db.dialect, declared);
    // Each declared schedule's latest may be among the oldest, and is
    // skipped: read past them so the bound is still met.
    const oldest = await tx
      .getDrizzle<KeyedReadDb>()
      .select({ scheduleKey: table.scheduleKey, windowAt: table.windowAt })
      .from(table)
      .where(lt(table.windowAt, before))
      .orderBy(asc(table.windowAt))
      .limit(limit + latest.size);
    const doomed = oldest
      .filter(
        row =>
          latest.get(String(row.scheduleKey))?.getTime() !==
          row.windowAt.getTime()
      )
      .slice(0, limit);
    // Each schedule's newest doomed window is its edge: its older windows
    // come earlier in age order, so they are among the doomed too.
    const edges = new Map<string, Date>();
    for (const row of doomed) edges.set(String(row.scheduleKey), row.windowAt);
    if (edges.size === 0) return 0;
    await tx
      .getDrizzle<WindowWriteDb>()
      .delete(table)
      .where(
        or(
          ...[...edges].map(([scheduleKey, edge]) =>
            and(eq(table.scheduleKey, scheduleKey), lte(table.windowAt, edge))
          )
        )
      );
    return doomed.length;
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
    async sweep(now, deadline) {
      let due: DueSchedule[];
      try {
        due = await dueSchedules(db, schedules, now);
      } catch (error) {
        options.onError?.(error, "every schedule");
        return;
      }
      for (const [step, next] of due.entries()) {
        // The pass's time is shared with the drain that follows. One schedule
        // is always swept, so every pass leaves one fewer waiting.
        if (step > 0 && deadline !== undefined && Date.now() >= deadline) {
          return;
        }
        try {
          await sweepOne(db, next, now, enqueue);
        } catch (error) {
          options.onError?.(error, next.schedule.key);
        }
      }
    },
    async prune(before, limit) {
      // One bound for the whole pass, so many schedules cannot make the pass
      // a long delete.
      try {
        return await pruneOldest(
          db,
          schedules.map(schedule => schedule.key),
          before,
          limit
        );
      } catch (error) {
        options.onError?.(error, "every schedule");
        return 0;
      }
    },
  };
}
