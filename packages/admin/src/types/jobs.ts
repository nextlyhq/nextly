/**
 * Background job UI types.
 *
 * Re-exported from the core's published wire contract rather than mirrored.
 * Every other admin type module in this directory restates the server's shape
 * by hand, which is correct where the server has no published module to import
 * — and is exactly how a vocabulary drifts when it does. The status list is the
 * part that matters: an exhaustive presentation map keyed by it turns a status
 * added in the core into a compile error here, instead of a blank pill in front
 * of an operator.
 */

import { DEFAULT_RETENTION_MS } from "nextly/api/jobs-list-types";

export {
  ATTENTION_STATES,
  DEFAULT_RETENTION_MS,
  JOB_DISPLAY_STATUSES,
  jobNeedsAttention,
  type JobDisplayStatus,
  type JobListItem,
} from "nextly/api/jobs-list-types";

/**
 * What the list read accepts.
 *
 * `limit` only. The endpoint answers "the most recent N" and offers no offset
 * paging, because terminal rows are pruned on a retention window and a cursor
 * into a table that is being pruned behind you names rows that stop existing.
 */
export interface ListJobsParams {
  limit?: number;
  /**
   * Restrict to one registered task.
   *
   * Sent to the server rather than applied to the result, because the endpoint
   * returns the most recent N rows: filtering afterwards filters a window a
   * busier task may already have filled, and this task's failure would be
   * missing from a result that looks complete.
   */
  slug?: string;
  /**
   * Restrict to these STORED states.
   *
   * How a caller asks "did anything fail" without scanning a window: the
   * endpoint answers "the most recent N", so looking for failures inside that
   * window finds none whenever N healthy jobs ran more recently.
   */
  states?: readonly string[];
}

/** The window sizes the screen offers. The endpoint's own ceiling is 200. */
export const JOB_WINDOW_SIZES = [25, 50, 100, 200] as const;
export type JobWindowSize = (typeof JOB_WINDOW_SIZES)[number];

/**
 * How long the queue keeps a finished job BY DEFAULT, in days.
 *
 * Derived from the core's own constant rather than written here, and presented
 * as the default rather than as this installation's policy — because it may not
 * be. A host passing `retentionMs` to `runJobsPass` keeps rows for some other
 * period, and `null` disables pruning altogether; nothing on the read path can
 * observe which was chosen. Saying "removed after 7 days" flatly would be a
 * claim the screen cannot support, which is worse than the vagueness, since the
 * whole point of stating retention is that an absence must not be read as
 * proof a job never ran.
 */
export const DEFAULT_JOB_RETENTION_DAYS = Math.round(
  DEFAULT_RETENTION_MS / (24 * 60 * 60 * 1000)
);
