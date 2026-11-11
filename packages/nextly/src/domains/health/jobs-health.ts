/**
 * The background jobs line of System health: how many jobs wait to run, how
 * many are running, and how many failed in the last 24 hours.
 *
 * A job that failed for good is in `failed` (a retried attempt leaves the row
 * `pending`), and its `updatedAt` is when it failed, so "failed in 24 hours"
 * is the `failed` rows touched since then. Terminal rows are pruned on a
 * retention window longer than a day, so the count is whole.
 *
 * One grouped count, selecting only the state and the count: no row, and no
 * job's input or error, leaves the database.
 *
 * @module domains/health/jobs-health
 */

import { and, count, eq, gte, inArray, or } from "drizzle-orm";

import { jobsTables } from "../../schemas/jobs";
import type { JobState } from "../../schemas/jobs/types";

/** The window "failed recently" counts. */
const JOBS_FAILED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The jobs line. */
export interface JobsHealth {
  /** Waiting to run: due now, scheduled, or waiting to retry. */
  queued: number;
  running: number;
  /** Failed for good within {@link JOBS_FAILED_WINDOW_MS}. */
  failed: number;
}

/** The select chain this read makes, in the form all three dialects share. */
interface JobsDb {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (clause: unknown) => {
        groupBy: (column: unknown) => Promise<Record<string, unknown>[]>;
      };
    };
  };
}

/**
 * The jobs line for the database `db` reaches, as of `now`.
 *
 * @param db - The dialect's Drizzle database
 */
export async function readJobsHealth(
  db: unknown,
  dialect: "postgresql" | "mysql" | "sqlite",
  now: Date
): Promise<JobsHealth> {
  const { nextlyJobs: jobs } = jobsTables(dialect);
  const since = new Date(now.getTime() - JOBS_FAILED_WINDOW_MS);
  const open: JobState[] = ["pending", "running"];
  const rows = await (db as JobsDb)
    .select({ state: jobs.state, n: count() })
    .from(jobs)
    .where(
      or(
        inArray(jobs.state, open),
        and(eq(jobs.state, "failed"), gte(jobs.updatedAt, since))
      )
    )
    .groupBy(jobs.state);
  const health: JobsHealth = { queued: 0, running: 0, failed: 0 };
  for (const row of rows) {
    // count() answers a string or a bigint on some drivers.
    const n = Number(row.n);
    if (!Number.isFinite(n)) continue;
    if (row.state === "pending") health.queued = n;
    else if (row.state === "running") health.running = n;
    else if (row.state === "failed") health.failed = n;
  }
  return health;
}
