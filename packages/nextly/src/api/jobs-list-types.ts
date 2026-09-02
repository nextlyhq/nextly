/**
 * The wire contract for `GET /api/jobs`, published so a client need not
 * restate it.
 *
 * The admin screen that reads this endpoint has to enumerate the status
 * vocabulary — to offer a filter, and to give each status a presentation — and
 * a copy of that vocabulary written on the client is a second list that agrees
 * only on the day it is written. Importing it makes a status added in the core
 * a compile error in every exhaustive mapping downstream, which is the only
 * kind of notice that arrives before a user sees a blank pill.
 *
 * Shape and vocabulary, not machinery. What it carries besides types is the
 * status list, the attention predicate that reads it, and the default
 * retention — each one a decision a client would otherwise make for itself.
 * Nothing here reaches into the database, so a client that imports it pays for
 * no graph beyond what it asks.
 *
 * @module api/jobs-list-types
 */

import type { JobDisplayStatus } from "../domains/jobs/job-display-status";
import type { JobState } from "../schemas/jobs";

export {
  ATTENTION_STATES,
  JOB_DISPLAY_STATUSES,
  jobNeedsAttention,
  type JobDisplayStatus,
} from "../domains/jobs/job-display-status";

/**
 * How long a finished job is kept BY DEFAULT.
 *
 * Published because a monitor has to tell its reader that an absent job may
 * have run and been pruned, and a client that writes its own "7 days" states a
 * policy it cannot see. It is only the default: a host passing `retentionMs` to
 * `runJobsPass` — `null` disables pruning entirely — keeps rows for some other
 * period, and nothing on the read path can observe which. A client must present
 * this as the default rather than as the installation's actual policy.
 */
export { DEFAULT_RETENTION_MS } from "../domains/jobs/job-retention";

/**
 * One row as the route assembles it, with instants still `Date`.
 *
 * This is the shape the handler builds; {@link JobListItem} is what a client
 * receives once it has been through JSON. Both exist because a route cannot be
 * typed with the serialized form and a client cannot be typed with the other —
 * and they are one declaration rather than two, so a field added here reaches
 * the client's type without a second edit.
 */
export interface JobListRow {
  id: string;
  /** The registered task name, e.g. `releases:drain`. */
  slug: string;
  /** The stored lifecycle. Present for operators who know the queue. */
  state: JobState;
  /**
   * The DERIVED status, which is the one to display.
   *
   * The stored state cannot express it: a retrying job and one that has never
   * run are both `pending`, and a job executing right now is `pending` with a
   * live lease.
   */
  status: JobDisplayStatus;
  attemptCount: number;
  /** Whatever the handler threw, verbatim. Never rewritten in transit. */
  lastError: string | null;
  /** When the job asked to run, or `null` for "as soon as a trigger sees it". */
  runAt: Date | null;
  /** When the next retry is due, or `null` when none is scheduled. */
  nextAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One row as a client receives it: {@link JobListRow} after JSON, where every
 * instant is an ISO-8601 string.
 *
 * DERIVED from the row rather than transcribed. A transcription is the same
 * list twice, and the copy is the one that stops tracking.
 */
export type JobListItem = {
  [K in keyof JobListRow]: JobListRow[K] extends Date
    ? string
    : JobListRow[K] extends Date | null
      ? string | null
      : JobListRow[K];
};
