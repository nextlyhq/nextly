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

/**
 * The retention class every delivery row is written with.
 *
 * Supplied by the writer rather than defaulted in the column. A string default
 * reaches an existing installation through the core reconciler, which renders
 * a column's default into DDL verbatim -- `DEFAULT email`, which PostgreSQL and
 * MySQL read as an identifier and refuse, so the table that upgrade was meant
 * to add is never created. The value belongs to one writer, so naming it here
 * costs nothing and keeps the column free of a clause that cannot survive the
 * trip.
 */
export const EMAIL_RETENTION_CLASS = "email";

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
  // The ellipsis is part of the budget, not an addition to it. Slicing to the
  // full limit and then appending would return one character MORE than the
  // exported bound, for every truncated error -- and the bound is what a
  // caller sizing a column or a display from this constant would trust.
  return redacted.length > MAX_ERROR_LENGTH
    ? `${redacted.slice(0, MAX_ERROR_LENGTH - 1)}…`
    : redacted;
}

/**
 * The shortest candidate worth comparing against the message that was sent.
 *
 * Password-reset and verification tokens here are
 * `randomBytes(32).toString("hex")` — 64 characters — and a UUID is 36. Sixteen
 * catches both with room to spare while sitting above the words an identifier
 * and English prose legitimately share.
 */
const MIN_ECHOED_LENGTH = 16;

/**
 * Longest identifier this will inspect.
 *
 * RFC 5322 caps a header line at 998 octets, so a Message-ID longer than that
 * is not one. An identifier past this bound is withheld rather than examined:
 * it is already outside the contract, and refusing it costs a correlation
 * convenience while examining it invites a provider to hand us work to do.
 */
const MAX_INSPECTABLE_LENGTH = 998;

/**
 * Every distinctive piece of an identifier, as it is written.
 *
 * A token is not always one unbroken run: a UUID is five short groups, and a
 * segmented licence key is worse. Requiring a single long alphanumeric run
 * therefore missed exactly the values most likely to be sensitive.
 *
 * Candidates are runs of ORIGINAL text — spans of whole segments, separators
 * included — rather than the identifier with its punctuation stripped out.
 * Stripping makes unrelated neighbours adjacent, so an id ending
 * `@mail.example.test` would match any body containing `mail.example.test` in
 * any other punctuation, and ordinary ids would start disappearing. Comparing
 * spans as written keeps a match meaning "this exact text appears in both".
 *
 * Only the SHORTEST qualifying span per starting segment is produced, which is
 * what keeps this linear in the number of segments. Nothing is lost: a longer
 * span beginning at the same segment contains the shortest one as a prefix, so
 * if the long span appears in the message then the short one does too. Every
 * span is a substring of some candidate here, and every candidate is a
 * substring of the identifier -- the set of texts this can detect is
 * unchanged.
 */
function echoCandidates(messageId: string): string[] {
  const segments = messageId.split(/[^A-Za-z0-9]+/).filter(part => part !== "");
  if (segments.length === 0) return [];

  let cursor = 0;
  const offsets = segments.map(segment => {
    const at = messageId.indexOf(segment, cursor);
    cursor = at + segment.length;
    return at;
  });

  const candidates: string[] = [];
  for (let first = 0; first < segments.length; first += 1) {
    for (let last = first; last < segments.length; last += 1) {
      const end = offsets[last] + segments[last].length;
      if (end - offsets[first] < MIN_ECHOED_LENGTH) continue;
      candidates.push(messageId.slice(offsets[first], end));
      // The shortest span from this start is enough; a longer one from here
      // carries it as a prefix.
      break;
    }
  }
  return candidates;
}

/**
 * Whether a message id repeats something the message itself carried.
 *
 * An adapter is handed the subject, the HTML and the text alongside the
 * recipients, so a provider can build its identifier out of the BODY as easily
 * as out of an address — and the body of a password-reset message contains a
 * single-use token. That id is then returned to the caller, handed to every
 * after-send action, written to the process log and stored in the delivery
 * table, which turns a token with a short life into one sitting in a database
 * column.
 *
 * Asked in this direction on purpose. The id is short and the body is not, so
 * "does the id contain the body" answers nothing; what is detectable is a
 * distinctive piece OF the id turning up in what was sent.
 *
 * The trade is deliberate and one-sided: an id that shares sixteen characters
 * with the message is withheld even when the overlap is innocent — a hostname
 * the body also names, say. That costs a correlation convenience. Keeping it
 * costs a single-use token its single use.
 */
export function messageIdEchoesPayload(
  messageId: string | undefined,
  texts: ReadonlyArray<string | undefined>
): boolean {
  if (messageId === undefined) return false;
  // Past the bound this is not an identifier to be checked, it is a payload to
  // be refused. Fail closed, as everywhere else containment cannot answer.
  if (messageId.length > MAX_INSPECTABLE_LENGTH) return true;

  const candidates = echoCandidates(messageId);
  if (candidates.length === 0) return false;

  return texts.some(text => {
    if (text === undefined || text === "") return false;
    const haystack = text.toLowerCase();
    return candidates.some(candidate =>
      haystack.includes(candidate.toLowerCase())
    );
  });
}

/**
 * A provider's message id, unless it carries a recipient.
 *
 * The delivery table stores a hash of the recipient and never the address, and
 * that decision is only worth anything if EVERY column beside the hash
 * respects it. `messageId` is written by the provider, which was handed the
 * real address, so `delivery-user@example.com` is an id a provider could
 * plausibly return.
 *
 * Matched against the actual mailboxes rather than redacted by shape. An
 * RFC 5322 Message-ID is `<local@domain>`, so a rule built on "anything with
 * an @" would discard almost every legitimate id and protect nothing extra.
 *
 * Dropped rather than rewritten, for the reason the credential containment
 * gives: a partially rewritten identifier matches nothing while still looking
 * like one.
 */
export function messageIdWithoutRecipients(
  messageId: string | undefined,
  mailboxes: readonly string[]
): string | null {
  if (messageId === undefined) return null;
  const haystack = messageId.toLowerCase();
  const carriesOne = mailboxes.some(mailbox => {
    const needle = mailbox.trim().toLowerCase();
    return needle !== "" && haystack.includes(needle);
  });
  return carriesOne ? null : messageId;
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
