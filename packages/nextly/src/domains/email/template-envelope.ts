/**
 * A template's envelope: who a send says it is from, where replies go, and
 * who else is copied.
 *
 * - **From.** The display name may follow the send's variables
 *   (`{{shopName}} <shop@example.com>`); the address may not. A variable
 *   address would let template data choose the sender, which a provider
 *   refuses for an unverified domain and which invites spoofing.
 * - **Reply-To** may follow the send's variables (`{{customerEmail}}`). One
 *   that renders to something other than an address fails the send, as
 *   retrying cannot fix a template.
 * - **cc and bcc** are fixed addresses, added after the send's own. Never on
 *   a template its owner marks as carrying a secret: a bcc on a password reset
 *   would hand every reset link to whoever can edit templates.
 *
 * A field that uses no variables is sent exactly as stored, so a template
 * saved before any of this sends as it always did.
 *
 * @module domains/email/template-envelope
 */

import { NextlyError } from "../../errors";

import { mailboxOf } from "./delivery-record";
import { parseLiquid, renderLiquid } from "./services/liquid-engine";
import {
  displayNameAndMailbox,
  isSendableAddress,
  toAddressList,
} from "./services/recipients";

/** Whether a field uses Liquid: an output (`{{`) or a tag (`{%`). */
export function usesVariables(value: string): boolean {
  return value.includes("{{") || value.includes("{%");
}

/** A template's envelope fields as a save gives them; absent ones are unchanged. */
export interface TemplateEnvelopeInput {
  fromOverride?: string | null;
  replyTo?: string | null;
  cc?: unknown;
  bcc?: unknown;
}

/** The copies a save stores: trimmed, each address once, and null for none. */
export interface SavedCopies {
  cc?: string[] | null;
  bcc?: string[] | null;
}

type FieldError = { path: string; code: string; message: string };

/**
 * Check a template's envelope on save, and return its copies as they are
 * stored.
 *
 * Refuses a variable in the From address, From's name or a Reply-To that
 * Liquid can't read, a copy that is not one fixed address, and any copy on a
 * template that carries a secret. Only the fields the save gives are judged,
 * so saving a template's other fields never trips over what is already stored.
 *
 * @throws NextlyError VALIDATION_ERROR naming each field and what is wrong
 */
export function checkTemplateEnvelope(
  input: TemplateEnvelopeInput,
  rules: { carriesSecret: boolean }
): SavedCopies {
  const errors: FieldError[] = [];

  if (typeof input.fromOverride === "string") {
    errors.push(...fromProblems(input.fromOverride));
  }
  if (
    typeof input.replyTo === "string" &&
    usesVariables(input.replyTo) &&
    !parses(input.replyTo)
  ) {
    errors.push(liquidError("replyTo", "Reply-To", input.replyTo));
  }

  const saved: SavedCopies = {};
  for (const field of ["cc", "bcc"] as const) {
    if (input[field] === undefined) continue;
    const copies = copiesProblems(field, input[field], errors);
    if (copies && copies.length > 0 && rules.carriesSecret) {
      errors.push({
        path: field,
        code: "CARRIES_SECRET",
        message: `This template carries a secret, such as a reset or verification link, so it can't copy anyone with ${field}.`,
      });
    }
    saved[field] = copies && copies.length > 0 ? copies : null;
  }

  if (errors.length > 0) {
    throw NextlyError.validation({
      errors,
      logContext: { fields: errors.map(error => error.path) },
    });
  }
  return saved;
}

/** What is wrong with a From override that uses variables. */
function fromProblems(fromOverride: string): FieldError[] {
  if (!usesVariables(fromOverride)) return [];
  const { name, email } = displayNameAndMailbox(fromOverride);
  if (usesVariables(email)) {
    return [
      {
        path: "fromOverride",
        code: "VARIABLE_ADDRESS",
        message:
          "The From address can't use variables; only the name before it can, as in {{ shopName }} <shop@example.com>.",
      },
    ];
  }
  return parses(name) ? [] : [liquidError("fromOverride", "From", name)];
}

/**
 * A list of copies as stored, or null where it is not one; each problem is
 * added to `errors`.
 */
function copiesProblems(
  field: "cc" | "bcc",
  value: unknown,
  errors: FieldError[]
): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) {
    errors.push({
      path: field,
      code: "INVALID",
      message: `${field} must be a list of email addresses.`,
    });
    return null;
  }
  const copies: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry: unknown, index) => {
    const address = typeof entry === "string" ? entry.trim() : entry;
    if (typeof address === "string" && usesVariables(address)) {
      errors.push({
        path: `${field}.${index}`,
        code: "VARIABLE_ADDRESS",
        message: `A template's ${field} holds fixed addresses only, never variables.`,
      });
      return;
    }
    if (!isSendableAddress(address)) {
      errors.push({
        path: `${field}.${index}`,
        code: "INVALID",
        message: `The ${field} entry at position ${index} is not one email address.`,
      });
      return;
    }
    const key = mailboxOf(address).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    copies.push(address);
  });
  return copies;
}

function parses(source: string): boolean {
  return !("problem" in parseLiquid(source, "line"));
}

function liquidError(path: string, label: string, source: string): FieldError {
  const parsed = parseLiquid(source, "line");
  const problem = "problem" in parsed ? parsed.problem : null;
  const message = problem?.message ?? "Liquid can't read it";
  const sentence = /[.!?]$/.test(message) ? message : `${message}.`;
  return { path, code: "LIQUID_SYNTAX", message: `${label}: ${sentence}` };
}

// ============================================================
// At send time
// ============================================================

/**
 * The From a template's override sends: as stored when it uses no variables,
 * else its display name rendered from the send's data before its fixed
 * address.
 *
 * @throws NextlyError, not retryable, when the address uses a variable (a row
 *   written past the save-time check) or the name cannot be rendered
 */
export function renderTemplateFrom(
  fromOverride: string,
  data: Record<string, unknown>,
  slug: string
): string {
  if (!usesVariables(fromOverride)) return fromOverride;
  const { name, email } = displayNameAndMailbox(fromOverride);
  if (usesVariables(email)) {
    throw envelopeError(
      "fromOverride",
      "The email template's From address uses a variable, which only its name may.",
      slug
    );
  }
  const rendered = withoutControlCharacters(
    renderLiquid(unquotedName(name), data, "line")
  ).trim();
  return rendered === "" ? email : `${quotedName(rendered)} <${email}>`;
}

/**
 * The Reply-To a template sends: as stored when it uses no variables, else
 * rendered from the send's data. One that renders empty sets no Reply-To, so
 * a template can make it optional (`{% if email %}{{ email }}{% endif %}`).
 *
 * @throws NextlyError, not retryable, when it renders to something that is
 *   not exactly one address
 */
export function renderTemplateReplyTo(
  replyTo: string,
  data: Record<string, unknown>,
  slug: string
): string | undefined {
  if (!usesVariables(replyTo)) return replyTo;
  const rendered = renderLiquid(replyTo, data, "line").trim();
  if (rendered === "") return undefined;
  // Exactly one address, display name allowed. The rendered value comes from
  // the send's data, so a list would let that data add a second Reply-To the
  // template's author never wrote.
  if (!isSendableAddress(rendered)) {
    throw envelopeError(
      "replyTo",
      "The email template's Reply-To didn't render to an email address.",
      slug
    );
  }
  return rendered;
}

/**
 * A send's copies with a template's added after them. An address the send
 * already reaches (in `to`, `cc` or `bcc`) is not added again, and none is
 * added twice. Without template copies the send's own are returned as given.
 */
export function withTemplateCopies(
  send: { to: string | string[]; cc?: string[]; bcc?: string[] },
  template: { cc: string[] | null; bcc: string[] | null }
): { cc?: string[]; bcc?: string[] } {
  if (!template.cc?.length && !template.bcc?.length) {
    return { cc: send.cc, bcc: send.bcc };
  }
  const reached = new Set(
    [...toAddressList(send.to), ...(send.cc ?? []), ...(send.bcc ?? [])]
      .filter((address): address is string => typeof address === "string")
      .map(address => mailboxOf(address).toLowerCase())
  );
  const added = (list: string[] | null): string[] =>
    (list ?? []).filter(address => {
      const key = mailboxOf(address).toLowerCase();
      if (reached.has(key)) return false;
      reached.add(key);
      return true;
    });
  const cc = [...(send.cc ?? []), ...added(template.cc)];
  const bcc = [...(send.bcc ?? []), ...added(template.bcc)];
  return {
    cc: cc.length > 0 || send.cc ? cc : undefined,
    bcc: bcc.length > 0 || send.bcc ? bcc : undefined,
  };
}

/** The error a send fails with when a template's envelope can't be used. Retrying cannot fix it. */
function envelopeError(
  field: string,
  publicMessage: string,
  slug: string
): NextlyError {
  return new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage,
    // The rendered value stays out: it came from the send's data.
    logContext: {
      reason: "email-template-envelope",
      retryable: false,
      field,
      slug,
    },
  });
}

/** A display name as written, without the quotes around it. */
function unquotedName(name: string): string {
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(name);
  return quoted ? quoted[1].replace(/\\(.)/g, "$1") : name;
}

/** A display name as a header carries it: quoted when it holds a separator. */
function quotedName(name: string): string {
  return /[()<>[\]:;@\\,."]/.test(name)
    ? `"${name.replace(/(["\\])/g, "\\$1")}"`
    : name;
}

/**
 * `value` with each control character a space. Liquid's line context removes
 * line breaks; any other control character from the data would reach the
 * header too.
 */
function withoutControlCharacters(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? " " : char;
  }
  return out;
}
