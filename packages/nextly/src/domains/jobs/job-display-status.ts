/**
 * What a job's row MEANS to a person watching the queue.
 *
 * The stored vocabulary is `pending | running | done | failed`, and it does not
 * answer the question an operator actually asks. A job that failed an attempt
 * and will try again is written back as `pending` with a later
 * `nextAttemptAt` — indistinguishable, by state alone, from one that has never
 * run. Those two need different reactions: the first is the system healing
 * itself and wants no-one, the second is simply waiting.
 *
 * The dangerous pair is the other one. `failed` is TERMINAL — the attempts are
 * spent and the work will not happen unless a person acts — while a retrying
 * job looks like a failure in the log and is not one. Presenting them alike is
 * the documented common mistake in queue tooling: it either raises an alarm for
 * something self-healing, or buries a dead job among transient noise.
 *
 * Derived rather than stored, and derived in ONE place, because the answer is a
 * function of columns the database already has. A second derivation in the
 * admin would agree on the day it was written.
 *
 * @module domains/jobs/job-display-status
 */

/** What a job row is doing, in the terms an operator reasons about. */
export type JobDisplayStatus =
  /** Queued, never attempted. */
  | "waiting"
  /** An attempt failed; another is scheduled. Self-healing, not an alarm. */
  | "retrying"
  /** A runner holds the lease right now. */
  | "running"
  /** Finished successfully. */
  | "succeeded"
  /** Attempts are spent. This will not happen without a person. */
  | "failed";

/** The columns the derivation reads, and nothing more. */
export interface JobStatusInput {
  state: "pending" | "running" | "done" | "failed";
  attemptCount: number;
}

/**
 * `attemptCount` is what separates waiting from retrying, because the state
 * column cannot: `finalize` writes `pending` for a retry, so the count is the
 * only surviving evidence that an attempt already happened.
 */
export function jobDisplayStatus(row: JobStatusInput): JobDisplayStatus {
  if (row.state === "running") return "running";
  if (row.state === "done") return "succeeded";
  if (row.state === "failed") return "failed";
  return row.attemptCount > 0 ? "retrying" : "waiting";
}

/**
 * Whether this status is one a person has to do something about.
 *
 * Exported as its own question rather than left to each caller's `=== "failed"`
 * so the answer stays in one place when a status is added. A caller asking "is
 * anything wrong" must not have to enumerate the vocabulary to find out.
 */
export function jobNeedsAttention(status: JobDisplayStatus): boolean {
  return status === "failed";
}
