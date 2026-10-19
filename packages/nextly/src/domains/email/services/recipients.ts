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
import type { EmailRecipient } from "../../../filters/seams";
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
  const given: unknown[] = (typeof to === "string" ? [to] : [...to]).flatMap(
    commaJoined
  );
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
 * A local part, `@`, and a domain, the forms RFC 5321 allows for each.
 *
 * The local part is either a quoted string (`"Joe,Smith"`), which may hold any
 * character but an unescaped quote or a line break, or dot-separated atoms of
 * text without whitespace or a separator; an apostrophe is text (`o'brien`).
 * The domain is either an address literal in brackets (`[192.0.2.1]`) or
 * dot-separated labels likewise. Atoms and labels are never empty, so a
 * leading, trailing or doubled dot is refused (`.a@x`, `a..b@x`, `a@x..y`).
 */
const MAILBOX =
  /^(?:"(?:[^"\\\r\n]|\\.)*"|[^\s@,;".<>()[\]\\]+(?:\.[^\s@,;".<>()[\]\\]+)*)@(?:\[[^[\]\s\\]+\]|[^\s@,;".<>()[\]\\]+(?:\.[^\s@,;".<>()[\]\\]+)*)$/;

/**
 * The first `to` address a caller gave, for what renders for one recipient.
 *
 * Taken from the same list a send is dispatched to, so a comma-joined string
 * renders as its first address rather than as the whole string.
 */
export function firstAddress(to: string | readonly string[]): string {
  const [first] = toAddressList(to);
  return typeof first === "string" ? first : "";
}

/**
 * Every `to` address of a message as an adapter is handed it: `toList` when
 * the message has several, else the one `to`.
 */
export function messageToAddresses(options: {
  to: string;
  toList?: string[];
}): string[] {
  return options.toList ?? [options.to];
}

/**
 * Whether a value is an address a message can be sent to.
 *
 * Checked as a mailbox: the part in angle brackets when there is a display
 * name, else the whole value. It must have exactly one `@` outside a quoted
 * local part, a local part and a domain, and no whitespace or separator outside
 * a quoted local part or an address literal. Not a deliverability check, which
 * stays the provider's: a dotless domain passes, so `dev@localhost` and
 * `Name <user@example.com>` stay sendable.
 */
export function isSendableAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // One address, not a list: a second mailbox would be read as this one's
  // display name, and only the last would be checked, counted or recorded.
  if (splitAddressList(value).length !== 1) return false;
  const brackets = unquoted(value).match(/[<>]/g) ?? [];
  if (brackets.length !== 0 && brackets.join("") !== "<>") return false;
  return MAILBOX.test(mailboxOf(value));
}

/**
 * `value` with every quoted string blanked out, so `<`, `>` and `,` inside a
 * quoted display name or local part are not read as structure.
 */
function unquoted(value: string): string {
  return value.replace(/"(?:[^"\\]|\\.)*"/g, match => " ".repeat(match.length));
}

/**
 * `value` split at each comma that is outside a quoted string and outside
 * angle brackets: the addresses of an address list, trimmed.
 */
function splitAddressList(value: string): string[] {
  const blanked = unquoted(value);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < blanked.length; i++) {
    const char = blanked[i];
    if (char === "<") depth++;
    else if (char === ">") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

/**
 * A string of addresses joined by commas, as the list it names.
 *
 * SMTP sends such a string to every address in it, so a caller may already
 * pass one; reading it as a list keeps that working, on every provider, and
 * lets each address be checked, counted and recorded. Commas inside a quoted
 * display name (`"Doe, Jane" <jane@example.com>`) or angle brackets do not
 * split. A list with a part that is not an address is left whole, and then
 * refused as not one address.
 */
function commaJoined(value: unknown): unknown[] {
  if (typeof value !== "string") return [value];
  const parts = splitAddressList(value);
  return parts.length > 1 && parts.every(part => isSendableAddress(part))
    ? parts
    : [value];
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
 * `to` is the one field a handler changes recipients through, so a chain of
 * handlers always reads the recipients the one before it left. A key the
 * handler left out is not a change: the message still goes to the recipients
 * it was given, as it did before this list was checked.
 */
export function filteredToList(
  given: Pick<EmailPayloadFilterValue, "to">,
  returned: Partial<Pick<EmailPayloadFilterValue, "to">>
): unknown[] {
  const to = "to" in returned ? returned.to : given.to;
  return Array.isArray(to) ? [...to] : [to];
}

/**
 * Every recipient of an envelope, `to` then `cc` then `bcc`, as the email
 * seams give it to handlers.
 *
 * The one derivation both seams use, so the list a filter reads and the list
 * an action reads cannot be built two ways. Entries that are not strings are
 * left out: a filter's result is plain data until it has been checked.
 */
export function recipientsOf(envelope: {
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
}): EmailRecipient[] {
  const list = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [value]).filter(
      (address): address is string => typeof address === "string"
    );
  return [
    ...list(envelope.to).map(address => ({ address, kind: "to" as const })),
    ...list(envelope.cc).map(address => ({ address, kind: "cc" as const })),
    ...list(envelope.bcc).map(address => ({ address, kind: "bcc" as const })),
  ];
}

/**
 * The most `to` addresses one send may have, whatever the provider.
 *
 * A send through a provider that takes one `to` per message becomes one
 * provider call per address, so without a ceiling one request could fan out
 * into thousands of calls, delivery records and actions. Bulk sending is not
 * what this method is for; 100 is the number of recipients RFC 5321 requires
 * every SMTP server to accept for one message.
 */
export const MAX_TO_PER_SEND = 100;

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

  if (to.length > MAX_TO_PER_SEND) {
    refuse(
      "to",
      "TOO_MANY",
      `An email can have at most ${MAX_TO_PER_SEND} \`to\` addresses; the send has ${to.length}.`
    );
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
 * address receives the email once. A copied address that is also a `to`
 * address is left off the copies, since it has a message of its own.
 */
export function messagesFor(
  envelope: SendEnvelope,
  maxToPerMessage: number | undefined
): SendMessage[] {
  if (envelope.to.length <= 1 || (maxToPerMessage ?? 1) > 1) {
    return [envelope];
  }
  const addressed = new Set(
    envelope.to.map(address => mailboxOf(address).toLowerCase())
  );
  const copies = (list: string[] | undefined): string[] | undefined => {
    if (list === undefined) return undefined;
    return list.filter(
      address => !addressed.has(mailboxOf(address).toLowerCase())
    );
  };
  const cc = copies(envelope.cc);
  const bcc = copies(envelope.bcc);
  return envelope.to.map((address, index) => ({
    ...envelope,
    to: [address],
    cc: index === 0 ? cc : undefined,
    bcc: index === 0 ? bcc : undefined,
  }));
}
