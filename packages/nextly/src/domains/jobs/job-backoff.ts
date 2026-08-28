/**
 * How long to wait before running a failed job again, and when to stop.
 *
 * Pure: it takes the attempt count and the clock and returns a decision. The
 * runner applies it. Keeping it separate is what makes "does a job give up?"
 * answerable without a database.
 *
 * ## Why the delay is jittered rather than a plain doubling
 *
 * When one downstream dependency fails, everything queued against it fails in
 * the SAME pass. A plain exponential schedules every one of those retries for
 * the same instant, so the recovering dependency is hit by the entire backlog
 * at once — and, because they all fail together again, at every subsequent
 * step too. Webhook delivery is this runner's first consumer, so a receiver
 * going down and taking hundreds of deliveries with it is the ordinary case.
 *
 * Equal jitter — half the computed delay, plus a random amount up to the other
 * half — spreads the herd while keeping a meaningful floor. Full jitter
 * (random across the entire window) spreads better but can retry almost
 * immediately, which for a receiver that is still down means spending the
 * retry budget during the outage.
 *
 * `random` is injected rather than calling `Math.random()` directly so the
 * schedule is observable in a test. A jitter that cannot be pinned is a jitter
 * nobody can prove is applied.
 *
 * @module domains/jobs/job-backoff
 */

/** The delay before the first retry, and the base the doubling starts from. */
export const BACKOFF_BASE_MS = 1_000;

/**
 * The longest a retry is ever deferred.
 *
 * Without a cap the doubling passes any date the system can act on — 2^40
 * milliseconds is longer than the universe has been running — and a job
 * scheduled past that point is indistinguishable from one that was dropped.
 */
export const BACKOFF_CAP_MS = 60 * 60 * 1_000;

export type NextAttempt =
  | { outcome: "retry"; at: Date }
  | { outcome: "failed" };

export interface NextAttemptInput {
  /** Attempts already made, INCLUDING the one that just failed. */
  attemptCount: number;
  maxAttempts: number;
  now: Date;
  /** Returns [0, 1]. Injected for determinism in tests. */
  random?: () => number;
}

/**
 * Whether to run this job again, and when.
 *
 * `attemptCount` counts the attempt that just failed, so a job whose budget is
 * three attempts gives up when the third one fails — not after a fourth.
 */
export function nextAttempt(input: NextAttemptInput): NextAttempt {
  if (input.attemptCount >= input.maxAttempts) return { outcome: "failed" };

  const random = input.random ?? Math.random;
  const exponential = BACKOFF_BASE_MS * 2 ** (input.attemptCount - 1);
  const capped = Math.min(exponential, BACKOFF_CAP_MS);

  // Equal jitter: half the window is guaranteed, the rest is spread.
  const half = capped / 2;
  const delay = half + random() * half;

  // Round UP so the delay can never floor to zero and make the job instantly
  // due again, which would spin the runner instead of deferring it.
  return {
    outcome: "retry",
    at: new Date(input.now.getTime() + Math.ceil(delay)),
  };
}
