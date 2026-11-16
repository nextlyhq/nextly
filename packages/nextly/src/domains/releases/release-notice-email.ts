/**
 * The email that copies a release notice to the person it is for.
 *
 * A release notice is recorded in the transaction of the change it reports,
 * and its email stands or falls with it: the change adds this job in the same
 * transaction ({@link enqueueReleaseNoticeEmail}), and the job sends the email
 * once that has committed. How the job reads the notice, asks again whether
 * its person may still be sent it, sends it under a key made from the
 * notice's id and retries a failure is the notices domain's one notice email
 * (`domains/notices/notice-email`), shared with every feature that emails its
 * notices; what is the releases' own is here: the job's slug, and the message
 * a release notice makes, with the instant the release was scheduled for.
 *
 * @module domains/releases/release-notice-email
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { EmailSendOutcome } from "../email/services/send-failures";
import type { JobDefinition } from "../jobs/job-registry";
import {
  createNoticeEmailJob,
  enqueueNoticeEmail,
  noticeEmailKey,
  noticeEmailMessage,
  sendNoticeEmail,
  type NoticeEmail,
  type NoticeEmailDeps,
  type NoticeEmailJobInput,
  type NoticeEmailMessage,
} from "../notices/notice-email";
import type { NoticeKind, NoticeText } from "../notices/notice-kinds";
import type { StoredNotice } from "../notices/notices-service";

import { isKnownTimeZone } from "./release-calendar";
import { RELEASE_OVERDUE_NOTICE } from "./release-overdue-notice";
import { RELEASE_STOPPED_NOTICE } from "./release-stopped-notice";

/** The registered slug. Stated once so the writer and the registry agree. */
export const RELEASE_NOTICE_EMAIL_JOB = "releases:notice-email";

/** What the job is given: the notice to copy, by id, and nothing of it. */
export type ReleaseNoticeEmailJobInput = NoticeEmailJobInput;

/** What the job reads and sends through. */
export type ReleaseNoticeEmailDeps = NoticeEmailDeps;

/** The email made from one notice. */
export type ReleaseNoticeMessage = NoticeEmailMessage;

/**
 * The releases' notice email, as the shared job runs it: under the releases'
 * own slug, its keys and logs naming a "release" notice, and each message made
 * from a release notice alone, so the job sends nothing for another feature's.
 */
const RELEASE_NOTICE_EMAIL: NoticeEmail = {
  slug: RELEASE_NOTICE_EMAIL_JOB,
  name: "release",
  message: (notice, subject) => {
    const copy = copyOf(notice, subject.subjectGone);
    return copy === null
      ? null
      : releaseNoticeMessage({ ...copy, url: subject.url });
  },
};

/**
 * Hand a newly recorded notice's email to the job queue, in the notice's own
 * transaction, so the job exists only if the notice does.
 */
export async function enqueueReleaseNoticeEmail(
  tx: Pick<TransactionContext, "insert">,
  noticeId: string,
  now: Date
): Promise<void> {
  await enqueueNoticeEmail(tx, RELEASE_NOTICE_EMAIL_JOB, noticeId, now);
}

/**
 * The key a notice's email is sent under: the same on every run of its job,
 * and unlike any other notice's.
 */
export function releaseNoticeEmailKey(noticeId: string): string {
  return noticeEmailKey(RELEASE_NOTICE_EMAIL, noticeId);
}

/**
 * The email for one notice: the notice's own text, so the two never say
 * different things, then the instant the release was scheduled for, written
 * in the zone it was scheduled in and named (an email has no reader's zone),
 * then the link to it where there is one.
 */
export function releaseNoticeMessage(input: {
  text: NoticeText;
  /** The instant, as an ISO string, or `null` where the release had none. */
  scheduledAt: string | null;
  /** The zone it was scheduled in, or `null` for none. */
  timezone: string | null;
  /** The release's page as an absolute URL, or `null` for no link. */
  url: string | null;
}): ReleaseNoticeMessage {
  const when =
    input.scheduledAt === null
      ? null
      : instantIn(input.scheduledAt, input.timezone);
  return noticeEmailMessage({
    text: input.text,
    after: when === null ? [] : [`It was scheduled for ${when}.`],
    url: input.url,
    linkLabel: "Open the release",
  });
}

/**
 * The job that sends a notice's email: the shared notice email job, under the
 * releases' slug. Its dependencies are resolved per run, as the queued email's
 * own job resolves them, so the send service is the one registered when it
 * runs.
 */
export function createReleaseNoticeEmailJob(
  deps: () => ReleaseNoticeEmailDeps
): JobDefinition<ReleaseNoticeEmailJobInput> {
  return createNoticeEmailJob(RELEASE_NOTICE_EMAIL, deps);
}

/**
 * Send the email for one notice, or nothing: the site sends no email, the
 * notice is gone, it is not a release notice, its person may no longer see
 * it or is deactivated, or its person has no address. The notice alone then
 * stands, and nothing fails. Asked afresh on every call, so each attempt is
 * judged as it is made.
 *
 * @returns the send's outcome, or `null` when nothing was sent
 */
export function emailReleaseNotice(
  deps: ReleaseNoticeEmailDeps,
  noticeId: string
): Promise<EmailSendOutcome | null> {
  return sendNoticeEmail(RELEASE_NOTICE_EMAIL, deps, noticeId);
}

/** A release notice's text and instant, or `null` for any other notice. */
function copyOf(
  notice: StoredNotice,
  subjectGone: boolean
): Pick<
  Parameters<typeof releaseNoticeMessage>[0],
  "text" | "scheduledAt" | "timezone"
> | null {
  switch (notice.kind) {
    case RELEASE_STOPPED_NOTICE.key:
      return copyWith(RELEASE_STOPPED_NOTICE, notice.data, subjectGone);
    case RELEASE_OVERDUE_NOTICE.key:
      return copyWith(RELEASE_OVERDUE_NOTICE, notice.data, subjectGone);
    default:
      return null;
  }
}

/** One kind's snapshot, parsed by its own schema and rendered by its kind. */
function copyWith<
  TData extends { scheduledAt: string | null; timezone?: string | null },
>(kind: NoticeKind<TData>, stored: unknown, subjectGone: boolean) {
  const parsed = kind.data.safeParse(stored);
  if (!parsed.success) return null;
  return {
    text: kind.render(parsed.data, { subjectGone }),
    scheduledAt: parsed.data.scheduledAt,
    timezone: parsed.data.timezone ?? null,
  };
}

/** An instant in a named zone, or in UTC where the zone is unknown or none. */
function instantIn(iso: string, timezone: string | null): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const zone =
    timezone !== null && isKnownTimeZone(timezone) ? timezone : "UTC";
  const written = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(at);
  return `${written} (${zone})`;
}
