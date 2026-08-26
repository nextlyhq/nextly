/**
 * Assembling a drain pass — the ONE place both triggers build it.
 *
 * The cron/manual route and the post-response fast path call this rather than
 * each constructing their own dependencies, so they cannot drift in how the
 * engine is wired. `domains/webhooks/drain-runner` exists for exactly this
 * reason and states it plainly; the same reasoning applies here, and two
 * triggers that assemble a runner differently are two runners.
 *
 * @module domains/jobs/jobs-runner
 */

import { listRoleSlugsForUserStrict } from "../../services/lib/permissions";

import type { JobRegistry } from "./job-registry";
import { JobsRepository, type JobsDatabase } from "./jobs-repository";
import type { RunAsDeps, RunAsUser } from "./resolve-run-as";
import { runJobs, type RunJobsResult } from "./run-jobs";

/**
 * The users read the identity resolver needs.
 *
 * Non-generic on purpose: the adapter's `select<T>` is assignable to this, and
 * a generic port would force every fake to be generic too, which is friction
 * with no benefit — this reads exactly one shape.
 */
interface UsersReadDb {
  select(
    table: string,
    options?: { where?: unknown; limit?: number }
  ): Promise<Array<Record<string, unknown>>>;
}

/**
 * The executor a role lookup should run on, when the handle exposes one.
 *
 * `undefined` lets the lookup fall back to the global executor, which is
 * correct for the single-instance case and is what a plain adapter gives.
 */
function executorOf(db: UsersReadDb): unknown {
  const candidate = db as { getDrizzle?: () => unknown };
  return typeof candidate.getDrizzle === "function"
    ? candidate.getDrizzle()
    : undefined;
}

export interface RunJobsPassOptions {
  now?: () => Date;
  runnerId?: string;
  batchSize?: number;
  maxDurationMs?: number;
  leaseMs?: number;
  random?: () => number;
  /** Override the identity reads; the default goes to the database. */
  runAs?: RunAsDeps;
}

/**
 * The identity reads, backed by the database.
 *
 * Uses `listRoleSlugsForUserStrict` rather than `listRoleSlugsForUser`. The
 * non-strict one CATCHES its errors and returns an empty array, which here
 * would be the worst possible failure: a job would run with no roles, every
 * role-gated collection would match nothing, and the job would report itself
 * complete having done nothing. Letting the error propagate turns that into an
 * ordinary retryable failure instead — a job that did not run, rather than one
 * that silently did nothing and claimed success.
 */
export function databaseRunAs(
  db: UsersReadDb,
  // Injected so the propagation guarantee above is TESTABLE. A guarantee whose
  // only guard is a comment is a guarantee nobody can prove still holds.
  listRoleSlugs: (id: string) => Promise<string[]> = id =>
    // Bound to the SAME handle `findUser` reads from. `listRoleSlugsForUserStrict`
    // otherwise queries through the process-global executor, so with more than
    // one Nextly instance a context could pair a user from one database with
    // roles from another — and run the handler with an authority that exists in
    // neither.
    listRoleSlugsForUserStrict(id, executorOf(db))
): RunAsDeps {
  return {
    async findUser(id: string): Promise<RunAsUser | null> {
      const rows = await db.select("users", {
        where: { and: [{ column: "id", op: "=", value: id }] },
        limit: 1,
      });
      const row = rows[0];
      if (row === undefined) return null;
      // The row is read back as an open record, so the id is narrowed rather
      // than assumed: a users table that answered without one would otherwise
      // produce a context whose id is `undefined`, and an access rule matching
      // on it would compare against nothing.
      if (typeof row.id !== "string") return null;
      // SQLite stores a boolean as 0/1, so compare by truthiness rather than
      // identity — `row.isActive === true` is false for an active SQLite user.
      return { id: row.id, isActive: Boolean(row.isActive) };
    },
    listRoleSlugs,
  };
}

/**
 * Run one drain pass, assembling the engine from the adapter and the registry.
 *
 * Returns once nothing further is immediately actionable or the wall-clock
 * budget is spent; jobs scheduled for a future retry are left for a later pass.
 */
export function runJobsPass(
  adapter: JobsDatabase & UsersReadDb,
  registry: JobRegistry,
  options?: RunJobsPassOptions
): Promise<RunJobsResult> {
  return runJobs({
    store: new JobsRepository(adapter),
    registry,
    runAs: options?.runAs ?? databaseRunAs(adapter),
    now: options?.now,
    runnerId: options?.runnerId,
    batchSize: options?.batchSize,
    maxDurationMs: options?.maxDurationMs,
    leaseMs: options?.leaseMs,
    random: options?.random,
  });
}
