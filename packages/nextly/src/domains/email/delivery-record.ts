/**
 * What a delivery log row is allowed to know about a message.
 *
 * The table stores a hash of the recipient rather than the address, so that it
 * answers "did this send" and "how many failed" without answering "to whom".
 * That decision is only worth anything if EVERY value written beside the hash
 * respects it, and the one that does not respect it by default is the error
 * string: a mail server quotes the recipient back at you when it rejects them.
 *
 * @module domains/email/delivery-record
 */

import { createHash } from "crypto";

/** How a delivery ended. A drain would add `pending` and `retrying`. */
export type EmailDeliveryStatus = "sent" | "failed";

/**
 * How a recipient received the message.
 *
 * A copied recipient received it as much as the primary one did, and the table
 * exists to answer "did this person receive it" — so each gets a row, and this
 * says which line of the envelope they were on.
 */
export type EmailDeliveryRecipientKind = "to" | "cc" | "bcc";

/**
 * Hash a recipient address for storage.
 *
 * Lowercased and trimmed first so the same mailbox hashes identically however
 * it was typed — without that, support hashing the address they were given
 * would miss a row written from a differently-cased copy of it, and the column
 * would silently answer "no record" for a message that was sent.
 *
 * The local part of an address is technically case-sensitive per RFC 5321, and
 * this normalises it anyway: no mail provider in practice treats `A@x.com` and
 * `a@x.com` as different mailboxes, and matching what operators believe is
 * worth more here than matching what the RFC permits.
 *
 * Not salted, deliberately. A salt would make the hash unmatchable by the one
 * query it exists to serve — hash the address you were given, look for it —
 * and the threat it would defend against, an attacker enumerating addresses
 * against a stolen table, requires the database to be lost already, at which
 * point the same attacker has the users table with the addresses in it.
 */
export function hashRecipient(address: string): string {
  return createHash("sha256")
    .update(address.trim().toLowerCase())
    .digest("hex");
}

/**
 * Anything with an `@` in it, as a provider would quote it back.
 *
 * Deliberately broader than RFC 5321, in both halves of the address:
 *
 * - the local part may be QUOTED — `"odd user"@example.com` is valid and
 *   contains a space, so a pattern built from "non-whitespace" misses it;
 * - a quoted local part may contain QUOTED-PAIRS — `"odd\"user"@example.com`
 *   escapes a quote with a backslash, so a quoted alternative that stops at
 *   the first `"` ends mid-address and leaves `"odd\` in the stored text;
 * - the domain may be an ADDRESS LITERAL — `user@[192.0.2.1]` — and may have
 *   no dot at all, as `postmaster@localhost` does on the machines most likely
 *   to be running a local relay.
 *
 * Each of those was verified to pass through an earlier pattern untouched.
 *
 * The escape consumes any character except a line break, so an unterminated
 * quote cannot make the match run past the end of the line it started on.
 *
 * The asymmetry justifies the breadth: removing something that merely
 * resembles an address costs a slightly vaguer diagnostic, while missing one
 * puts the recipient in the column beside the hash that exists to avoid
 * storing it. A status code and a reason contain no `@` and are unaffected.
 */
const ADDRESS_SHAPED =
  /(?:"(?:\\[^\r\n]|[^"\\\r\n])*"|[^\s<>()[\]{},;:"]+)@(?:\[[^\]\r\n]*\]|[^\s<>()[\]{},;:"]+)/g;

/** The token an address is replaced with, so the shape of the error survives. */
export const REDACTED_ADDRESS = "[address]";

/**
 * Remove addresses from a provider's failure message.
 *
 * `550 5.1.1 <someone@example.com> User unknown` is the normal shape of an SMTP
 * rejection, and storing it verbatim would reintroduce the recipient in the row
 * beside its own hash — undoing the whole point of hashing, in the place most
 * likely to be read.
 *
 * What survives is what the operator needs: the status code and the reason.
 */
export function redactAddresses(message: string): string {
  return message.replace(ADDRESS_SHAPED, REDACTED_ADDRESS);
}

/** Longest error text stored. Beyond this a provider is narrating, not failing. */
export const MAX_ERROR_LENGTH = 2000;

/**
 * Prepare a failure message for storage: addresses removed, length bounded.
 *
 * Bounded because a provider that returns a full HTML error page would
 * otherwise put it in every row of a failing batch, and because an unbounded
 * text column is how a log table becomes the largest thing in the database.
 */
export function storableError(message: string): string {
  const redacted = redactAddresses(message);
  return redacted.length > MAX_ERROR_LENGTH
    ? `${redacted.slice(0, MAX_ERROR_LENGTH)}…`
    : redacted;
}

/** One delivery, as the recorder is told about it. */
export interface EmailDeliveryInput {
  /** The address the message went to. Hashed here; never stored. */
  to: string;
  /** Which line of the envelope carried that address. Defaults to `to`. */
  recipientKind?: EmailDeliveryRecipientKind;
  /** The provider row that carried it, when a stored provider did. */
  providerId?: string | null;
  /** The registered type, kept even after the provider is gone. */
  providerType: string;
  /** Which template produced it, when one did. Never the rendered subject. */
  templateSlug?: string | null;
  status: EmailDeliveryStatus;
  /** The provider's own message id, when it returned one. */
  messageId?: string | null;
  /** Why it failed. Redacted and bounded before storage. */
  error?: string | null;
}
