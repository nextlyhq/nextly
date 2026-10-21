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

import { type EmailDeliveryRecipientKind, mailboxOf } from "../delivery-record";
import { type EmailFailure, failureOf, unclassifiedFailure } from "../failure";
import type { EmailProviderAdapter } from "../types";

import type { RecipientOutcome } from "./recipient-outcomes";

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

/** The reason given when another send with the same key has not finished. */
const IN_PROGRESS_REASON = "A send with this idempotency key is in progress.";

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
  // Read defensively: a contributed provider is plain JavaScript at runtime,
  // and an entry without a string address names nobody.
  const entries: unknown[] = Array.isArray(result.refusals)
    ? result.refusals
    : [];
  const entry = entries.find(
    refusal =>
      typeof (refusal as { address?: unknown } | null)?.address === "string" &&
      (refusal as { address: string }).address.trim().toLowerCase() === key
  );
  const classified = entry ? failureOf({ emailFailure: entry }) : undefined;
  return classified ?? { retryable: true, reason: REFUSED_REASON };
}

/**
 * Every refused recipient of a message, by line and position.
 *
 * Positions are counted on each line as the message gives it, duplicates
 * included, so a caller matching a refusal to its own list by position finds
 * the address it wrote. A mailbox on several lines, or twice on one, is
 * reported once, where it first appears, as it is recorded once.
 */
export function refusedRecipients(
  message: {
    to: readonly string[];
    cc?: readonly string[];
    bcc?: readonly string[];
  },
  refused: ReadonlySet<string>,
  result: AdapterResult
): RefusedRecipient[] {
  const seen = new Set<string>();
  const list: RefusedRecipient[] = [];
  const lines: Array<[EmailDeliveryRecipientKind, readonly string[]]> = [
    ["to", message.to],
    ["cc", message.cc ?? []],
    ["bcc", message.bcc ?? []],
  ];
  for (const [kind, addresses] of lines) {
    addresses.forEach((address, position) => {
      const key = mailboxOf(address).toLowerCase();
      if (key === "" || seen.has(key)) return;
      seen.add(key);
      if (!refused.has(key)) return;
      const { retryable, status } = refusalOf(result, mailboxOf(address));
      list.push({
        kind,
        position,
        retryable,
        ...(status !== undefined ? { status } : {}),
      });
    });
  }
  return list;
}

/**
 * Why a message the provider answered did not reach the caller's `to`: the
 * first retryable refusal of a `to` recipient, else the first refusal, or,
 * when the provider answered that it did not send at all, an unclassified
 * failure. Retryable whenever any refused `to` recipient can still be sent
 * to, as a split send's failures are combined.
 */
export function answeredFailure(
  result: AdapterResult,
  recipients: ReadonlyArray<{
    to: string;
    recipientKind: EmailDeliveryRecipientKind;
  }>,
  refused: ReadonlySet<string>
): EmailFailure {
  // A refused `to` recipient's own classification first, whether or not the
  // provider also answered that it did not send: it is the more specific
  // fact, and the result's `refused` entry for it says the same.
  const primaries = recipients.filter(
    recipient =>
      recipient.recipientKind === "to" &&
      refused.has(recipient.to.trim().toLowerCase())
  );
  const refusal = combinedFailure(
    primaries.map(primary => refusalOf(result, primary.to))
  );
  if (refusal) return refusal;
  return result.success !== true ? notAcceptedFailure() : unclassifiedFailure();
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
 * One failure for a send split into several messages: the first retryable
 * one when any is, since a retry is what reaches the recipients whose message
 * can still go, and otherwise the first. Taken whole, so its status and reason
 * describe the same failure its `retryable` does.
 */
export function combinedFailure(
  failures: ReadonlyArray<EmailFailure | undefined>
): EmailFailure | undefined {
  const present = failures.filter(
    (failure): failure is EmailFailure => failure !== undefined
  );
  return present.find(failure => failure.retryable) ?? present[0];
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
  /**
   * @experimental The result came from an earlier send with the same
   * idempotency key, and nothing was sent this time.
   */
  repeat?: true;
  /**
   * @experimental Some recipients were accepted and the send still did not
   * succeed. Present only then, beside `recipients`.
   */
  partlyDelivered?: true;
  /**
   * @experimental Each recipient's outcome by line and position, listed only
   * for a partly delivered send.
   */
  recipients?: RecipientOutcome[];
}

/**
 * The failure for a send whose key another send holds: nothing was sent, and
 * a retry returns that send's result once it has one.
 */
export function inProgressFailure(): EmailFailure {
  return { retryable: true, reason: IN_PROGRESS_REASON };
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
