/**
 * What happened to each recipient of a send, by the line and position each
 * holds in the envelope the caller's send produced.
 *
 * A send can reach some of its recipients and not others: split into one
 * message per `to` for a provider that takes one, or refused per recipient by
 * an SMTP server. Positions in the envelope are what an identical retry with
 * the same key reproduces, whatever provider carries it and however that
 * provider groups recipients into calls, so a keyed retry is sent only to the
 * positions not yet accepted, and its result is built from the outcomes of
 * both attempts.
 *
 * Positions name no address, so they can be kept on a send's claim.
 *
 * @module domains/email/services/recipient-outcomes
 */

import { type EmailDeliveryRecipientKind, mailboxOf } from "../delivery-record";
import type { EmailFailure } from "../failure";

import type { SendEnvelope, SendMessage } from "./recipients";
import {
  combinedFailure,
  type EmailSendOutcome,
  type RefusedRecipient,
  splitSendOutcome,
} from "./send-failures";

/** What became of one recipient. */
export type RecipientOutcomeKind = "accepted" | "refused" | "unknown";

/**
 * @experimental One recipient's outcome, by line and position, never by
 * address. `refused` is a definite refusal, of the recipient or of the whole
 * message; `unknown` is a call that ended without a definite answer, which a
 * retry may find was delivered after all.
 */
export interface RecipientOutcome {
  kind: EmailDeliveryRecipientKind;
  position: number;
  outcome: RecipientOutcomeKind;
  retryable?: boolean;
  status?: number;
}

/** Where a recipient sits in the envelope, as a claim stores it. */
export function recipientSlot(
  kind: EmailDeliveryRecipientKind,
  position: number
): string {
  return `${kind}:${position}`;
}

const LINES = ["to", "cc", "bcc"] as const;

/** The envelope's recipients, line by line. */
function linesOf(envelope: {
  to: readonly string[];
  cc?: readonly string[];
  bcc?: readonly string[];
}): Record<EmailDeliveryRecipientKind, readonly string[]> {
  return { to: envelope.to, cc: envelope.cc ?? [], bcc: envelope.bcc ?? [] };
}

/**
 * The envelope without the recipients a previous attempt had accepted. With
 * none accepted it is the envelope itself, unchanged.
 */
export function pendingEnvelope(
  envelope: SendEnvelope,
  accepted: ReadonlySet<string>
): SendEnvelope {
  if (accepted.size === 0) return envelope;
  const keep = (kind: EmailDeliveryRecipientKind, list?: string[]) =>
    list?.filter((_, position) => !accepted.has(recipientSlot(kind, position)));
  return {
    ...envelope,
    to: keep("to", envelope.to) ?? [],
    cc: keep("cc", envelope.cc),
    bcc: keep("bcc", envelope.bcc),
  };
}

/** One mailbox's outcome in one call, before it is placed in the envelope. */
interface MailboxOutcome {
  outcome: RecipientOutcomeKind;
  failure?: EmailFailure;
  /** Refused on its own, as a provider reports per recipient. */
  refusal?: { retryable: boolean; status?: number };
}

/** What one call answered, as the send path learns it. */
export interface CallOutcome {
  message: SendMessage;
  outcome: EmailSendOutcome;
  /** The provider took the message: every recipient it did not refuse. */
  accepted: boolean;
  /**
   * A call still unsettled at its deadline: reported as without an answer,
   * and finished here, within `withinMs`, with what it answers then.
   */
  late?: (withinMs: number) => Promise<CallOutcome>;
}

/** Each mailbox of one call, with what became of it. */
function mailboxOutcomes(call: CallOutcome): Map<string, MailboxOutcome> {
  const lines = linesOf(call.message);
  const refused = new Map<string, RefusedRecipient>();
  for (const refusal of call.outcome.refused ?? []) {
    const address = lines[refusal.kind][refusal.position];
    if (address !== undefined) refused.set(mailboxKey(address), refusal);
  }
  const outcomes = new Map<string, MailboxOutcome>();
  for (const kind of LINES) {
    for (const address of lines[kind]) {
      const key = mailboxKey(address);
      if (key === "" || outcomes.has(key)) continue;
      outcomes.set(key, outcomeOf(call, refused.get(key)));
    }
  }
  return outcomes;
}

function outcomeOf(
  call: CallOutcome,
  refusal: RefusedRecipient | undefined
): MailboxOutcome {
  if (refusal) {
    const { retryable, status } = refusal;
    return {
      outcome: "refused",
      refusal: { retryable, ...(status !== undefined ? { status } : {}) },
      failure: call.outcome.failure,
    };
  }
  if (call.accepted) return { outcome: "accepted" };
  // Unknown only where the failure says delivery cannot be known: the request
  // may have reached the provider and its answer was lost. Anything else was
  // not delivered, by the provider's refusal or a call that never reached it.
  const failure = call.outcome.failure;
  return { outcome: failure?.unknown ? "unknown" : "refused", failure };
}

function mailboxKey(address: string): string {
  return mailboxOf(address).trim().toLowerCase();
}

/**
 * The outcome of every recipient of `envelope`: accepted where a previous
 * attempt left it accepted, else what the calls of this attempt answered.
 */
export function envelopeOutcomes(
  envelope: SendEnvelope,
  previouslyAccepted: ReadonlySet<string>,
  calls: readonly CallOutcome[]
): Array<RecipientOutcome & { failure?: EmailFailure; refusal?: boolean }> {
  const byMailbox = new Map<string, MailboxOutcome>();
  for (const call of calls) {
    for (const [key, value] of mailboxOutcomes(call)) {
      if (!byMailbox.has(key)) byMailbox.set(key, value);
    }
  }
  const lines = linesOf(envelope);
  return LINES.flatMap(kind =>
    lines[kind].map((address, position) => {
      if (previouslyAccepted.has(recipientSlot(kind, position))) {
        return { kind, position, outcome: "accepted" as const };
      }
      const found = byMailbox.get(mailboxKey(address));
      const outcome = found?.outcome ?? "unknown";
      const classified = found?.refusal ?? found?.failure;
      return {
        kind,
        position,
        outcome,
        ...(outcome !== "accepted" && classified
          ? {
              retryable: classified.retryable,
              ...(classified.status !== undefined
                ? { status: classified.status }
                : {}),
            }
          : {}),
        ...(found?.failure ? { failure: found.failure } : {}),
        ...(found?.refusal ? { refusal: true } : {}),
      };
    })
  );
}

/** Whether some recipients were accepted and the send still did not succeed. */
export function partlyDelivered(
  outcome: EmailSendOutcome,
  recipients: readonly RecipientOutcome[]
): boolean {
  return (
    !outcome.success &&
    recipients.some(recipient => recipient.outcome === "accepted")
  );
}

/**
 * The send's result from every recipient's outcome, for a keyed retry that
 * sent only to the recipients an earlier attempt had not reached: successful
 * when every `to` is accepted, its refusals and failure taken from the
 * recipients still not accepted.
 */
export function composedOutcome(
  recipients: ReadonlyArray<
    RecipientOutcome & { failure?: EmailFailure; refusal?: boolean }
  >,
  messageId: string | undefined
): EmailSendOutcome {
  const success = recipients
    .filter(recipient => recipient.kind === "to")
    .every(recipient => recipient.outcome === "accepted");
  const refused: RefusedRecipient[] = recipients
    .filter(recipient => recipient.refusal)
    .map(({ kind, position, retryable, status }) => ({
      kind,
      position,
      retryable: retryable ?? true,
      ...(status !== undefined ? { status } : {}),
    }));
  const failure = success
    ? undefined
    : combinedFailure(
        recipients
          .filter(
            recipient =>
              recipient.kind === "to" && recipient.outcome !== "accepted"
          )
          .map(recipient => recipient.failure)
      );
  return {
    success,
    ...(messageId !== undefined ? { messageId } : {}),
    ...(failure ? { failure } : {}),
    ...(refused.length > 0 ? { refused } : {}),
  };
}

/** The outcomes as a result lists them: no failure or refusal detail. */
export function listedOutcomes(
  recipients: ReadonlyArray<
    RecipientOutcome & { failure?: EmailFailure; refusal?: boolean }
  >
): RecipientOutcome[] {
  return recipients.map(({ kind, position, outcome, retryable, status }) => ({
    kind,
    position,
    outcome,
    ...(retryable !== undefined ? { retryable } : {}),
    ...(status !== undefined ? { status } : {}),
  }));
}

/**
 * The send's result, and the recipients now accepted, from what each call of
 * this attempt answered. A send with no earlier attempt keeps the result it
 * has always had, one message's as it is and a split send's combined, gaining
 * `partlyDelivered` and `recipients` only when it was partly delivered; a
 * keyed retry's is built from every recipient's outcome, the earlier
 * attempts' included.
 */
export function sendResultOf(
  envelope: SendEnvelope,
  previouslyAccepted: ReadonlySet<string>,
  calls: readonly CallOutcome[]
): { outcome: EmailSendOutcome; accepted: string[] } {
  const recipients = envelopeOutcomes(envelope, previouslyAccepted, calls);
  const outcomes = calls.map(call => call.outcome);
  const base =
    previouslyAccepted.size > 0
      ? composedOutcome(
          recipients,
          outcomes.find(outcome => outcome.messageId !== undefined)?.messageId
        )
      : outcomes.length === 1
        ? outcomes[0]
        : splitSendOutcome(outcomes);
  const outcome = partlyDelivered(base, recipients)
    ? {
        ...base,
        partlyDelivered: true as const,
        recipients: listedOutcomes(recipients),
      }
    : base;
  const accepted = recipients
    .filter(recipient => recipient.outcome === "accepted")
    .map(recipient => recipientSlot(recipient.kind, recipient.position));
  return { outcome, accepted };
}
