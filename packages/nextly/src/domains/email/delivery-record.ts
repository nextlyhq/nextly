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

import { createHmac, createHash } from "crypto";

import { env } from "../../lib/env";

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
 * KEYED rather than salted. The distinction is the whole point: a per-row salt
 * would make the column unmatchable by the one query it exists to serve — hash
 * the address you were given, look for it — while a per-install key leaves
 * that query working exactly as before, because the same address under the
 * same key is the same digest.
 *
 * A bare digest does not make this column anonymous. An email address carries
 * far too little entropy to resist an offline dictionary, so anyone holding
 * the table can confirm whether a given person was written to, and can
 * enumerate common addresses at leisure. That is pseudonymised data, not
 * anonymised data, and it keeps every identity obligation the hash was
 * supposed to remove. The key is what the holder of a stolen table does not
 * have.
 *
 * `NEXTLY_SECRET` is required in production and validated at env parse, so the
 * unkeyed branch below is reachable only in development and test — where there
 * is no stolen-table threat, and where refusing would leave a contributor
 * unable to record anything.
 */
export function hashRecipient(address: string): string {
  const mailbox = address.trim().toLowerCase();
  const key = env.NEXTLY_SECRET;

  return key === undefined
    ? createHash("sha256").update(mailbox).digest("hex")
    : createHmac("sha256", key).update(mailbox).digest("hex");
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
 * Identifiers this will keep, by SHAPE rather than by inspecting them.
 *
 * A provider is install-supplied code holding the decrypted configuration and
 * the whole message, so the identifier it hands back can be built out of
 * anything it was given. Two of those risks can be checked exactly, because
 * the values are known: the recipients, and the credentials the descriptor
 * declares. The third cannot — "does this string contain part of the body" has
 * no exact form, only heuristics, and a heuristic over an unbounded input
 * space has a next gap by construction.
 *
 * So the third question is not asked. An identifier is kept only if it is
 * SHAPED like one, and a value built out of the message will not be:
 *
 * - **RFC 5322 Message-ID** — `<local@domain>`, which is what every SMTP
 *   server and `nodemailer` return.
 * - **UUID** — what Resend's API returns as the email id.
 * - **A short opaque token** — at most 24 characters of letters, digits, dot,
 *   dash and underscore. Short enough that it cannot carry a credential worth
 *   stealing (an API key is 32 characters and up), no `@` so it cannot carry
 *   an address, no `+/=` so it cannot be base64, no space so it cannot be
 *   prose. This is the shape a provider with its own id scheme uses.
 *
 * The trade, stated plainly because it is a real cost: a provider whose
 * identifier is neither shape loses its correlation with its own dashboard.
 * That is deliberate. Core cannot verify that an unrecognised shape carries
 * nothing from the message, and a delivery row is read by more people than the
 * message was sent to.
 */
const RFC5322_MESSAGE_ID =
  /^<[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9!#$%&'*+/=?^_`{|}~.[\]-]+>$/;

const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Bounded deliberately. The length is what makes this shape safe rather than
 * the charset: 24 characters is below any credential worth taking, and a token
 * derived from the message would have to be shorter than the thing it came
 * from to fit.
 */
const SHORT_OPAQUE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/;

/**
 * Longest identifier worth considering.
 *
 * RFC 5322 caps a header line at 998 octets, so anything past it is not a
 * Message-ID whatever it looks like.
 */
const MAX_MESSAGE_ID_LENGTH = 998;

/**
 * The mailbox out of an address a caller may have written with a display name.
 *
 * `Display Name <user@example.com>` is dispatched to `user@example.com`, and
 * that is the form this table hashes. A reader handing back the address as
 * they wrote it must be hashed the same way or the lookup answers "no record"
 * for a message that was sent.
 *
 * The LAST angle-bracketed group is taken, which is where RFC 5322 puts the
 * address; a display name containing brackets is pathological and falls back
 * to the whole string rather than guessing.
 */
export function mailboxOf(address: string): string {
  const trimmed = address.trim();
  const angled = /<([^<>]*)>\s*$/.exec(trimmed);
  return (angled?.[1] ?? trimmed).trim();
}

/**
 * The mailbox out of whatever a provider reports as a refused recipient.
 *
 * `rejected` is provider-supplied, and nodemailer reports either a plain
 * string or an envelope-style object depending on how the message was
 * addressed — so a provider forwarding its transport's array untouched hands
 * over objects. Narrowed rather than assumed: reading `.trim()` off one throws
 * AFTER the provider has already sent, turning a delivered message into a
 * failure.
 *
 * An entry that carries no address yields `""`, which matches nothing and so
 * refuses nobody. That is the safe direction here — the alternative is
 * treating an unreadable entry as a refusal of some recipient it does not
 * name.
 */
export function refusedMailbox(entry: unknown): string {
  if (typeof entry === "string") return mailboxOf(entry);
  if (entry !== null && typeof entry === "object" && "address" in entry) {
    const address = (entry as { address?: unknown }).address;
    if (typeof address === "string") return mailboxOf(address);
  }
  return "";
}

/**
 * Every mailbox a provider says it refused, lowercased.
 *
 * The COLLECTION is narrowed here as well as its entries. `rejected` is
 * provider-supplied and its declared type is a promise rather than a fact: a
 * hand-built provider reporting a single refusal as `rejected: "cc@x.test"`
 * made `.map` throw — after `adapter.send()` had already returned, and before
 * the marker that says a message was dispatched. The catch above then recorded
 * every recipient as failed and answered `{ success: false }` for a message
 * that reached its primary destination.
 *
 * A bare string is read as ONE refusal rather than discarded: a provider
 * writing it means a refusal, and dropping the signal would report a refused
 * recipient as delivered. Anything else yields nothing, because there is no
 * address in it to act on.
 */
export function refusedMailboxes(rejected: unknown): ReadonlySet<string> {
  const entries = Array.isArray(rejected)
    ? rejected
    : typeof rejected === "string"
      ? [rejected]
      : [];

  const mailboxes = new Set<string>();
  for (const entry of entries) {
    const mailbox = refusedMailbox(entry).toLowerCase();
    if (mailbox !== "") mailboxes.add(mailbox);
  }
  return mailboxes;
}

/**
 * Whether a provider's identifier is one of the shapes core recognises.
 *
 * Exported so both send paths ask the same question; a shape rule enforced in
 * one of them is a shape rule the other does not have.
 */
export function isRecognisedMessageId(messageId: unknown): boolean {
  // `unknown`, not `string | undefined`. A JavaScript plugin or a hand-built
  // provider is not bound by the adapter's declared return type, and `null` is
  // the natural way to say "accepted, no identifier" -- which reached
  // `null.length` and threw on the send path, turning an accepted message into
  // a provider failure.
  if (typeof messageId !== "string") return false;
  if (messageId.length > MAX_MESSAGE_ID_LENGTH) return false;
  return (
    RFC5322_MESSAGE_ID.test(messageId) ||
    UUID.test(messageId) ||
    SHORT_OPAQUE_TOKEN.test(messageId)
  );
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
  mailboxes: readonly string[],
  /**
   * Other values this message carried that the caller did not choose to
   * publish — today, the filenames of its attachments.
   *
   * An adapter is handed the attachments alongside the recipients, so an
   * identifier can be built out of a filename as easily as out of an address,
   * and a filename is often the most identifying thing in a message:
   * `2026-tax-return-mobeen.pdf` says more than the body does. Known values,
   * so this is the same exact comparison the mailboxes get rather than a guess
   * about the shape of the id.
   */
  literals: readonly string[] = []
): string | null {
  if (messageId === undefined) return null;
  const haystack = messageId.toLowerCase();

  // Long enough to mean something. A filename of three characters matches too
  // much, exactly as a short local part does.
  const carriesLiteral = literals.some(literal => {
    const needle = literal.trim().toLowerCase();
    return needle.length > 3 && haystack.includes(needle);
  });
  if (carriesLiteral) return null;

  // The whole mailbox AND its local part. A provider building an identifier
  // out of an address rarely keeps the domain -- `id-hidden-auditor` is the
  // natural thing to write -- and the local part is the identifying half: an
  // `email.beforeSend` filter can add a BCC the caller never wrote, so the
  // domain may be shared with everyone while the local part names the person.
  //
  // Still an exact comparison against values that are KNOWN, not a guess about
  // the shape of the id. A local part of three characters or fewer is skipped:
  // it matches too much to mean anything, and dropping every id that happens
  // to contain `bob` would cost the field for nothing.
  const carriesOne = mailboxes.some(mailbox => {
    const needle = mailbox.trim().toLowerCase();
    if (needle === "") return false;
    if (haystack.includes(needle)) return true;

    const localPart = needle.slice(0, needle.lastIndexOf("@"));
    return localPart.length > 3 && haystack.includes(localPart);
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
