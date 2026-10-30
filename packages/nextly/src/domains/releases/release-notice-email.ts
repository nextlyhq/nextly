/**
 * The email that copies a release notice to the person it is for.
 *
 * A release notice is recorded in the transaction of the change it reports,
 * and its email must stand or fall with it. The change adds this job in the
 * same transaction ({@link enqueueReleaseNoticeEmail}), and the job sends the
 * email once that has committed: a notice therefore never stands without its
 * email handed on, and a process that stops before the job runs leaves it
 * for the next jobs run.
 *
 * Every attempt is the job's, through core's send (`EmailService.send`), and
 * asks again first whether the notice's person may still be sent it: its
 * kind's `visible`, and an active account. A failure a retry can help is
 * thrown to the job queue, which tries again with backoff up to the attempt
 * limit core's queued email uses; so a person who lost access or was
 * deactivated between two attempts is sent nothing by the second. A failure
 * no retry can help is logged, and the notice alone stands.
 *
 * Sent under a key made from the notice's id, so however often the job runs
 * the notice's email is sent once where the provider honours keys: core's
 * send claim answers a repeat of the same message from the first send.
 *
 * @module domains/releases/release-notice-email
 * @experimental Until the notices feature is complete.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";
import { getNextlyLogger } from "../../observability/logger";
import { getPublicOrigin } from "../../shared/lib/get-base-url";
import type { EmailFailure } from "../email/failure";
import { QUEUED_EMAIL_MAX_ATTEMPTS } from "../email/queued-email-job";
import { thrownAttemptFailure } from "../email/queued-send";
import type { EmailService } from "../email/services/email-service";
import {
  notAcceptedFailure,
  type EmailSendOutcome,
} from "../email/services/send-failures";
import { escapeHtml } from "../email/services/template-engine";
import { defineJob, type JobDefinition } from "../jobs/job-registry";
import { enqueueInTransaction } from "../jobs/jobs-repository";
import {
  registeredNoticeKind,
  type NoticeKind,
  type NoticeText,
} from "../notices/notice-kinds";
import {
  NoticesService,
  type NoticesDb,
  type StoredNotice,
} from "../notices/notices-service";

import { isKnownTimeZone } from "./release-calendar";
import { releaseNoticeLinks } from "./release-notice-links";
import { RELEASE_OVERDUE_NOTICE } from "./release-overdue-notice";
import { RELEASE_STOPPED_NOTICE } from "./release-stopped-notice";

/** The registered slug. Stated once so the writer and the registry agree. */
export const RELEASE_NOTICE_EMAIL_JOB = "releases:notice-email";

/** What the job is given: the notice to copy, by id, and nothing of it. */
export type ReleaseNoticeEmailJobInput = { noticeId: string };

/** What the job reads and sends through. @experimental */
export interface ReleaseNoticeEmailDeps {
  /** The database the notice and its person are read from. */
  db: NoticesDb;
  /** Core's send service, or `null` where none is registered. */
  email: Pick<EmailService, "isConfigured" | "send"> | null;
}

/** The email made from one notice. @experimental */
export interface ReleaseNoticeMessage {
  subject: string;
  html: string;
  plainText: string;
}

/**
 * Hand a newly recorded notice's email to the job queue, in the notice's own
 * transaction, so the job exists only if the notice does.
 *
 * @experimental
 */
export async function enqueueReleaseNoticeEmail(
  tx: Pick<TransactionContext, "getDrizzle">,
  dialect: string,
  noticeId: string,
  now: Date
): Promise<void> {
  const input: ReleaseNoticeEmailJobInput = { noticeId };
  await enqueueInTransaction(tx, dialect, {
    slug: RELEASE_NOTICE_EMAIL_JOB,
    input,
    runAt: null,
    // The email names its person itself; the job acts as nobody.
    runAsUserId: null,
    now,
  });
}

/**
 * The key a notice's email is sent under: the same on every run of its job,
 * and unlike any other notice's.
 *
 * @experimental
 */
export function releaseNoticeEmailKey(noticeId: string): string {
  return `release-notice:${noticeId}`;
}

/**
 * The email for one notice: the notice's own text, so the two never say
 * different things, then the instant the release was scheduled for, written
 * in the zone it was scheduled in and named (an email has no reader's zone),
 * then the link to it where there is one.
 *
 * @experimental
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
  const paragraphs = [
    input.text.title,
    ...(input.text.body === undefined ? [] : [input.text.body]),
    ...(when === null ? [] : [`It was scheduled for ${when}.`]),
  ];
  const html = [
    ...paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`),
    ...(input.url === null
      ? []
      : [`<p><a href="${escapeHtml(input.url)}">Open the release</a></p>`]),
  ].join("\n");
  const plainText = [
    ...paragraphs,
    ...(input.url === null ? [] : [`Open the release: ${input.url}`]),
  ].join("\n\n");
  // One line: a title carrying a line break must not become a second header.
  const subject = input.text.title.replace(/\s+/g, " ").trim();
  return { subject, html, plainText };
}

/**
 * The job that sends a notice's email. Its dependencies are resolved per
 * run, as the queued email's own job resolves them, so the send service is
 * the one registered when it runs.
 *
 * @experimental
 */
export function createReleaseNoticeEmailJob(
  deps: () => ReleaseNoticeEmailDeps
): JobDefinition<ReleaseNoticeEmailJobInput> {
  return defineJob<ReleaseNoticeEmailJobInput>({
    slug: RELEASE_NOTICE_EMAIL_JOB,
    // As many attempts as core's queued email makes, so a notice's email is
    // tried as long as any other queued email would be.
    retry: { maxAttempts: QUEUED_EMAIL_MAX_ATTEMPTS },
    handler: async input => {
      // A row's input is whatever was stored; one without an id names no
      // notice, and there is nothing to send.
      if (typeof input?.noticeId !== "string") return;
      const failure = await attemptFailure(deps(), input.noticeId);
      if (failure === undefined) return;
      if (!failure.retryable) {
        getNextlyLogger().warn({
          kind: "release-notice-email-failed",
          message:
            "A release notice's email could not be sent, and trying again would not help; the notice stands",
          noticeId: input.noticeId,
          reason: failure.reason,
        });
        return;
      }
      // To the job queue, which records this as the attempt's error and
      // backs off; the next attempt asks again who may be sent it.
      throw new NextlyError({
        code: "EXTERNAL_SERVICE_ERROR",
        publicMessage:
          "A release notice's email was not sent and will be tried again.",
        logContext: { noticeId: input.noticeId, reason: failure.reason },
      });
    },
  });
}

/**
 * One attempt at a notice's email, and why it failed, if it did: by the send's
 * own answer, or by what core's queued email makes of a send that threw.
 */
async function attemptFailure(
  deps: ReleaseNoticeEmailDeps,
  noticeId: string
): Promise<EmailFailure | undefined> {
  try {
    const outcome = await emailReleaseNotice(deps, noticeId);
    if (outcome === null || outcome.success) return undefined;
    return outcome.failure ?? notAcceptedFailure();
  } catch (error) {
    return thrownAttemptFailure(error);
  }
}

/**
 * Send the email for one notice, or nothing: the site sends no email, the
 * notice is gone, it is not a release notice, its person may no longer see
 * it or is deactivated, or its person has no address. The notice alone then
 * stands, and nothing fails. Asked afresh on every call, so each attempt is
 * judged as it is made.
 *
 * @returns the send's outcome, or `null` when nothing was sent
 * @experimental
 */
export async function emailReleaseNotice(
  deps: ReleaseNoticeEmailDeps,
  noticeId: string
): Promise<EmailSendOutcome | null> {
  const { db, email } = deps;
  if (email === null || !(await email.isConfigured())) return null;
  const notice = await new NoticesService({ db }).byId(noticeId);
  if (notice === null) return null;
  // Only to a person the notice itself still shows to, by its kind's own
  // rule as their list of notices applies it: a person who may no longer
  // read releases is not sent what their list now hides from them.
  const kind = registeredNoticeKind(notice.kind);
  if (kind === undefined) return null;
  if (kind.visible !== undefined && !(await kind.visible(notice.userId))) {
    return null;
  }
  // Only an active account, asked of the database as the releases domain
  // asks it of a member's author, so SQLite's 0 and 1 and a real boolean give
  // one answer: a deactivated person keeps their roles, and with them the
  // kind's `visible`, so that alone would still send it.
  const [person] = await db.select<{ email: string | null }>("users", {
    columns: ["email"],
    where: {
      and: [
        { column: "id", op: "=", value: notice.userId },
        { column: "isActive", op: "=", value: true },
      ],
    },
    limit: 1,
  });
  if (!person?.email) return null;

  // The link every release notice has (`release-notice-links`), so the notice
  // and its email lead to the same page; none where the release is gone, or
  // where no public origin is set, since a guessed host is a broken link.
  const path =
    (await releaseNoticeLinks([notice.subjectId])).get(notice.subjectId) ??
    null;
  const copy = copyOf(notice, path === null);
  if (copy === null) return null;
  const origin = getPublicOrigin();
  const message = releaseNoticeMessage({
    ...copy,
    url: path === null || origin === null ? null : `${origin}${path}`,
  });
  return email.send({
    to: person.email,
    subject: message.subject,
    html: message.html,
    plainText: message.plainText,
    person: { kind: "staff", id: notice.userId },
    idempotencyKey: releaseNoticeEmailKey(notice.id),
  });
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
