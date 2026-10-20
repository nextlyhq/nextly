/**
 * What a failed send, or a refused recipient, tells the caller.
 *
 * The email service hands a provider's answer here and reports what comes
 * back: the classification of a failure, and which recipients a provider that
 * took the message refused. Kept beside the service so its send path stays a
 * sequence of steps rather than a thicket of branches.
 *
 * @module domains/email/services/send-failures
 */

import type { EmailDeliveryRecipientKind } from "../delivery-record";
import { type EmailFailure, failureOf, unclassifiedFailure } from "../failure";
import type { EmailProviderAdapter } from "../types";

type AdapterResult = Awaited<ReturnType<EmailProviderAdapter["send"]>>;

/**
 * @experimental A recipient the provider refused while taking the message for
 * the others: which line it was on, its position on that line in the order
 * the send gave them, and what the refusal says about trying again.
 *
 * Never the address. A refusal reaches the REST response, and a blind copy an
 * `email.beforeSend` filter added is not the caller's to see.
 */
export interface RefusedRecipient {
  kind: EmailDeliveryRecipientKind;
  position: number;
  retryable: boolean;
  status?: number;
}

/** The reason given for a recipient refused without a classification. */
const REFUSED_REASON = "The email provider refused this recipient.";

/** The reason given when a provider answers that it did not send. */
const NOT_ACCEPTED_REASON = "The email provider did not accept the message.";

/**
 * What the provider's answer says about one refused mailbox: its own
 * classification when it gave one, else retryable, as any unclassified
 * failure is.
 */
export function refusalOf(
  result: AdapterResult,
  mailbox: string
): EmailFailure {
  const key = mailbox.trim().toLowerCase();
  const entry = result.refusals?.find(
    refusal => refusal.address.trim().toLowerCase() === key
  );
  const classified = entry ? failureOf({ emailFailure: entry }) : undefined;
  return classified ?? { retryable: true, reason: REFUSED_REASON };
}

/**
 * Every refused recipient of a message, by line and position.
 *
 * `recipients` is the message's recipients in the order they are recorded,
 * one entry per mailbox; its position on a line is counted in that order.
 */
export function refusedRecipients(
  recipients: ReadonlyArray<{
    to: string;
    recipientKind: EmailDeliveryRecipientKind;
  }>,
  refused: ReadonlySet<string>,
  result: AdapterResult
): RefusedRecipient[] {
  const counts: Record<EmailDeliveryRecipientKind, number> = {
    to: 0,
    cc: 0,
    bcc: 0,
  };
  const list: RefusedRecipient[] = [];
  for (const recipient of recipients) {
    const position = counts[recipient.recipientKind]++;
    if (!refused.has(recipient.to.trim().toLowerCase())) continue;
    const { retryable, status } = refusalOf(result, recipient.to);
    list.push({
      kind: recipient.recipientKind,
      position,
      retryable,
      ...(status !== undefined ? { status } : {}),
    });
  }
  return list;
}

/**
 * Why a message the provider answered did not reach the caller's `to`: the
 * first refused `to` recipient's refusal, or, when the provider answered that
 * it did not send at all, an unclassified failure.
 */
export function answeredFailure(
  result: AdapterResult,
  recipients: ReadonlyArray<{
    to: string;
    recipientKind: EmailDeliveryRecipientKind;
  }>,
  refused: ReadonlySet<string>
): EmailFailure {
  if (result.success !== true) return notAcceptedFailure();
  const primary = recipients.find(
    recipient =>
      recipient.recipientKind === "to" &&
      refused.has(recipient.to.trim().toLowerCase())
  );
  return primary ? refusalOf(result, primary.to) : unclassifiedFailure();
}

/**
 * The classification a thrown provider failure carries, with any of the
 * message's own addresses taken out of its reason, or an unclassified failure.
 *
 * A provider's reason is its own text, and a provider building it out of the
 * envelope would carry a recipient, a blind copy included, to wherever the
 * result goes. Compared against the actual mailboxes, case-insensitively.
 */
export function thrownFailure(
  error: unknown,
  mailboxes: readonly string[]
): EmailFailure {
  const failure = failureOf(error) ?? unclassifiedFailure();
  let reason = failure.reason;
  for (const mailbox of mailboxes) {
    if (mailbox === "") continue;
    // Escaped first, so a mailbox's `.` and `+` match themselves.
    const literal = mailbox.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    reason = reason.replace(new RegExp(literal, "gi"), "[recipient]");
  }
  return { ...failure, reason };
}

/** The delivery record's sentence for a recipient the provider refused. */
export function refusedRecordError(failure: EmailFailure): string {
  const status = failure.status !== undefined ? `, ${failure.status}` : "";
  return `Recipient refused by the provider (${
    failure.retryable ? "retryable" : "not retryable"
  }${status})`;
}

/**
 * One failure for a send split into several messages: the first one, marked
 * retryable when any of them is, since a retry is what reaches the recipients
 * whose message can still go.
 */
export function combinedFailure(
  failures: ReadonlyArray<EmailFailure | undefined>
): EmailFailure | undefined {
  const present = failures.filter(
    (failure): failure is EmailFailure => failure !== undefined
  );
  if (present.length === 0) return undefined;
  return {
    ...present[0],
    retryable: present.some(failure => failure.retryable),
  };
}

/**
 * @experimental What a send reports: whether it reached the caller's `to`,
 * the provider's message id when it is safe to show, and, when something
 * went wrong, the failure's kind and any recipients refused.
 */
export interface EmailSendOutcome {
  success: boolean;
  messageId?: string;
  /** @experimental Why the send did not succeed, and whether a retry can help. */
  failure?: EmailFailure;
  /** @experimental Recipients the provider refused while taking the message. */
  refused?: RefusedRecipient[];
}

/** The failure for a provider that answered that it did not send. */
export function notAcceptedFailure(): EmailFailure {
  return { retryable: true, reason: NOT_ACCEPTED_REASON };
}

/**
 * One outcome for a send split into one message per `to` address: successful
 * only when every message was, identified by the first message id there is.
 *
 * Message `i` carries `to` address `i` and, for the first only, the copies, so
 * each refusal's `to` position is the message's own and a copy's stands.
 */
export function splitSendOutcome(
  outcomes: readonly EmailSendOutcome[]
): EmailSendOutcome {
  const success = outcomes.every(outcome => outcome.success);
  const messageId = outcomes.find(
    outcome => outcome.messageId !== undefined
  )?.messageId;
  const refused = outcomes.flatMap((outcome, index) =>
    (outcome.refused ?? []).map(refusal =>
      refusal.kind === "to" ? { ...refusal, position: index } : refusal
    )
  );
  const failure = success
    ? undefined
    : combinedFailure(outcomes.map(outcome => outcome.failure));
  return {
    success,
    ...(messageId !== undefined ? { messageId } : {}),
    ...(failure ? { failure } : {}),
    ...(refused.length > 0 ? { refused } : {}),
  };
}
