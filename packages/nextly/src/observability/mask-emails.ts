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

/**
 * An email address in running text. The local part is the characters an
 * address commonly uses, `+` tags included; the domain needs at least one dot
 * and a letter-only top-level label, so `user@localhost` in a URL and an
 * `@scope/pkg` specifier are left alone. Bounded on both sides so a longer
 * run of address characters is not split into a match.
 */
const EMAIL_PATTERN =
  /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+)@((?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,})(?![A-Za-z0-9-])/g;

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

/** One address masked to its first character and its domain. */
export function maskEmailAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return address;
  return `${address[0]}***@${address.slice(at + 1)}`;
}

/** Every address in a piece of text masked, the rest left exactly as it was. */
export function maskEmailsInText(text: string): string {
  return text.replace(
    EMAIL_PATTERN,
    (_match, local: string, domain: string) => `${local[0]}***@${domain}`
  );
}

/**
 * A copy of a value with every address in it masked: strings, the fields of
 * plain objects, list members, and an error's message, stack, cause and own
 * fields, at any depth. The value given is never changed. An object of any
 * other class is kept as it is, since copying it could lose what makes it
 * that class; a log payload is plain data and errors.
 */
export function maskEmails<T>(value: T): T {
  return maskValue(value, new WeakMap()) as T;
}

function maskValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === "string") return maskEmailsInText(value);
  if (value === null || typeof value !== "object") return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (value instanceof Error) return maskError(value, seen);
  if (Array.isArray(value)) return maskList(value, seen);
  return isPlainObject(value) ? maskRecord(value, seen) : value;
}

/** Whether a value is plain data: an object literal or a null-prototype one. */
function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A list copied with each member masked. */
function maskList(
  value: readonly unknown[],
  seen: WeakMap<object, unknown>
): unknown[] {
  const list: unknown[] = [];
  // Recorded before the members, so a list that contains itself ends.
  seen.set(value, list);
  for (let i = 0; i < value.length; i++) list[i] = maskValue(value[i], seen);
  return list;
}

/** A plain object copied with each field masked. */
function maskRecord(
  value: Record<string, unknown>,
  seen: WeakMap<object, unknown>
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  // Recorded before the fields, so an object that contains itself ends.
  seen.set(value, copy);
  for (const [key, field] of Object.entries(value)) {
    copy[key] = maskValue(field, seen);
  }
  return copy;
}

/**
 * An error copied with its message, stack, cause and own fields masked, still
 * an instance of the error's own class so `instanceof` and `name` survive.
 */
function maskError(error: Error, seen: WeakMap<object, unknown>): Error {
  const copy = new Error(maskEmailsInText(error.message));
  Object.setPrototypeOf(copy, Object.getPrototypeOf(error) as object);
  seen.set(error, copy);
  copy.name = error.name;
  if (error.stack !== undefined) copy.stack = maskEmailsInText(error.stack);
  if (error.cause !== undefined) copy.cause = maskValue(error.cause, seen);
  for (const [key, field] of Object.entries(error)) {
    (copy as unknown as Record<string, unknown>)[key] = maskValue(field, seen);
  }
  return copy;
}

/**
 * A service logger that masks every message and field it is handed, outside
 * development and test, before passing them on.
 */
export function maskingServiceLogger(logger: Logger): Logger {
  const pass =
    (write: Logger["info"]): Logger["info"] =>
    (message, meta) => {
      if (!emailMaskingActive()) {
        write(message, meta);
        return;
      }
      write(maskEmailsInText(message), meta && maskEmails(meta));
    };
  return {
    debug: pass(logger.debug.bind(logger)),
    info: pass(logger.info.bind(logger)),
    warn: pass(logger.warn.bind(logger)),
    error: pass(logger.error.bind(logger)),
  };
}
