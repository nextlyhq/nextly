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
import { NextlyError } from "../../errors";
import { listRoleSlugsForUserStrict } from "../../services/lib/permissions";
import type { RunAsDeps, RunAsUser } from "../../shared/lib/resolve-run-as";

import type { JobRegistry } from "./job-registry";
import { DEFAULT_RETENTION_MS, resolveRetentionMs } from "./job-retention";
import { JobsRepository, type JobsDatabase } from "./jobs-repository";
import { SWEEP_KEY_PREFIX } from "./portable-key";
import { runJobs, type JobsStore, type RunJobsResult } from "./run-jobs";

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
  /** Told when a sweep could not be queued; the pass proceeds regardless. */
  onSweepError?: (error: unknown, slug: string) => void;
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
/**
 * The dedupe key that keeps exactly one of a sweep outstanding.
 *
 * Stable, so a second trigger firing while the first sweep is still queued or
 * running is refused as a duplicate rather than queueing a second copy. It stops
 * being a duplicate the moment the row goes terminal: `finalize` clears
 * `dedupe_key` for precisely this reason, so the next trigger queues a fresh
 * sweep instead of finding the key held forever by a job that has been and gone.
 */
export function sweepDedupeKey(slug: string): string {
  return `${SWEEP_KEY_PREFIX}${slug}`;
}

/**
 * Make sure every sweep this installation registered has a row waiting.
 *
 * Without this, a registered sweep is a handler nobody enqueues. `releases:drain`
 * is the case that proves it: a release comes due at an instant with no request
 * attached, so no code path is ever in a position to queue the work, and the
 * queue stays empty while looking exactly like a queue with nothing to do.
 *
 * Failures here do not fail the pass. The jobs already in the table are real
 * work, and refusing to run them because a housekeeping insert failed would turn
 * a recoverable hiccup into a stalled queue.
 */
async function queueSweeps(
  repository: JobsRepository,
  registry: JobRegistry,
  now: Date,
  logger?: (error: unknown, slug: string) => void
): Promise<void> {
  for (const definition of registry.sweeps()) {
    try {
      await queueSweep(repository, definition.slug, now);
    } catch (error) {
      logger?.(error, definition.slug);
    }
  }
}

/**
 * Queue one sweep, or find the one already outstanding: its dedupe key keeps
 * exactly one queued or running, so either way the answer is that row.
 */
function queueSweep(
  repository: JobsRepository,
  slug: string,
  now: Date
): Promise<{ id: string }> {
  return repository.enqueue({
    slug,
    input: null,
    // Due immediately: the trigger firing IS the schedule. A future `runAt`
    // would make the sweep wait for a tick after the one that queued it.
    runAt: null,
    // No principal. A sweep acts as nobody and resolves each item's own
    // identity when it performs it; a user here would be an authority the
    // sweep could lend to work that never asked for it.
    runAsUserId: null,
    dedupeKey: sweepDedupeKey(slug),
    now,
  });
}

/**
 * The parts of a pass both triggers share: the store, the identity reads and
 * the Direct API a job's bound client wraps. One assembly, so a job run on
 * demand runs exactly as it would in a pass.
 */
function passDeps(
  adapter: JobsPassDatabase,
  registry: JobRegistry,
  store: JobsStore,
  options: RunJobsPassOptions | undefined
): Parameters<typeof runJobs>[0] {
  return {
    store,
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
  };
}

/**
 * Run one queued job now, if no runner holds it.
 *
 * Through `runJobs` itself, with its candidates narrowed to this one row, so
 * the claim, the lease and its renewal, the identity the job runs as and the
 * recorded outcome are exactly a pass's: running now is another trigger, not a
 * second runner. A job another runner holds, or one that is not pending and
 * due, is not claimed, and the answer's `claimed` is 0. Bounded by
 * `maxDurationMs` the way a pass is, and the handler receives that deadline.
 */
export function runJobNow(
  adapter: JobsPassDatabase,
  registry: JobRegistry,
  jobId: string,
  options?: RunJobsPassOptions
): Promise<RunJobsResult> {
  const repository = new JobsRepository(adapter);
  const store: JobsStore = {
    findDue: input => repository.findDue({ ...input, ids: [jobId] }),
    claim: (id, runnerId, now, leaseMs) =>
      repository.claim(id, runnerId, now, leaseMs),
    markAttempt: (id, runnerId, attemptCount, now) =>
      repository.markAttempt(id, runnerId, attemptCount, now),
    finalize: input => repository.finalize(input),
    renewLease: (id, runnerId, now, leaseMs) =>
      repository.renewLease(id, runnerId, now, leaseMs),
  };
  return runJobs(passDeps(adapter, registry, store, options));
}

/**
 * Run a sweep now, if no runner holds it.
 *
 * Queues the sweep's one outstanding row the way a pass does (or finds it),
 * then runs it through {@link runJobNow}. When another runner is already
 * running it, `claimed` is 0 and nothing ran here; that runner, or the next
 * pass, does the work.
 */
export async function runSweepNow(
  adapter: JobsPassDatabase,
  registry: JobRegistry,
  slug: string,
  options?: RunJobsPassOptions
): Promise<RunJobsResult> {
  if (!registry.sweeps().some(definition => definition.slug === slug)) {
    throw NextlyError.internal({
      logContext: { reason: "not-a-registered-sweep", slug },
    });
  }
  const now = (options?.now ?? (() => new Date()))();
  const { id } = await queueSweep(new JobsRepository(adapter), slug, now);
  return runJobNow(adapter, registry, id, options);
}

export async function runJobsPass(
  adapter: JobsPassDatabase,
  registry: JobRegistry,
  options?: RunJobsPassOptions
): Promise<RunJobsResult> {
  const repository = new JobsRepository(adapter);

  // BEFORE the drain, so the pass that queues a sweep is also the pass that
  // runs it. Queueing afterwards would leave every sweep waiting for the NEXT
  // trigger, doubling the latency of everything that depends on one.
  await queueSweeps(
    repository,
    registry,
    (options?.now ?? (() => new Date()))(),
    options?.onSweepError
  );

  const result = await runJobs(
    passDeps(adapter, registry, repository, options)
  );

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

/**
 * Re-exported so existing importers keep one name for them. Declared in
 * `./job-retention`, a leaf, because this module imports the Direct API and a
 * client wanting the number must not pay for that.
 */
export { DEFAULT_RETENTION_MS, resolveRetentionMs };
