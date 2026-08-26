/**
 * One drain pass over the job table.
 *
 * Pure orchestration over injected dependencies: it decides, the repository
 * stores, the registry supplies the code. Assembling those is `jobs-runner`'s
 * job, so that both triggers assemble them identically.
 *
 * ## The pass is bounded, deliberately
 *
 * A drain runs behind a serverless cron tick as often as it runs on a long-
 * lived process, and a platform kills a tick at a fixed limit. So the pass
 * returns on its own before that: the rows it did not reach are durable and the
 * next tick continues from them. This is the same shape the webhook drain
 * already uses, and the reason it can be triggered the same three ways.
 *
 * ## The contract is AT-LEAST-ONCE, and saying otherwise would be a lie
 *
 * The lease makes two runners unable to claim one job AT THE SAME INSTANT, and
 * the fence makes a runner that lost its lease unable to record an outcome over
 * its successor's. Neither stops a handler that OUTLIVES its lease: while it is
 * still running, the lease expires, another pass reclaims the row, and the same
 * handler runs again concurrently. The fence then refuses the first runner's
 * write — but it cannot undo anything that runner already did outside the
 * database.
 *
 * So: **handlers must be idempotent**, and `leaseMs` must be sized to the work.
 * This is the same contract SQS, BullMQ and pg-boss give, for the same reason —
 * exactly-once across a process boundary and an external side effect is not
 * something a queue can offer.
 *
 * What IS guaranteed: a job's outcome is recorded once, by whoever holds the
 * lease when it finishes.
 *
 * ## Every outcome is recorded
 *
 * There is no branch here that leaves a claimed row untouched. A row that is
 * passed over silently is passed over on EVERY pass, forever — and a queue that
 * never drains is indistinguishable from an empty one. That is why an
 * unregistered slug is recorded as a failure rather than skipped.
 *
 * @module domains/jobs/run-jobs
 */

import { DEFAULT_MAX_ATTEMPTS, type JobRegistry } from "./job-registry";
import { nextAttempt } from "./job-backoff";
import type { FinalizeInput, JobRow } from "./jobs-repository";
import { resolveRunAs, type RunAsDeps } from "./resolve-run-as";

/** Rows claimed and finalized per pass when the caller does not say. */
export const DEFAULT_BATCH_SIZE = 50;
/**
 * Wall-clock budget for one pass. Under a typical serverless limit with room
 * for the final write to commit.
 */
export const DEFAULT_MAX_DURATION_MS = 25_000;

/** The store surface a pass needs. `JobsRepository` satisfies it. */
export interface JobsStore {
  findDue(input: { now: Date; limit: number }): Promise<JobRow[]>;
  claim(
    id: string,
    runnerId: string,
    now: Date,
    leaseMs: number
  ): Promise<JobRow | null>;
  markAttempt(id: string, attemptCount: number, now: Date): Promise<void>;
  finalize(input: FinalizeInput): Promise<boolean>;
}

export interface RunJobsDeps {
  store: JobsStore;
  registry: JobRegistry;
  runAs: RunAsDeps;
  now?: () => Date;
  runnerId?: string;
  batchSize?: number;
  maxDurationMs?: number;
  leaseMs?: number;
  random?: () => number;
}

export interface RunJobsResult {
  claimed: number;
  done: number;
  failed: number;
  retried: number;
  /**
   * Attempts whose outcome was NOT recorded because the lease had been handed
   * to another runner before the write. Counted rather than ignored: a pass
   * reporting work it did not actually record would overstate what happened.
   */
  unrecorded: number;
}

export async function runJobs(deps: RunJobsDeps): Promise<RunJobsResult> {
  const now = deps.now ?? (() => new Date());
  const runnerId = deps.runnerId ?? crypto.randomUUID();
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxDurationMs = deps.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const leaseMs = deps.leaseMs ?? 30_000;

  const startedAt = now().getTime();
  const result: RunJobsResult = {
    claimed: 0,
    done: 0,
    failed: 0,
    retried: 0,
    unrecorded: 0,
  };

  const due = await deps.store.findDue({ now: now(), limit: batchSize });

  for (const candidate of due) {
    // Checked before the claim, not after: claiming a row and then abandoning
    // it would leave a lease held by a runner that has already returned, and
    // the row would wait out the lease for no reason.
    if (now().getTime() - startedAt >= maxDurationMs) break;

    const job = await deps.store.claim(candidate.id, runnerId, now(), leaseMs);
    // Another runner won it, it stopped being due, or it vanished. Not ours,
    // and not an error.
    if (job === null) continue;
    result.claimed += 1;

    const outcome = await runOne(deps, job, runnerId, now);
    const wrote = await deps.store.finalize(outcome);
    // Counted only once the write LANDED. Counting when the decision was made
    // would report an attempt as both done and unrecorded when the fence
    // refuses it, which overstates completed work to whatever reads this.
    if (!wrote) {
      result.unrecorded += 1;
      continue;
    }
    if (outcome.outcome === "done") result.done += 1;
    else if (outcome.outcome === "failed") result.failed += 1;
    else result.retried += 1;
  }

  return result;
}

/**
 * Establish identity, run the handler, and decide what to record.
 *
 * Returns the finalize input rather than writing it, so the single write site
 * above can also observe whether the fence let it through.
 */
async function runOne(
  deps: RunJobsDeps,
  job: JobRow,
  runnerId: string,
  now: () => Date
): Promise<FinalizeInput> {
  const terminal = (lastError: string): FinalizeInput => {
    return {
      id: job.id,
      runnerId,
      outcome: "failed",
      nextAttemptAt: null,
      lastError,
      now: now(),
    };
  };

  const definition = deps.registry.get(job.slug);
  const attempt = job.attemptCount + 1;
  await deps.store.markAttempt(job.id, attempt, now());

  // The identity READS can fail — a transient RBAC database error, say — and
  // that is a different thing from the identity being gone. Letting it throw
  // would abort the whole pass after this row was claimed: the row keeps its
  // lease until expiry, later candidates are never reached, and a persistent
  // lookup failure on an early row aborts every scheduled drain instead of
  // exhausting one job's retry budget.
  let identity: Awaited<ReturnType<typeof resolveRunAs>>;
  try {
    identity = await resolveRunAs(deps.runAs, job.runAsUserId);
  } catch (error) {
    return decide(
      job,
      attempt,
      definition?.retry.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      error instanceof Error ? error.message : String(error),
      runnerId,
      now,
      deps.random
    );
  }
  // Terminal, not retried: a deleted or deactivated user does not come back on
  // the next pass, and retrying would cycle an unrunnable row forever.
  if (!identity.ok) return terminal(identity.reason);

  if (definition === undefined) {
    // NOT terminal on its own. A deploy that has not finished rolling out can
    // leave one instance without a type another instance queued, and that
    // recovers by itself. A type genuinely deleted while rows were queued
    // instead exhausts its budget and gives up saying which slug is missing —
    // either way the row is never silently passed over.
    return decide(
      job,
      attempt,
      // Derived from the registry's own default rather than restated, so
      // changing that default cannot leave orphan rows on a different budget
      // from registered jobs.
      DEFAULT_MAX_ATTEMPTS,
      `No job type is registered for "${job.slug}".`,
      runnerId,
      now,
      deps.random
    );
  }

  try {
    await definition.handler(job.input as never, {
      user: identity.user,
      now: now(),
    });
  } catch (error) {
    return decide(
      job,
      attempt,
      definition.retry.maxAttempts,
      error instanceof Error ? error.message : String(error),
      runnerId,
      now,
      deps.random
    );
  }

  return {
    id: job.id,
    runnerId,
    outcome: "done",
    nextAttemptAt: null,
    lastError: null,
    now: now(),
  };
}

/** Retry or give up, per the backoff policy. */
function decide(
  job: JobRow,
  attempt: number,
  maxAttempts: number,
  lastError: string,
  runnerId: string,
  now: () => Date,
  random: (() => number) | undefined
): FinalizeInput {
  const decision = nextAttempt({
    attemptCount: attempt,
    maxAttempts,
    now: now(),
    random,
  });

  if (decision.outcome === "failed") {
    return {
      id: job.id,
      runnerId,
      outcome: "failed",
      nextAttemptAt: null,
      lastError,
      now: now(),
    };
  }

  return {
    id: job.id,
    runnerId,
    outcome: "retry",
    nextAttemptAt: decision.at,
    lastError,
    now: now(),
  };
}
