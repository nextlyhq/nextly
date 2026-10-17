/**
 * The recipients of a send: how a caller's `to` becomes the messages a
 * provider is handed, and the rules the envelope must satisfy first.
 *
 * Kept apart from `EmailService` so each rule has one implementation that the
 * service applies to the envelope an `email.beforeSend` filter returns, which
 * is the envelope that is sent.
 *
 * @module domains/email/services/recipients
 */

import { NextlyError } from "../../../errors";
import type { EmailPayloadFilterValue } from "../../../filters";
import { mailboxOf } from "../delivery-record";

/**
 * Every `to` address a caller gave, as a list.
 *
 * The same address twice is kept once, compared as a mailbox ignoring case, so
 * a message split per recipient does not send it twice. The first spelling is
 * the one kept.
 */
export function toAddressList(to: string | readonly unknown[]): unknown[] {
  // Elements are `unknown` because a filter handler's result is plain data at
  // runtime; `assertSendable` is what establishes they are addresses.
  const given: unknown[] = typeof to === "string" ? [to] : [...to];
  const seen = new Set<string>();
  const list: unknown[] = [];
  for (const address of given) {
    const key =
      typeof address === "string" ? mailboxOf(address).toLowerCase() : "";
    if (key !== "" && seen.has(key)) continue;
    if (key !== "") seen.add(key);
    list.push(address);
  }
  return list;
}

/**
 * Whether a value has the shape of an address a message can be sent to.
 *
 * A shape check, not a deliverability check: it refuses an empty value and one
 * with no local part or no domain, and leaves everything else to the provider,
 * as before. The domain is read after the LAST `@`, and a dotless domain is
 * accepted, so `dev@localhost` and a display-name form such as
 * `Name <user@example.com>` stay sendable.
 */
export function isSendableAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const mailbox = mailboxOf(value);
  const at = mailbox.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = mailbox.slice(at + 1);
  return domain !== "" && !/[\s<>]/.test(domain);
}

/** The envelope a send goes out with, once filters have run. */
export interface SendEnvelope {
  to: string[];
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
}

/** One message handed to a provider. */
export type SendMessage = SendEnvelope;

/**
 * The `to` list an `email.beforeSend` filter returned.
 *
 * A handler may change `to`, which every handler written before `toList`
 * existed does, or `toList`. A changed `to` wins; otherwise a changed `toList`
 * is used; otherwise the list given to the filter stands. Compared by value, so
 * a handler that rebuilds the payload with the same recipients changes none,
 * and a key the handler left out is not a change: the message still goes to the
 * recipients it was given, as it did before this list was checked.
 */
export function filteredToList(
  given: Pick<EmailPayloadFilterValue, "to" | "toList">,
  returned: Partial<Pick<EmailPayloadFilterValue, "to" | "toList">>
): unknown[] {
  if ("to" in returned && !sameRecipients(given.to, returned.to)) {
    return Array.isArray(returned.to) ? [...returned.to] : [returned.to];
  }
  if ("toList" in returned && !sameRecipients(given.toList, returned.toList)) {
    return Array.isArray(returned.toList)
      ? [...returned.toList]
      : [returned.toList];
  }
  return Array.isArray(given.to) ? [...given.to] : [given.to];
}

function sameRecipients(a: unknown, b: unknown): boolean {
  const left: unknown[] = Array.isArray(a) ? a : [a];
  const right: unknown[] = Array.isArray(b) ? b : [b];
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * Refuse an envelope that cannot be sent as asked, before any provider is
 * contacted.
 *
 * Every rule here is one a provider would otherwise decide in its own way, or
 * not at all: a list longer than it takes would be cut short or refused part
 * way through, and a person named on a send to several people would be
 * recorded against addresses that are not theirs.
 *
 * The public message of each refusal names the problem and, by position, the
 * address, never the address itself: a filter can add one the caller never
 * wrote, and the refusal travels back to that caller.
 */
export function assertSendable(
  to: readonly unknown[],
  rules: {
    /** The most `to` addresses the adapter takes in one message, if several. */
    maxToPerMessage?: number;
    /** Whether the send names a person (`person`). */
    namesPerson: boolean;
    /** The one `to` address the caller gave, for a send that names a person. */
    personAddress?: string;
  }
): asserts to is string[] {
  const refuse = (path: string, code: string, message: string): never => {
    throw NextlyError.validation({
      errors: [{ path, code, message }],
      logContext: { operation: "email.send", toCount: to.length },
    });
  };

  if (to.length === 0) {
    refuse("to", "REQUIRED", "An email needs at least one `to` address.");
  }

  to.forEach((address, index) => {
    if (!isSendableAddress(address)) {
      refuse(
        to.length === 1 ? "to" : `to.${index}`,
        "INVALID",
        to.length === 1
          ? "The `to` address is not a valid email address."
          : `The \`to\` address at position ${index} is not a valid email address.`
      );
    }
  });

  if (rules.namesPerson) {
    if (to.length > 1) {
      refuse(
        "person",
        "INVALID",
        "A send that names a person must have exactly one `to` address; copy anyone else with `cc` or `bcc`."
      );
    }
    if (
      rules.personAddress !== undefined &&
      mailboxOf(to[0] as string).toLowerCase() !==
        mailboxOf(rules.personAddress).toLowerCase()
    ) {
      refuse(
        "to",
        "INVALID",
        "The recipient of a send that names a person was changed before sending, so the person would be recorded against another address."
      );
    }
  }

  const max = rules.maxToPerMessage;
  if (max !== undefined && max > 1 && to.length > max) {
    refuse(
      "to",
      "TOO_MANY",
      `This email provider takes at most ${max} \`to\` addresses in one message; the send has ${to.length}.`
    );
  }
}

/**
 * The `to` limit an adapter declares, when it declares a usable one.
 *
 * A contributed adapter is plain JavaScript at runtime, so the declaration is
 * read defensively: anything but a whole number above 1 means the adapter takes
 * one `to` per message, which is how every adapter written before the
 * declaration is treated.
 */
export function declaredMaxTo(adapter: {
  maxToPerMessage?: unknown;
}): number | undefined {
  const value = adapter.maxToPerMessage;
  return typeof value === "number" && Number.isInteger(value) && value > 1
    ? value
    : undefined;
}

/**
 * The messages a send becomes for an adapter.
 *
 * One message to every `to` address for an adapter that declares it takes
 * several. Otherwise one message per `to` address, each recipient seeing only
 * themselves, with `cc` and `bcc` on the first message only so each copied
 * address receives the email once.
 */
export function messagesFor(
  envelope: SendEnvelope,
  maxToPerMessage: number | undefined
): SendMessage[] {
  if (envelope.to.length <= 1 || (maxToPerMessage ?? 1) > 1) {
    return [envelope];
  }
  return envelope.to.map((address, index) => ({
    ...envelope,
    to: [address],
    cc: index === 0 ? envelope.cc : undefined,
    bcc: index === 0 ? envelope.bcc : undefined,
  }));
}
