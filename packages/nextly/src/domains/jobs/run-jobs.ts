/**
 * One drain pass over the job table.
 *
 * Pure orchestration over injected dependencies: it decides, the repository
 * stores, the registry supplies the code. Assembling those is `jobs-runner`'s
 * job, so that both triggers assemble them identically.
 *
 * ## What the wall-clock budget bounds, and what it does not
 *
 * `maxDurationMs` is checked before each CLAIM, so it bounds how many jobs a
 * pass starts. It cannot bound how long one already-running handler takes:
 * nothing here can interrupt a promise mid-flight, and a cancellation that the
 * handler does not cooperate with would abandon whatever it had half-done
 * outside the database — worse than being late.
 *
 * So a single handler CAN overrun the budget. Two things bound that instead:
 * `leaseMs`, which the handler's runner renews only while it is alive, and the
 * handler itself being written to fit a tick. Saying the budget bounds the pass
 * would be the more comfortable claim and the false one.
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
 * The lease is now RENEWED while a handler runs, so it tracks the work rather
 * than predicting it, and the ordinary long-handler case no longer expires.
 * That narrows the window; it does not close it. A process that stalls, is
 * paused, or loses its connection stops renewing while its side effects may
 * still be in flight.
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

import { nextAttempt } from "./job-backoff";
import { createJobContentApi } from "./job-content-api";
import { DEFAULT_MAX_ATTEMPTS, type JobRegistry } from "./job-registry";
import type { FinalizeInput, FinalizeOutcome, JobRow } from "./jobs-repository";
import { resolveRunAs, type RunAsDeps } from "../../shared/lib/resolve-run-as";

/** Rows claimed and finalized per pass when the caller does not say. */
export const DEFAULT_BATCH_SIZE = 50;
/**
 * Wall-clock budget for one pass. Under a typical serverless limit with room
 * for the final write to commit.
 */
export const DEFAULT_MAX_DURATION_MS = 25_000;
/** How long a claim is held before another runner may take the job over. */
export const DEFAULT_LEASE_MS = 30_000;

/** The store surface a pass needs. `JobsRepository` satisfies it. */
export interface JobsStore {
  findDue(input: { now: Date; limit: number }): Promise<JobRow[]>;
  claim(
    id: string,
    runnerId: string,
    now: Date,
    leaseMs: number
  ): Promise<JobRow | null>;
  /** `false` means the lease was lost; the caller must not run the handler. */
  markAttempt(
    id: string,
    runnerId: string,
    attemptCount: number,
    now: Date
  ): Promise<boolean>;
  finalize(input: FinalizeInput): Promise<boolean>;
  renewLease(
    id: string,
    runnerId: string,
    now: Date,
    leaseMs: number
  ): Promise<boolean>;
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
  /**
   * How often to extend the lease while a handler runs. Defaults to a third of
   * the lease, so two renewals may be missed before it lapses.
   */
  renewIntervalMs?: number;
  /**
   * The Direct API the bound content client wraps.
   *
   * Injected rather than imported so a pass can be driven without booting a
   * runtime; `runJobsPass` supplies the real one.
   */
  contentApi: Parameters<typeof createJobContentApi>[1];
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

/**
 * `runOne`'s answer when the lease was lost before the handler ran.
 *
 * Distinct from any outcome, because there is nothing to record: the row
 * belongs to another runner and writing to it is exactly what the fence exists
 * to refuse.
 */
const LEASE_LOST = Symbol("lease-lost");

export async function runJobs(deps: RunJobsDeps): Promise<RunJobsResult> {
  const now = deps.now ?? (() => new Date());
  const runnerId = deps.runnerId ?? crypto.randomUUID();
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxDurationMs = deps.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;

  const startedAt = now().getTime();
  // The whole pass shares ONE deadline, rather than each job receiving a fresh
  // budget when it starts. A per-job budget would be a promise the runner cannot
  // keep: the invocation dies at this instant whatever a later job was told, so
  // a job starting late genuinely has little time, and saying otherwise is how a
  // handler gets killed mid-write believing it had room.
  const deadline = new Date(startedAt + maxDurationMs);
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

    const outcome = await runOne(deps, job, runnerId, now, deadline);
    if (outcome === LEASE_LOST) {
      result.unrecorded += 1;
      continue;
    }
    countOutcome(result, outcome.outcome, await deps.store.finalize(outcome));
  }

  return result;
}

/**
 * Record what one attempt did — but only once its write actually landed.
 *
 * Counting when the decision was MADE would report an attempt as both done and
 * unrecorded whenever the fence refuses it, overstating completed work to
 * whatever reads the result.
 */
function countOutcome(
  result: RunJobsResult,
  outcome: FinalizeOutcome,
  wrote: boolean
): void {
  if (!wrote) {
    result.unrecorded += 1;
    return;
  }
  if (outcome === "done") result.done += 1;
  else if (outcome === "failed") result.failed += 1;
  else result.retried += 1;
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
  /** The pass's wall-clock deadline, handed to the handler on its context. */
  deadline: Date
): Promise<FinalizeInput | typeof LEASE_LOST> {
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
  if (definition === undefined) {
    return deferUnregistered(job, runnerId, now, deps.random);
  }

  const attempt = job.attemptCount + 1;
  /**
   * Record this attempt as failed, and let the backoff policy decide whether
   * another one follows.
   *
   * Every failure below reaches the same decision with the same arguments, and
   * stating it once is what keeps the three of them from drifting into three
   * slightly different answers to "what happens when this job errors".
   */
  const failed = (error: unknown): FinalizeInput =>
    decide(
      job,
      attempt,
      definition.retry.maxAttempts,
      error instanceof Error ? error.message : String(error),
      runnerId,
      now,
      deps.random
    );

  const stillOurs = await deps.store.markAttempt(
    job.id,
    runnerId,
    attempt,
    now()
  );
  // The lease went to a successor between the claim and this write. Running the
  // handler now would do the work twice, and the fence would refuse to record
  // it either way — so stop, and leave the row to whoever holds it.
  if (!stillOurs) return LEASE_LOST;

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
    return failed(error);
  }
  // Terminal, not retried: a deleted or deactivated user does not come back on
  // the next pass, and retrying would cycle an unrunnable row forever.
  if (!identity.ok) return terminal(identity.reason);

  // Re-prove ownership before starting the handler. `markAttempt` fenced the
  // row, but resolving the identity above is two database reads, and a lease
  // that expires while they are in flight lets a successor claim the row. This
  // runner would then wake up and start the handler anyway, because renewal
  // does not begin until `withLeaseRenewal` — so the fence it passed describes
  // a lease it no longer holds. `renewLease` is fenced on `lockedBy`, so one
  // write both extends the lease and answers whether it is still ours.
  let stillOursAfterIdentity: boolean;
  try {
    stillOursAfterIdentity = await deps.store.renewLease(
      job.id,
      runnerId,
      now(),
      deps.leaseMs ?? DEFAULT_LEASE_MS
    );
  } catch (error) {
    // A transient adapter error on the fence is not a verdict about ownership,
    // and it must not escape: this sits between the two failure boundaries, so
    // a rejection here would abort `runJobs` outright — leaving this row leased
    // and skipping every later candidate in the batch. One unlucky write would
    // stop the whole drain. Charged as an ordinary attempt instead, so the job
    // retries on its own backoff.
    return failed(error);
  }
  if (!stillOursAfterIdentity) return LEASE_LOST;

  try {
    // Renew while the handler works. The lease is otherwise a wall-clock guess
    // about how long the work takes, and a handler that outruns it is reclaimed
    // and run a second time CONCURRENTLY — the fence refuses the stale runner's
    // write but cannot undo what it already did outside the database. Renewal
    // makes the lease track the work instead of predicting it.
    await withLeaseRenewal(deps, job, runnerId, now, () =>
      definition.handler(job.input as never, {
        user: identity.user,
        now: now(),
        content: createJobContentApi(identity.user, deps.contentApi),
        deadline,
      })
    );
  } catch (error) {
    return failed(error);
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

/**
 * A job whose type this instance does not know, deferred without charging an
 * attempt.
 *
 * During a rolling deployment an instance that has not been replaced yet does
 * not know a slug the new instances already enqueue. Charging that to the job's
 * retry budget lets the old workers exhaust it before a new one gets a turn —
 * the job then fails permanently for a reason that had already fixed itself.
 *
 * The row is still never silently skipped: the reason is recorded, so a type
 * genuinely deleted while rows were queued shows up in the admin instead of
 * cycling invisibly. It simply keeps its budget for a runner that can run it.
 */
function deferUnregistered(
  job: JobRow,
  runnerId: string,
  now: () => Date,
  random: (() => number) | undefined
): FinalizeInput {
  const deferred = nextAttempt({
    attemptCount: 1,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    now: now(),
    random,
  });
  return {
    id: job.id,
    runnerId,
    outcome: "retry",
    nextAttemptAt: deferred.outcome === "retry" ? deferred.at : null,
    lastError: `No job type is registered for "${job.slug}".`,
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

/**
 * Run `work`, extending the lease at an interval until it settles.
 *
 * Renewal stops as soon as the store reports the lease is no longer this
 * runner's: continuing would be issuing writes that can never apply, and the
 * job has already been taken over.
 *
 * The interval is always cleared, including when `work` throws — a timer left
 * running would hold the process open and keep renewing a lease for a handler
 * that is no longer executing.
 */
async function withLeaseRenewal<T>(
  deps: RunJobsDeps,
  job: JobRow,
  runnerId: string,
  now: () => Date,
  work: () => Promise<T>
): Promise<T> {
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const every = deps.renewIntervalMs ?? Math.floor(leaseMs / 3);
  // A non-positive interval would schedule a timer that fires continuously.
  if (every <= 0) return work();

  const timer = setInterval(() => {
    void deps.store
      .renewLease(job.id, runnerId, now(), leaseMs)
      .then(held => {
        if (!held) clearInterval(timer);
      })
      .catch(() => {
        // Renewal is best-effort: a failed extension is not a reason to fail
        // the job, and the lease simply lapses as it would have anyway.
      });
  }, every);
  // Never keep the process alive for a renewal timer.
  timer.unref?.();

  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}
