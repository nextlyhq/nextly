/**
 * The warning that queued email is not being sent because the jobs trigger
 * is not running.
 *
 * A queued email's retries are its job's, and a job runs only when something
 * calls `/api/jobs/run`. A site that never schedules it gets each email's
 * first attempt, made as the email is queued, and nothing after: a retry
 * waits for ever. One more than 15 minutes past its due time is one a healthy
 * trigger, which runs every few minutes, would have run, so the server log
 * says so at startup and on each queued send.
 *
 * "Past due" is the job queue's own rule (`JobsRepository.findDue`), read as
 * of 15 minutes ago, so this and the runner never disagree on which jobs are
 * waiting for it. Only jobs created by then count: one never attempted has
 * no due time of its own and is due from its creation, so a job queued a
 * moment ago would otherwise read as due 15 minutes ago too.
 *
 * @module domains/email/queued-email-warning
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../shared/types";
import { JobsRepository } from "../jobs/jobs-repository";
import { warnQuietly } from "../retention/safe-log";

import { QUEUED_EMAIL_JOB } from "./queued-email-job";

/** How long past its due time a queued email waits before it is warned about. */
export const LATE_QUEUED_EMAIL_MS = 15 * 60_000;

/** The most overdue emails counted; past it the warning says "or more". */
const COUNTED = 100;

/** What the warning is written to. */
export type LateQueuedEmailLogger = Logger;

/**
 * How many queued emails are more than `LATE_QUEUED_EMAIL_MS` past due, up
 * to `COUNTED`.
 */
export async function lateQueuedEmails(
  adapter: DrizzleAdapter,
  now: Date = new Date()
): Promise<number> {
  const since = new Date(now.getTime() - LATE_QUEUED_EMAIL_MS);
  const due = await new JobsRepository(adapter).findDue({
    now: since,
    createdBy: since,
    limit: COUNTED,
    slug: QUEUED_EMAIL_JOB,
  });
  return due.length;
}

/**
 * Warn in the server log when queued email is overdue. Never throws: a
 * warning that cannot be checked must not fail a boot or a send.
 */
export async function warnAboutLateQueuedEmail(
  adapter: DrizzleAdapter,
  logger: LateQueuedEmailLogger,
  now: Date = new Date()
): Promise<void> {
  let late: number;
  try {
    late = await lateQueuedEmails(adapter, now);
  } catch {
    // A table not created yet, or a database that is briefly unavailable:
    // either way there is nothing to say yet.
    return;
  }
  if (late === 0) return;
  const count = late >= COUNTED ? `${COUNTED} or more` : String(late);
  warnQuietly(
    logger,
    `${count} queued email${late === 1 ? " is" : "s are"} more than 15 minutes past due, so the jobs trigger isn't running. Call /api/jobs/run every few minutes (a cron job or a scheduler) so queued email is retried.`,
    { lateQueuedEmails: late }
  );
}
