/**
 * Job state vocabulary.
 *
 * @module schemas/jobs/types
 */

/**
 * The states a job row can hold.
 *
 * A failed ATTEMPT is not a failed JOB: an attempt that may be retried leaves
 * the row `pending` with `attempt_count` incremented and `next_attempt_at`
 * set by the backoff. Only exhausting the retry budget — or a failure declared
 * terminal, of which an unresolvable `run_as_user_id` is the first — moves a
 * row to `failed`. `failed` is therefore an end state no trigger picks up
 * again, and `last_error` records why.
 *
 * Without that distinction "non-retryable" would have no representation in the
 * table, and a job whose identity is gone would retry forever.
 */
export const JOB_STATES = ["pending", "running", "done", "failed"] as const;

export type JobState = (typeof JOB_STATES)[number];
