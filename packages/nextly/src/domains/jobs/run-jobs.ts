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
 * ## Every outcome is recorded
 *
 * There is no branch here that leaves a claimed row untouched. A row that is
 * passed over silently is passed over on EVERY pass, forever — and a queue that
 * never drains is indistinguishable from an empty one. That is why an
 * unregistered slug is recorded as a failure rather than skipped.
 *
 * @module domains/jobs/run-jobs
 */

import type { JobRegistry } from "./job-registry";
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

    const outcome = await runOne(deps, job, runnerId, now, result);
    const wrote = await deps.store.finalize(outcome);
    if (!wrote) result.unrecorded += 1;
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
  now: () => Date,
  result: RunJobsResult
): Promise<FinalizeInput> {
  const terminal = (lastError: string): FinalizeInput => {
    result.failed += 1;
    return {
      id: job.id,
      runnerId,
      outcome: "failed",
      nextAttemptAt: null,
      lastError,
      now: now(),
    };
  };

  const identity = await resolveRunAs(deps.runAs, job.runAsUserId);
  // Terminal, not retried: a deleted or deactivated user does not come back on
  // the next pass, and retrying would cycle an unrunnable row forever.
  if (!identity.ok) return terminal(identity.reason);

  const definition = deps.registry.get(job.slug);
  const attempt = job.attemptCount + 1;
  await deps.store.markAttempt(job.id, attempt, now());

  if (definition === undefined) {
    // NOT terminal on its own. A deploy that has not finished rolling out can
    // leave one instance without a type another instance queued, and that
    // recovers by itself. A type genuinely deleted while rows were queued
    // instead exhausts its budget and gives up saying which slug is missing —
    // either way the row is never silently passed over.
    return decide(
      job,
      attempt,
      // The registry's own default budget governs, since the definition that
      // would have carried one is exactly what is missing.
      5,
      `No job type is registered for "${job.slug}".`,
      runnerId,
      now,
      deps.random,
      result
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
      deps.random,
      result
    );
  }

  result.done += 1;
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
  random: (() => number) | undefined,
  result: RunJobsResult
): FinalizeInput {
  const decision = nextAttempt({
    attemptCount: attempt,
    maxAttempts,
    now: now(),
    random,
  });

  if (decision.outcome === "failed") {
    result.failed += 1;
    return {
      id: job.id,
      runnerId,
      outcome: "failed",
      nextAttemptAt: null,
      lastError,
      now: now(),
    };
  }

  result.retried += 1;
  return {
    id: job.id,
    runnerId,
    outcome: "retry",
    nextAttemptAt: decision.at,
    lastError,
    now: now(),
  };
}
