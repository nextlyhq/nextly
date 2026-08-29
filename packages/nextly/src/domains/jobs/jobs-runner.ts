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

import { nextly } from "../../direct-api/nextly";
import { listRoleSlugsForUserStrict } from "../../services/lib/permissions";
import type { RunAsDeps, RunAsUser } from "../../shared/lib/resolve-run-as";

import type { JobRegistry } from "./job-registry";
import { JobsRepository, type JobsDatabase } from "./jobs-repository";
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

/**
 * The database surface one pass needs: the jobs table plus the users read the
 * identity resolver performs. Named as the minimal intersection, rather than the
 * concrete adapter type, so a caller resolves it from the DI container as
 * exactly what a pass uses — the same reason `WebhookDrainDatabase` exists.
 */
export type JobsPassDatabase = JobsDatabase & UsersReadDb;

/** How long a finished job row is kept before a pass may remove it. */
export const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * How long finished rows are kept, from the option a deployment passed.
 *
 * Three states, not two: `undefined` is "unset, take the default", `null` is
 * "keep everything, I prune it myself", and a number is a window. Nullish
 * coalescing collapses the first two, which is what turned the documented
 * opt-out back into the default and pruned history a deployment had asked to
 * keep. Named and exported so that distinction is testable rather than one
 * character inside a longer function.
 */
export function resolveRetentionMs(
  option: number | null | undefined
): number | null {
  return option === undefined ? DEFAULT_RETENTION_MS : option;
}
/** Rows a single pass may remove, so a sweep cannot become a long delete. */
export const DEFAULT_PRUNE_LIMIT = 100;

export interface RunJobsPassOptions {
  now?: () => Date;
  runnerId?: string;
  batchSize?: number;
  maxDurationMs?: number;
  leaseMs?: number;
  random?: () => number;
  /** Override the identity reads; the default goes to the database. */
  runAs?: RunAsDeps;
  /**
   * How long a finished row is kept. `null` disables removal entirely, for a
   * deployment that would rather keep the history and prune it itself.
   */
  retentionMs?: number | null;
  /** Rows one pass may remove. */
  pruneLimit?: number;
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
      // Every attribute `RunAsUser` carries, not just the two the lease needs.
      // `resolveRunAs` puts these on the reconstructed context because access
      // predicates here inspect `user.email` — but it can only carry what this
      // lookup returns, so stopping at id/isActive made that handling unable to
      // do anything.
      const user: RunAsUser = { id: row.id, isActive: Boolean(row.isActive) };
      if (typeof row.name === "string") user.name = row.name;
      if (typeof row.email === "string") user.email = row.email;
      return user;
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
export async function runJobsPass(
  adapter: JobsPassDatabase,
  registry: JobRegistry,
  options?: RunJobsPassOptions
): Promise<RunJobsResult> {
  const repository = new JobsRepository(adapter);
  const result = await runJobs({
    store: repository,
    registry,
    runAs: options?.runAs ?? databaseRunAs(adapter),
    now: options?.now,
    runnerId: options?.runnerId,
    batchSize: options?.batchSize,
    maxDurationMs: options?.maxDurationMs,
    leaseMs: options?.leaseMs,
    random: options?.random,
    // The real Direct API, resolved lazily per call so a job queued before the
    // runtime finished booting still binds to a live one.
    contentApi: nextly,
  });

  // Prune AFTER the drain, and never in a way that can fail it. A queue without
  // this grows forever — a recurring workload writes one row per run, and every
  // finished row keeps its input and its error. Bounded per pass so a sweep
  // cannot become a long delete that outlives the tick running it.
  const retentionMs = resolveRetentionMs(options?.retentionMs);
  if (retentionMs !== null) {
    const now = options?.now ?? (() => new Date());
    try {
      await repository.pruneTerminal(
        new Date(now().getTime() - retentionMs),
        options?.pruneLimit ?? DEFAULT_PRUNE_LIMIT
      );
    } catch {
      // Housekeeping is not the work. A failed prune must not turn a pass that
      // ran its jobs into a pass that reports failure.
    }
  }

  return result;
}
