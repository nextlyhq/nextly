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

import { JOB_STATES, type JobState } from "../../schemas/jobs/types";

/**
 * Every status the derivation can produce, in the order a queue moves through
 * them.
 *
 * A list rather than a bare union because a client needs to enumerate them —
 * to offer a filter, or to map each to a presentation — and a client that
 * writes its own copy of the vocabulary stops agreeing the moment a status is
 * added here. The union below is derived from it, so there is one list.
 *
 * The order is the lifecycle, not a ranking, and a UI listing them may show
 * them in it.
 */
export const JOB_DISPLAY_STATUSES = [
  /** Queued, never attempted. */
  "waiting",
  /** An attempt failed; another is scheduled. Self-healing, not an alarm. */
  "retrying",
  /** A runner holds the lease right now. */
  "running",
  /** Finished successfully. */
  "succeeded",
  /** Attempts are spent. This will not happen without a person. */
  "failed",
] as const;

/** What a job row is doing, in the terms an operator reasons about. */
export type JobDisplayStatus = (typeof JOB_DISPLAY_STATUSES)[number];

/**
 * What each display status MEANS, in the two ways callers need to know.
 *
 * One declaration rather than a predicate and a list that happen to agree.
 * `jobNeedsAttention` and {@link ATTENTION_STATES} answer the same question at
 * different layers — "does a person have to act" and "which rows should SQL
 * select to find out" — and written separately they agree only until a second
 * actionable status is added. The list would then stay stale, and the database
 * would discard the new failures before the predicate could ever see them.
 *
 * `storedStates` is the inverse of {@link jobDisplayStatus}: the states a row
 * can hold and still be shown as this status. It is not one-to-one, and that
 * asymmetry is the whole reason a derivation is needed — `waiting` and
 * `retrying` are both stored `pending`, and a job executing right now is
 * `pending` with a live lease. A test derives this table from the function
 * rather than trusting it, so the two cannot drift either.
 */
interface JobStatusFacts {
  /** Whether this status is one a person has to do something about. */
  readonly needsAttention: boolean;
  /** Every stored state that can be displayed as this status. */
  readonly storedStates: readonly JobState[];
}

const STATUS_FACTS: Record<JobDisplayStatus, JobStatusFacts> = {
  waiting: { needsAttention: false, storedStates: ["pending"] },
  retrying: { needsAttention: false, storedStates: ["pending"] },
  // EVERY stored state, because a live lease is read before the column and
  // overrides it. `claim` takes the lease without changing the state, so an
  // in-flight job is usually `pending` — but a row in any state that still
  // carries an unexpired lease displays as running, so a caller narrowing by
  // this status in SQL cannot use the column to do it and must test the lease.
  running: { needsAttention: false, storedStates: [...JOB_STATES] },
  succeeded: { needsAttention: false, storedStates: ["done"] },
  failed: { needsAttention: true, storedStates: ["failed"] },
};

/** The columns the derivation reads, and nothing more. */
export interface JobStatusInput {
  state: JobState;
  attemptCount: number;
  /**
   * When this runner's lease expires, or `null` when nothing holds one.
   *
   * Load-bearing, and not obvious: `claim` takes the lease WITHOUT changing
   * state, so a job executing right now still reads `pending`. The state column
   * therefore never says "running" for work the runner is doing, and the lease
   * is the only evidence that it is.
   */
  lockedUntil: Date | null;
}

/**
 * Read in this order, and the order is the whole correctness argument.
 *
 * A LIVE LEASE first, because it is the only signal that work is happening:
 * `claim` writes `lockedBy`/`lockedUntil` and leaves the state alone, and
 * `markAttempt` raises the count BEFORE the handler is invoked. So an in-flight
 * first attempt is `pending` with a count of 1 — which, read by count alone,
 * reports as "retrying" and tells an operator a healthy job has already failed.
 *
 * An EXPIRED lease is not a running job. It is a runner that died holding one,
 * and the row is waiting to be reclaimed — so the comparison is against `now`
 * rather than against the field being present.
 *
 * Reading the lease first is SAFE against a terminal row because `finalize`
 * clears `lockedBy`/`lockedUntil` on every outcome — retry and terminal alike.
 * A finished job therefore never carries a live lease, so the ordering cannot
 * report one as running. That is a guarantee of the repository rather than of
 * this function, which is why it is named here: if `finalize` ever stopped
 * clearing the lock, this ordering would need to invert.
 *
 * `attemptCount` last, because it is what separates waiting from retrying once
 * nothing is executing: `finalize` writes `pending` for a retry, so the count
 * is the only surviving evidence that an attempt already happened.
 *
 * `now` is a parameter rather than read from the clock inside, so a caller
 * rendering a page and a test asserting one both control it.
 */
export function jobDisplayStatus(
  row: JobStatusInput,
  now: Date
): JobDisplayStatus {
  if (row.lockedUntil !== null && row.lockedUntil.getTime() > now.getTime()) {
    return "running";
  }
  // Kept for completeness: nothing writes this state today, and a status
  // derivation that silently reported a stored value as something else would be
  // the harder defect to find if something starts.
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
  return STATUS_FACTS[status].needsAttention;
}

/**
 * The stored states a row can hold and still be displayed as `status`.
 *
 * The inverse of {@link jobDisplayStatus}, exposed so a caller narrowing a
 * query by a DISPLAY status can name the stored states that produce it —
 * `retrying` and `waiting` are both `pending`, so a caller comparing the
 * display vocabulary against the column would select nothing.
 */
export function storedStatesFor(status: JobDisplayStatus): readonly JobState[] {
  return STATUS_FACTS[status].storedStates;
}

/**
 * The STORED states a caller must select to find every job needing attention.
 *
 * The bridge between the derived vocabulary and a SQL predicate. A caller
 * asking "is anything wrong" wants to ask the database, not to fetch a recent
 * window and inspect it — a window is the most recent N rows, so a busy queue
 * hides an older failure inside it and the caller concludes, wrongly, that
 * nothing is wrong.
 *
 * COMPUTED from {@link STATUS_FACTS} rather than listed, so a status added
 * there with `needsAttention` widens this set in the same edit. A hand-written
 * list goes stale silently and in the dangerous direction: the SQL discards the
 * new failures before any predicate can inspect them.
 */
export const ATTENTION_STATES: readonly JobState[] = [
  ...new Set(
    JOB_DISPLAY_STATUSES.filter(
      status => STATUS_FACTS[status].needsAttention
    ).flatMap(status => STATUS_FACTS[status].storedStates)
  ),
];
