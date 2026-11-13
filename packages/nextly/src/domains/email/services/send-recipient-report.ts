/**
 * A send's final recipients: which the caller excluded, and what became of
 * each of the rest, by address in memory only.
 *
 * - **Excluded after the filters.** `excludeRecipients` names mailboxes by
 *   the caller's own keyed digest, and is compared with the envelope that
 *   `email.beforeSend` filters returned, so a recipient a filter adds is
 *   excluded as surely as one the caller wrote. A recipient left out is
 *   reported `skipped`.
 * - **Copies alone.** When every `to` is excluded and copies remain, each
 *   copy gets a message of its own with itself as the only `to`: every
 *   message needs a valid To, an excluded `to` must not get it again, and a
 *   blind copy must never be shown to another.
 * - **Reported by place.** What became of each recipient comes from the
 *   per-place outcomes the send already works out (`recipient-outcomes`),
 *   mapped back to the envelope's addresses.
 *
 * @module domains/email/services/send-recipient-report
 */

import { z } from "zod";

import { NextlyError } from "../../../errors";
import type { EmailDeliveryRecipientKind } from "../delivery-record";
import {
  comparableMailbox,
  type FinalRecipient,
  type RecipientDigester,
} from "../queued-send-changes";

import type { RecipientOutcome } from "./recipient-outcomes";
import type { SendEnvelope } from "./recipients";
import type { EmailSendOutcome } from "./send-failures";

const LINES = ["to", "cc", "bcc"] as const;

/** At most this many digests in one `excludeRecipients`. */
const MAX_EXCLUDED = 1000;

const EXCLUDED = z.array(z.string().min(1).max(128)).max(MAX_EXCLUDED);

/** What leaving out the excluded recipients made of an envelope. */
export interface Excluded {
  /** What is sent; with no `to` and no copy, nothing is. */
  envelope: SendEnvelope;
  /** The recipients left out, reported `skipped`. */
  skipped: FinalRecipient[];
  /**
   * Each remaining copy as a `to` of its own, sent one message each, by
   * mailbox to the line it was on.
   */
  alone?: Map<string, EmailDeliveryRecipientKind>;
}

/**
 * Check `excludeRecipients` as a send is handed it. Refused with a person,
 * whose address is theirs alone, and for a caller with no digest key.
 */
export function checkedExclusions(
  excluded: unknown,
  context: { namesPerson: boolean; digester: RecipientDigester | undefined }
): ReadonlySet<string> | undefined {
  if (excluded === undefined) return undefined;
  const parsed = EXCLUDED.safeParse(excluded);
  const problem = !parsed.success
    ? `\`excludeRecipients\` is a list of at most ${MAX_EXCLUDED} recipient digests.`
    : context.namesPerson
      ? "`excludeRecipients` cannot be combined with `person`."
      : !context.digester
        ? "`excludeRecipients` is offered to plugins, whose digests it compares."
        : undefined;
  if (problem !== undefined || !parsed.success) {
    throw NextlyError.validation({
      errors: [
        {
          path: "excludeRecipients",
          code: "INVALID",
          message: problem ?? "",
        },
      ],
    });
  }
  return new Set(parsed.data);
}

/** The envelope without the recipients whose digest `excluded` holds. */
export async function leaveOutExcluded(
  envelope: SendEnvelope,
  excluded: ReadonlySet<string>,
  digester: RecipientDigester
): Promise<Excluded> {
  const skipped: FinalRecipient[] = [];
  const kept: Record<EmailDeliveryRecipientKind, string[]> = {
    to: [],
    cc: [],
    bcc: [],
  };
  for (const kind of LINES) {
    for (const address of lineOf(envelope, kind)) {
      if (excluded.has(await digester(comparableMailbox(address)))) {
        skipped.push({ address, kind, outcome: "skipped" });
      } else {
        kept[kind].push(address);
      }
    }
  }
  if (kept.to.length > 0) {
    return {
      envelope: { ...envelope, to: kept.to, cc: kept.cc, bcc: kept.bcc },
      skipped,
    };
  }
  // No `to` left: each copy alone, once per mailbox.
  const alone = new Map<string, EmailDeliveryRecipientKind>();
  const to: string[] = [];
  for (const kind of ["cc", "bcc"] as const) {
    for (const address of kept[kind]) {
      const mailbox = comparableMailbox(address);
      if (alone.has(mailbox)) continue;
      alone.set(mailbox, kind);
      to.push(address);
    }
  }
  return { envelope: { ...envelope, to, cc: [], bcc: [] }, skipped, alone };
}

function lineOf(
  envelope: Pick<SendEnvelope, "to" | "cc" | "bcc">,
  kind: EmailDeliveryRecipientKind
): readonly string[] {
  return kind === "to" ? envelope.to : (envelope[kind] ?? []);
}

/**
 * Every final recipient with what became of it, from the per-place outcomes
 * of `envelope`, the copies sent alone put back on their own line, and the
 * excluded ones after them. A mailbox on two lines is listed once.
 */
export function finalRecipients(
  envelope: SendEnvelope,
  outcomes: readonly Pick<RecipientOutcome, "kind" | "position" | "outcome">[],
  excluded?: Pick<Excluded, "skipped" | "alone">
): FinalRecipient[] {
  const seen = new Set<string>();
  const listed: FinalRecipient[] = [];
  for (const { kind, position, outcome } of outcomes) {
    const address = lineOf(envelope, kind)[position];
    if (address === undefined) continue;
    const mailbox = comparableMailbox(address);
    if (seen.has(mailbox)) continue;
    seen.add(mailbox);
    const line = excluded?.alone?.get(mailbox) ?? kind;
    listed.push({ address, kind: line, outcome });
  }
  return [...listed, ...(excluded?.skipped ?? [])];
}

/**
 * Every recipient of `envelope` by place, as an earlier send with the key
 * left it: the outcomes it listed, else accepted unless refused.
 */
export function repeatedOutcomes(
  envelope: SendEnvelope,
  earlier: EmailSendOutcome
): Array<Pick<RecipientOutcome, "kind" | "position" | "outcome">> {
  if (earlier.recipients) return earlier.recipients;
  const refused = new Set(
    (earlier.refused ?? []).map(({ kind, position }) => `${kind}:${position}`)
  );
  return everyPlace(envelope).map(({ kind, position }) => ({
    kind,
    position,
    outcome: refused.has(`${kind}:${position}`) ? "refused" : "accepted",
  }));
}

/** Every recipient of `envelope` by place, as unknown. */
export function unknownOutcomes(
  envelope: SendEnvelope
): Array<Pick<RecipientOutcome, "kind" | "position" | "outcome">> {
  return everyPlace(envelope).map(place => ({ ...place, outcome: "unknown" }));
}

function everyPlace(
  envelope: SendEnvelope
): Array<{ kind: EmailDeliveryRecipientKind; position: number }> {
  return LINES.flatMap(kind =>
    lineOf(envelope, kind).map((_, position) => ({ kind, position }))
  );
}
