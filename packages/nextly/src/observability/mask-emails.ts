/**
 * Email addresses in what Nextly logs, masked outside development and test.
 *
 * A production log is aggregated, retained and read by people who have no
 * reason to see a customer's address; OWASP's Logging Cheat Sheet lists email
 * addresses among the personal data to de-identify. A masked address keeps
 * what an operator needs to diagnose a failure — the first character and the
 * domain, `j***@example.com` — and drops the rest.
 *
 * Masking applies whenever `NODE_ENV` is not `development` or `test`, an
 * unset `NODE_ENV` included: a server started without it is as likely to be a
 * production host as a laptop, and the cost of guessing wrong is the leak.
 *
 * @module observability/mask-emails
 */

import type { Logger } from "../shared/types";

import { copyForLog } from "./log-copy";
import {
  redactCredentials,
  redactCredentialsInText,
} from "./redact-credentials";

/**
 * An email address in running text. The local part is either quoted
 * (`"john.doe"@example.com`) or made of every character an unquoted one may
 * hold, `+`, `/` and `=` included, so no address keeps a prefix by starting
 * the match after one of them. The domain needs at least one dot and a
 * top-level label of letters or punycode (`xn--p1ai`), so `user@localhost`
 * in a URL and an `@scope/pkg` specifier are left alone. Letters and digits
 * are any script's, combining marks included (`जॉन@example.com`), so an
 * internationalized address (`jöhn@bücher.de`) is matched whole rather than
 * missed or cut in two; a punycode label matches in any letter case. A
 * domain literal (`john@[192.0.2.1]`, `john@[IPv6:2001:db8::1]`) is an
 * address too, while an index such as `arr@[0]` is not. Bounded on both sides
 * so a longer run of address characters is not split into a match.
 */
const EMAIL_PATTERN =
  /(?<![\p{L}\p{M}\p{N}!#$%&'*+/=?^_`{|}~.-])("(?:[^"\\\r\n]|\\.)+"|[\p{L}\p{M}\p{N}!#$%&'*+/=?^_`{|}~.-]+)@((?:[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}-]*[\p{L}\p{M}\p{N}])?\.)+(?:[Xx][Nn]--[A-Za-z0-9-]+|\p{L}[\p{L}\p{M}]+)|\[(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9-]*[A-Za-z0-9]:[^[\]\s\\]+)\])(?![\p{L}\p{M}\p{N}-])/gu;

/** Whether this environment's logs mask addresses. */
export function emailMaskingEnabled(nodeEnv: string | undefined): boolean {
  return nodeEnv !== "development" && nodeEnv !== "test";
}

/**
 * Whether this process masks addresses now. Read per call, so a process whose
 * `NODE_ENV` is set after a logger was built still masks; a runtime with no
 * `process` at all masks, as an unset `NODE_ENV` does.
 */
export function emailMaskingActive(): boolean {
  return emailMaskingEnabled(
    typeof process === "undefined" ? undefined : process.env.NODE_ENV
  );
}

/**
 * The first character of a local part, whole: a letter outside the Basic
 * Multilingual Plane is two UTF-16 units, and keeping one would write half a
 * character. A quoted local part shows the first character inside its quotes.
 */
function firstCharacter(local: string): string {
  const shown = local.startsWith('"') ? local.slice(1) : local;
  return String.fromCodePoint(shown.codePointAt(0) ?? 0x2a);
}

/** One address masked to its first character and its domain. */
export function maskEmailAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return address;
  return `${firstCharacter(address)}***@${address.slice(at + 1)}`;
}

/** Every address in a piece of text masked, the rest left exactly as it was. */
export function maskEmailsInText(text: string): string {
  // Each match is masked by the single-address masker, so the two cannot
  // come to disagree about what a masked address looks like.
  return text.replace(EMAIL_PATTERN, match => maskEmailAddress(match));
}

/**
 * A copy of a value with every address in it masked: strings, the fields of
 * plain objects, list members, and an error's message, stack, cause and own
 * fields, at any depth. The value given is never changed. An object of any
 * other class is kept as it is, since copying it could lose what makes it
 * that class; a log payload is plain data and errors.
 */
export function maskEmails<T>(value: T): T {
  return copyForLog(value, { text: maskEmailsInText });
}

/**
 * `value` as it may be written now: masked outside development and test, as
 * it was given otherwise. The one place a writer asks both questions, so no
 * two writers can come to answer "is this masked?" differently.
 */
function maskEmailsWhenActive<T>(value: T): T {
  return emailMaskingActive() ? maskEmails(value) : value;
}

/**
 * `value` as a log writer may write it: credentials taken out in every
 * environment, then addresses masked outside development and test. Every
 * writer goes through this one function, so none can come to log a request's
 * headers that another would have redacted. Credentials go first: the email
 * masker keeps a `Request` as it is, headers and all.
 */
export function safeToLog<T>(value: T): T {
  return maskEmailsWhenActive(redactCredentials(value));
}

/**
 * A service logger that takes credentials out of every message and field it is
 * handed, and masks addresses outside development and test, before passing
 * them on. Each method of the wrapped
 * logger is looked up as it is called, so one replaced after wrapping, as a
 * test or an app may do, is the one that receives the line.
 */
export function maskingServiceLogger(logger: Logger): Logger {
  const pass =
    (level: keyof Logger): Logger["info"] =>
    (message, meta) => {
      // Credentials come out of the message and fields in every environment;
      // addresses are masked outside development and test.
      const redacted = redactCredentialsInText(message);
      const text = emailMaskingActive() ? maskEmailsInText(redacted) : redacted;
      // A line logged without fields reaches the logger without them, as it
      // would unwrapped, rather than with a trailing `undefined`.
      if (meta === undefined) {
        logger[level](text);
        return;
      }
      logger[level](text, safeToLog(meta));
    };
  return {
    debug: pass("debug"),
    info: pass("info"),
    warn: pass("warn"),
    error: pass("error"),
  };
}
