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

export {
  JOB_DISPLAY_STATUSES,
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
}

/** The window sizes the screen offers. The endpoint's own ceiling is 200. */
export const JOB_WINDOW_SIZES = [25, 50, 100, 200] as const;
export type JobWindowSize = (typeof JOB_WINDOW_SIZES)[number];

/**
 * How long the queue keeps a finished job.
 *
 * Stated so the screen can say it. An operator who does not know a job list is
 * pruned reads an absence as "this never ran", which is the one wrong
 * conclusion this screen exists to prevent.
 */
export const JOB_RETENTION_DAYS = 7;
