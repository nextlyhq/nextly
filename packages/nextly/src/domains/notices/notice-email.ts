/**
 * The email that copies a notice to the person it is for: one job body shared
 * by every feature whose notices are also emailed, each feature giving only
 * its own message.
 *
 * A notice is recorded in the transaction of the change it reports, and its
 * email must stand or fall with it. The change adds the feature's job in the
 * same transaction ({@link enqueueNoticeEmail}), and the job sends the email
 * once that has committed: a notice therefore never stands without its email
 * handed on, and a process that stops before the job runs leaves it for the
 * next jobs run.
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
 * A feature declares its email once ({@link NoticeEmail}): its job's slug,
 * the word its keys and logs name its notices by, and the message it makes
 * from one of its notices. Each feature keeps a job of its own slug, built
 * here, so the one body below serves them all.
 *
 * @module domains/notices/notice-email
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
} from "./notice-kinds";
import {
  NoticesService,
  type NoticesDb,
  type StoredNotice,
} from "./notices-service";

/** What a notice's email job is given: the notice to copy, by id, and nothing of it. */
export type NoticeEmailJobInput = { noticeId: string };

/** What a notice's email job reads and sends through. */
export interface NoticeEmailDeps {
  /** The database the notice and its person are read from. */
  db: NoticesDb;
  /** Core's send service, or `null` where none is registered. */
  email: Pick<EmailService, "isConfigured" | "send"> | null;
}

/** The email made from one notice. */
export interface NoticeEmailMessage {
  subject: string;
  html: string;
  plainText: string;
}

/**
 * What a feature's message is told of its notice's subject: whether it is
 * gone, and its page as an absolute URL where it has one.
 */
interface NoticeEmailSubject {
  /** The subject no longer exists: its kind's `link` found nothing for it. */
  subjectGone: boolean;
  /** Its page in the admin, absolute, or `null` for no link. */
  url: string | null;
}

/**
 * One feature's notice email: everything about it that is the feature's own.
 */
export interface NoticeEmail {
  /** The job's registered slug, such as `releases:notice-email`. */
  slug: string;
  /**
   * The feature's word for its notices, as its keys and logs name them:
   * `release` gives the key `release-notice:<id>` and the log kind
   * `release-notice-email-failed`.
   */
  name: string;
  /**
   * The email for one notice, or `null` for a notice this feature does not
   * email (another feature's kind, or a snapshot its schema refuses).
   */
  message: (
    notice: StoredNotice,
    subject: NoticeEmailSubject
  ) => NoticeEmailMessage | null;
}

/**
 * Hand a newly recorded notice's email to the job queue under `slug`, in the
 * notice's own transaction, so the job exists only if the notice does.
 */
export async function enqueueNoticeEmail(
  tx: Pick<TransactionContext, "getDrizzle">,
  dialect: string,
  slug: string,
  noticeId: string,
  now: Date
): Promise<void> {
  const input: NoticeEmailJobInput = { noticeId };
  await enqueueInTransaction(tx, dialect, {
    slug,
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
 */
export function noticeEmailKey(
  email: Pick<NoticeEmail, "name">,
  noticeId: string
): string {
  return `${email.name}-notice:${noticeId}`;
}

/**
 * A notice's email from its rendered text: the title, the body, any further
 * paragraphs the feature adds, then the link where there is one. The text is
 * the notice's own, so the two never say different things.
 */
export function noticeEmailMessage(input: {
  text: NoticeText;
  /** Paragraphs after the notice's own text, such as when it was scheduled. */
  after?: readonly string[];
  /** The subject's page as an absolute URL, or `null` for no link. */
  url: string | null;
  /** What the link says, such as "Open the release". */
  linkLabel: string;
}): NoticeEmailMessage {
  const paragraphs = [
    input.text.title,
    ...(input.text.body === undefined ? [] : [input.text.body]),
    ...(input.after ?? []),
  ];
  const html = [
    ...paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`),
    ...(input.url === null
      ? []
      : [
          `<p><a href="${escapeHtml(input.url)}">${escapeHtml(input.linkLabel)}</a></p>`,
        ]),
  ].join("\n");
  const plainText = [
    ...paragraphs,
    ...(input.url === null ? [] : [`${input.linkLabel}: ${input.url}`]),
  ].join("\n\n");
  // One line: a title carrying a line break must not become a second header.
  const subject = input.text.title.replace(/\s+/g, " ").trim();
  return { subject, html, plainText };
}

/**
 * The job that sends one feature's notice emails. Its dependencies are
 * resolved per run, as the queued email's own job resolves them, so the send
 * service is the one registered when it runs.
 */
export function createNoticeEmailJob(
  email: NoticeEmail,
  deps: () => NoticeEmailDeps
): JobDefinition<NoticeEmailJobInput> {
  return defineJob<NoticeEmailJobInput>({
    slug: email.slug,
    // As many attempts as core's queued email makes, so a notice's email is
    // tried as long as any other queued email would be.
    retry: { maxAttempts: QUEUED_EMAIL_MAX_ATTEMPTS },
    handler: async input => {
      // A row's input is whatever was stored; one without an id names no
      // notice, and there is nothing to send.
      if (typeof input?.noticeId !== "string") return;
      const failure = await attemptFailure(email, deps(), input.noticeId);
      if (failure !== undefined) reportFailure(email, input.noticeId, failure);
    },
  });
}

/**
 * What a failed attempt leads to: a failure no retry can help is logged and
 * ends the job, and one a retry can help is thrown to the job queue, which
 * records it as the attempt's error and backs off; the next attempt asks
 * again who may be sent it.
 */
function reportFailure(
  email: NoticeEmail,
  noticeId: string,
  failure: EmailFailure
): void {
  if (!failure.retryable) {
    getNextlyLogger().warn({
      kind: `${email.name}-notice-email-failed`,
      message: `A ${email.name} notice's email could not be sent, and trying again would not help; the notice stands`,
      noticeId,
      reason: failure.reason,
    });
    return;
  }
  throw NextlyError.externalService({
    publicMessage: `A ${email.name} notice's email was not sent and will be tried again.`,
    logContext: { noticeId, reason: failure.reason },
  });
}

/**
 * One attempt at a notice's email, and why it failed, if it did: by the send's
 * own answer, or by what core's queued email makes of a send that threw.
 */
async function attemptFailure(
  email: NoticeEmail,
  deps: NoticeEmailDeps,
  noticeId: string
): Promise<EmailFailure | undefined> {
  try {
    const outcome = await sendNoticeEmail(email, deps, noticeId);
    if (outcome === null || outcome.success) return undefined;
    return outcome.failure ?? notAcceptedFailure();
  } catch (error) {
    return thrownAttemptFailure(error);
  }
}

/**
 * Send the email for one notice, or nothing: the site sends no email, the
 * notice is gone, its kind is not registered, its person may no longer see
 * it or is deactivated, its person has no address, or the feature makes no
 * message of it. The notice alone then stands, and nothing fails. Asked
 * afresh on every call, so each attempt is judged as it is made.
 *
 * @returns the send's outcome, or `null` when nothing was sent
 */
export async function sendNoticeEmail(
  email: NoticeEmail,
  deps: NoticeEmailDeps,
  noticeId: string
): Promise<EmailSendOutcome | null> {
  const { db, email: sender } = deps;
  if (sender === null || !(await sender.isConfigured())) return null;
  const shown = await stillShown(db, noticeId);
  if (shown === null) return null;
  const to = await activeAddress(db, shown.notice.userId);
  if (to === null) return null;
  const subject = await subjectOf(shown.kind, shown.notice.subjectId);
  // A subject gone since it was judged readable can no longer be judged: a kind that judges
  // readers says nothing of it, as its list then does.
  if (subject.subjectGone && shown.kind.readable !== undefined) return null;
  const message = email.message(shown.notice, subject);
  if (message === null) return null;
  return sender.send({
    to,
    subject: message.subject,
    html: message.html,
    plainText: message.plainText,
    person: { kind: "staff", id: shown.notice.userId },
    idempotencyKey: noticeEmailKey(email, shown.notice.id),
  });
}

/**
 * The notice and its kind, while its person would still see it in their own
 * list, by its kind's own rules as that list applies them: a person who may no
 * longer see notices of the kind, or read the notice's subject, is not sent
 * what their list now hides from them. `null` for a notice that is gone or whose kind is not registered.
 */
async function stillShown(
  db: NoticesDb,
  noticeId: string
): Promise<{ notice: StoredNotice; kind: NoticeKind<unknown> } | null> {
  const notice = await new NoticesService({ db }).byId(noticeId);
  if (notice === null) return null;
  const kind = registeredNoticeKind(notice.kind);
  if (kind === undefined) return null;
  if (kind.visible !== undefined && !(await kind.visible(notice.userId))) {
    return null;
  }
  // Their list withholds what a notice says of a subject they may not read, so no email says it.
  if (kind.readable !== undefined) {
    const parsed = kind.data.safeParse(notice.data);
    if (!parsed.success) return null;
    const judged = {
      id: notice.id,
      subjectId: notice.subjectId,
      data: parsed.data,
    };
    const shown = (await kind.readable(notice.userId, [judged])).get(notice.id);
    if (shown === undefined) return null;
    // The email says what their list shows them, part of the snapshot withheld where it is.
    return { notice: { ...notice, data: shown }, kind };
  }
  return { notice, kind };
}

/**
 * The address of an active account, or `null`. Asked of the database so
 * SQLite's 0 and 1 and a real boolean give one answer: a deactivated person
 * keeps their roles, and with them the kind's `visible`, so that alone would
 * still send it.
 */
async function activeAddress(
  db: NoticesDb,
  userId: string
): Promise<string | null> {
  const [person] = await db.select<{ email: string | null }>("users", {
    columns: ["email"],
    where: {
      and: [
        { column: "id", op: "=", value: userId },
        { column: "isActive", op: "=", value: true },
      ],
    },
    limit: 1,
  });
  return person?.email || null;
}

/**
 * The notice's subject as its kind links it, so the notice and its email lead
 * to the same page: gone where the kind's `link` finds nothing for it, and
 * with no URL where no public origin is set, since a guessed host is a broken
 * link. A kind with no `link` has no page and is never gone.
 */
async function subjectOf(
  kind: NoticeKind<unknown>,
  subjectId: string
): Promise<NoticeEmailSubject> {
  if (kind.link === undefined) return { subjectGone: false, url: null };
  const path = (await kind.link([subjectId])).get(subjectId) ?? null;
  const origin = getPublicOrigin();
  return {
    subjectGone: path === null,
    url: path === null || origin === null ? null : `${origin}${path}`,
  };
}
