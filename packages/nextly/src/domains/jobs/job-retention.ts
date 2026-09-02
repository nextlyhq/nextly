/**
 * How long a finished job row is kept, as a leaf.
 *
 * Split out of `jobs-runner` for one reason: the runner imports the Direct API,
 * so anything re-exporting this constant from there hands that whole graph to
 * every client that only wanted a number. The admin's monitor has to state the
 * retention policy — an absent job may have run and been pruned, and a reader
 * who does not know that concludes it never ran — and it must not pay for the
 * queue's runtime to say so.
 *
 * @module domains/jobs/job-retention
 */

/** How long a finished job row is kept before a pass may remove it. */
export const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * The retention a pass will apply, given what the caller asked for.
 *
 * `undefined` means "unspecified", which takes the default. `null` is a
 * DECISION — keep everything — and must survive as itself: collapsing it into
 * the default would turn an explicit opt-out into pruned history a deployment
 * had asked to keep. Named and exported so that distinction is testable rather
 * than one character inside a longer function.
 */
export function resolveRetentionMs(
  option: number | null | undefined
): number | null {
  return option === undefined ? DEFAULT_RETENTION_MS : option;
}
