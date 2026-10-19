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
 * An email address in running text. The local part is either quoted
 * (`"john.doe"@example.com`) or made of every character an unquoted one may
 * hold, `+`, `/` and `=` included, so no address keeps a prefix by starting
 * the match after one of them. The domain needs at least one dot and a
 * top-level label of letters or punycode (`xn--p1ai`), so `user@localhost`
 * in a URL and an `@scope/pkg` specifier are left alone. Letters and digits
 * are any script's, so an internationalized address (`jöhn@bücher.de`) is
 * matched whole rather than missed or cut in two. A domain literal
 * (`john@[192.0.2.1]`, `john@[IPv6:2001:db8::1]`) is an address too, while
 * an index such as `arr@[0]` is not. Bounded on both sides so a longer run
 * of address characters is not split into a match.
 */
const EMAIL_PATTERN =
  /(?<![\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-])("(?:[^"\\\r\n]|\\.)+"|[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]+)@((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+(?:xn--[A-Za-z0-9-]+|\p{L}{2,})|\[(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9-]*[A-Za-z0-9]:[^[\]\s\\]+)\])(?![\p{L}\p{N}-])/gu;

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
    // Keys are masked too: a payload keyed by recipient names each one.
    defineOwn(
      copy,
      freeKey(copy, maskEmailsInText(key)),
      maskValue(field, seen),
      true
    );
  }
  return copy;
}

/**
 * `key`, or `key (2)`, `key (3)` and so on when it is taken: two addresses
 * that mask alike stay two fields rather than one overwriting the other.
 */
function freeKey(copy: Record<string, unknown>, key: string): string {
  if (!Object.hasOwn(copy, key)) return key;
  let n = 2;
  while (Object.hasOwn(copy, `${key} (${n})`)) n++;
  return `${key} (${n})`;
}

/**
 * An error copied with its message, stack, cause and own fields masked, still
 * an instance of the error's own class so `instanceof` and `name` survive.
 *
 * Masking runs inside a log call, often inside a `catch` that exists to
 * absorb a failure, so it never throws: an error whose fields cannot be read
 * or copied is logged as a plain `Error` carrying its masked message instead.
 */
function maskError(error: Error, seen: WeakMap<object, unknown>): Error {
  try {
    return copyErrorMasked(error, seen);
  } catch {
    const plain = new Error(
      maskEmailsInText(readText(() => error.message, "(unreadable error)"))
    );
    seen.set(error, plain);
    return plain;
  }
}

function copyErrorMasked(error: Error, seen: WeakMap<object, unknown>): Error {
  const name = maskEmailsInText(error.name);
  const copy = blankCopyOf(error, maskEmailsInText(error.message), name);
  seen.set(error, copy);
  // Set as own data properties rather than assigned: an error class may
  // declare any of them as an accessor with no setter on its prototype, and
  // assigning through one throws.
  if (copy.name !== name) defineOwn(copy, "name", name, false);
  if (error.stack !== undefined) {
    defineOwn(copy, "stack", maskEmailsInText(error.stack), false);
  }
  if (error.cause !== undefined) {
    defineOwn(copy, "cause", maskValue(error.cause, seen), false);
  }
  if (error instanceof AggregateError) {
    // The constructor makes `errors` an own property that is not enumerable,
    // so the loop below would leave the copy without its failures.
    defineOwn(copy, "errors", maskValue(error.errors, seen), false);
  }
  for (const [key, field] of Object.entries(error)) {
    defineOwn(copy, key, maskValue(field, seen), true);
  }
  return copy;
}

/**
 * An empty error of the same class as `error`, holding `message`. A
 * `DOMException` (an aborted `fetch`, say) is built by its own constructor:
 * its `name`, `message` and `code` read slots only that constructor creates,
 * so a plain `Error` given its prototype throws on the first of them it
 * touches.
 */
function blankCopyOf(error: Error, message: string, name: string): Error {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return new DOMException(message, name);
  }
  const copy = new Error(message);
  Object.setPrototypeOf(copy, Object.getPrototypeOf(error) as object);
  return copy;
}

/** A value read as text, or `fallback` when reading it throws. */
function readText(read: () => unknown, fallback: string): string {
  try {
    return String(read());
  } catch {
    return fallback;
  }
}

/**
 * Set `key` on `target` as a writable own data property. Defined rather than
 * assigned, so a `__proto__` key becomes a field and not the prototype.
 */
function defineOwn(
  target: object,
  key: string,
  value: unknown,
  enumerable: boolean
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    configurable: true,
    enumerable,
  });
}

/**
 * A service logger that masks every message and field it is handed, outside
 * development and test, before passing them on. Each method of the wrapped
 * logger is looked up as it is called, so one replaced after wrapping, as a
 * test or an app may do, is the one that receives the line.
 */
export function maskingServiceLogger(logger: Logger): Logger {
  const pass =
    (level: keyof Logger): Logger["info"] =>
    (message, meta) => {
      const masking = emailMaskingActive();
      const text = masking ? maskEmailsInText(message) : message;
      // A line logged without fields reaches the logger without them, as it
      // would unwrapped, rather than with a trailing `undefined`.
      if (meta === undefined) {
        logger[level](text);
        return;
      }
      logger[level](text, masking ? maskEmails(meta) : meta);
    };
  return {
    debug: pass("debug"),
    info: pass("info"),
    warn: pass("warn"),
    error: pass("error"),
  };
}
