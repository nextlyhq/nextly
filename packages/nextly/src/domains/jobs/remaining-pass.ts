/**
 * How much of the current pass a handler has left.
 *
 * Asked by every handler that walks an unbounded set — every due release, every
 * undelivered webhook — because `JobContext.deadline` states when the pass
 * intends to stop but not how far away that is. Stated once here rather than in
 * each drain: the two built-in drains previously computed it separately, and a
 * change to runner deadline semantics would have silently made them enforce
 * different pass boundaries.
 *
 * ## Both fields, never the wall clock
 *
 * `runJobs` resolves ONE clock — `deps.now ?? (() => new Date())` — and derives
 * both values from it: `deadline` from the pass's start instant, and each
 * handler's `context.now` from a fresh call as its job begins. The two are
 * therefore always on the same timebase, whatever clock the runner was handed.
 *
 * Anchoring to `Date.now()` instead subtracts two different ORIGINS whenever a
 * caller supplies the documented `now` option. A clock behind wall time collapses
 * the result to zero and the handler starts nothing on every pass; one ahead
 * grants a budget wider than the pass and the handler overruns the invocation it
 * was bounded to fit. Both fields come from the runner, so both are used.
 *
 * The result is a DURATION, which is why it survives being applied to a handler's
 * own clock: only the origins differ between the runner's timebase and wall time,
 * and a span is the same length in both.
 *
 * @module domains/jobs/remaining-pass
 */

import type { JobContext } from "./job-registry";

/**
 * Milliseconds left in the pass running this handler.
 *
 * Never negative. A pass at or past its deadline yields zero, which a bounded
 * handler reads as "start nothing more" — and which is different from not
 * knowing, so callers do not have to treat an exhausted budget as unbounded.
 */
export function remainingPassMs(
  context: Pick<JobContext, "now" | "deadline">
): number {
  return Math.max(0, context.deadline.getTime() - context.now.getTime());
}
