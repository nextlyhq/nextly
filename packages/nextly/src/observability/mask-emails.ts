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
 * The same module takes credentials out of every log value, in every
 * environment, and holds the one walk both use. They live together because
 * every log writer loads this module already: a credential redactor in a module
 * of its own was one more module in hundreds of test files' graphs, for code
 * that is never loaded apart from this.
 *
 * @module observability/mask-emails
 */

import type { Logger } from "../shared/types";

// ---------------------------------------------------------------------------
// The one walk over a log value
//
// Email masking and credential redaction each need a copy of a log value
// with something taken out of every string, field name and error at any
// depth. Walking it twice, by two hands, is how one of them came to pass
// errors through untouched while the other copied them with care. So the
// walk lives here once, and each masker supplies only its rules.
// ---------------------------------------------------------------------------

/** What a masker changes as the walk copies a value. */
interface LogCopyRules {
  /**
   * Rewrites every string the walk meets: values, field names, and an error's
   * name, message and stack.
   */
  text: (text: string) => string;
  /**
   * Whether a field's value is replaced by `hidden` on its name alone, without
   * being walked.
   */
  hideField?: (key: string, value: unknown) => boolean;
  /** What a field `hideField` picks is replaced with. */
  hidden?: unknown;
  /**
   * A replacement for an object of a class the walk doesn't copy, or
   * `undefined` to keep it as it is.
   */
  other?: (value: object) => unknown;
}

/**
 * A copy of a value with `rules` applied: strings, the fields of plain
 * objects, list members, and an error's message, stack, cause and own fields,
 * at any depth. The value given is never changed. An object of any other class
 * goes to `rules.other`, and is kept as it is when that has nothing to say,
 * since copying it could lose what makes it that class.
 */
function copyForLog<T>(value: T, rules: LogCopyRules): T {
  return walk(value, rules, new WeakMap()) as T;
}

function walk(
  value: unknown,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): unknown {
  if (typeof value === "string") return rules.text(value);
  if (value === null || typeof value !== "object") return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (value instanceof Error) return copyError(value, rules, seen);
  if (Array.isArray(value)) return copyList(value, rules, seen);
  if (isPlainObject(value)) return copyRecord(value, rules, seen);
  if (value instanceof Map) return copyMap(value, rules, seen);
  if (value instanceof Set) return copySet(value, rules, seen);
  // Each prints as its text, a query or an address with whatever it carries,
  // so it is logged as that text, rewritten.
  if (value instanceof URLSearchParams || value instanceof URL) {
    return rules.text(value.toString());
  }
  return rules.other?.(value) ?? value;
}

/** A map copied entry by entry, a string key judged as a field name is. */
function copyMap(
  value: ReadonlyMap<unknown, unknown>,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): Map<unknown, unknown> {
  const copy = new Map<unknown, unknown>();
  seen.set(value, copy);
  for (const [key, entry] of value) {
    const hide = typeof key === "string" && rules.hideField?.(key, entry);
    copy.set(
      walk(key, rules, seen),
      hide ? rules.hidden : walk(entry, rules, seen)
    );
  }
  return copy;
}

/** A set copied member by member. */
function copySet(
  value: ReadonlySet<unknown>,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): Set<unknown> {
  const copy = new Set<unknown>();
  seen.set(value, copy);
  for (const member of value) copy.add(walk(member, rules, seen));
  return copy;
}

/** What a field that throws when read is logged as. */
const UNREADABLE = "[unreadable]";

/**
 * An object's own enumerable fields with their values, read one at a time so a
 * getter that throws gives that field the unreadable marker rather than
 * throwing out of the log call, where it could replace the failure being
 * logged.
 */
function readableEntries(value: object): [string, unknown][] {
  return Object.keys(value).map(key => {
    try {
      return [key, (value as Record<string, unknown>)[key]];
    } catch {
      return [key, UNREADABLE];
    }
  });
}

/** Whether a value is plain data: an object literal or a null-prototype one. */
function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A list copied with each member walked. */
function copyList(
  value: readonly unknown[],
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): unknown[] {
  const list: unknown[] = [];
  // Recorded before the members, so a list that contains itself ends.
  seen.set(value, list);
  for (let i = 0; i < value.length; i++) list[i] = walk(value[i], rules, seen);
  return list;
}

/** A plain object copied field by field. */
function copyRecord(
  value: Record<string, unknown>,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  // Recorded before the fields, so an object that contains itself ends.
  seen.set(value, copy);
  for (const [key, field] of readableEntries(value)) {
    copyField(copy, key, field, rules, seen, true);
  }
  return copy;
}

/**
 * One field copied onto `target`: its name rewritten too, since a payload can
 * be keyed by what it is about (a recipient's address, a token), and its value
 * hidden or walked.
 */
function copyField(
  target: object,
  key: string,
  field: unknown,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>,
  enumerable: boolean
): void {
  const hide = rules.hideField?.(key, field) === true;
  defineOwn(
    target,
    freeKey(target, rules.text(key)),
    hide ? rules.hidden : walk(field, rules, seen),
    enumerable
  );
}

/**
 * `key`, or `key (2)`, `key (3)` and so on when it is taken: two names that
 * rewrite alike stay two fields rather than one overwriting the other.
 */
function freeKey(copy: object, key: string): string {
  if (!Object.hasOwn(copy, key)) return key;
  let n = 2;
  while (Object.hasOwn(copy, `${key} (${n})`)) n++;
  return `${key} (${n})`;
}

/**
 * An error copied with its name, message, stack, cause and own fields
 * rewritten, still an instance of the error's own class so `instanceof` and
 * `name` survive.
 *
 * The copy is made inside a log call, often inside a `catch` that exists to
 * absorb a failure, so it never throws: an error whose fields cannot be read
 * or copied is logged as a plain `Error` carrying its rewritten message.
 */
function copyError(
  error: Error,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): Error {
  try {
    return copyErrorFields(error, rules, seen);
  } catch {
    const plain = new Error(
      rules.text(readText(() => error.message, "(unreadable error)"))
    );
    seen.set(error, plain);
    return plain;
  }
}

function copyErrorFields(
  error: Error,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): Error {
  const name = rules.text(error.name);
  const copy = blankCopyOf(error, rules.text(error.message), name);
  seen.set(error, copy);
  // Set as own data properties rather than assigned: an error class may
  // declare any of them as an accessor with no setter on its prototype, and
  // assigning through one throws.
  if (copy.name !== name) defineOwn(copy, "name", name, false);
  if (error.stack !== undefined) {
    defineOwn(copy, "stack", rules.text(error.stack), false);
  }
  if (error.cause !== undefined) {
    defineOwn(copy, "cause", walk(error.cause, rules, seen), false);
  }
  if (error instanceof AggregateError) {
    // The constructor makes `errors` an own property that is not enumerable,
    // so the loop below would leave the copy without its failures.
    defineOwn(copy, "errors", walk(error.errors, rules, seen), false);
  }
  for (const [key, field] of readableEntries(error)) {
    copyField(copy, key, field, rules, seen, true);
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

// ---------------------------------------------------------------------------
// Credentials, taken out in every environment
//
// A service that logs its options logs the request they carry, and Node's
// console prints a Fetch `Request` with its headers: the caller's
// `Authorization: Bearer` API key and session cookie reached production logs
// that way. OWASP's Logging Cheat Sheet lists session identifiers, access
// tokens, passwords and keys among what is never to be logged. Unlike email
// masking, this applies in development and test too: a key in a local log
// is still a key, and a test environment that printed them would hide the
// leak until production.
// ---------------------------------------------------------------------------

/** What a removed credential is replaced with. */
const REDACTED = "[redacted]";

/**
 * What a field's name says its value is a credential by, matched anywhere in
 * the name once it is lower-cased with `-`, `_` and spaces removed, so
 * `Authorization`, `set-cookie`, `rawToken`, `dbPassword` and `signingSecret`
 * are all found. A substring match, as Sentry's data scrubber matches
 * sensitive keys: an unneeded `[redacted]` in a log costs nothing, while an
 * exact list misses the next name someone gives a token.
 */
const CREDENTIAL_NAME_PARTS: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "privatekey",
  "csrf",
  "session",
  "passcode",
];

/**
 * A key that is a credential in its own right (`rawKey`, `fullKey`,
 * `signingKey`), told from the many keys that aren't (`idempotencyKey`,
 * `cacheKey`, `storageKey`) by what comes before `key`.
 */
const CREDENTIAL_KEY_NAME =
  /(?:raw|full|api|private|secret|signing|access|master|encryption|license)key$/;

/**
 * Short names that are credentials only whole: `pin` and `otp` as parts
 * would catch `mapping` and `footprint`.
 */
const CREDENTIAL_WHOLE_NAMES: ReadonlySet<string> = new Set(["pin", "otp"]);

/**
 * A count of tokens (`maxTokens`, `tokenCount`, `promptTokens`), the one
 * credential-sounding name a number is kept under: a count is not a token.
 */
const TOKEN_COUNT_NAME = /(?:tokens|tokencount|tokenlimit|tokenusage)$/;

/**
 * Whether a field holds a credential, judged by its name. A flag never is
 * (`hasPassword: true`), and a number is kept only under a token count; a
 * number under any other credential name (`password: 123456`, an OTP) is not.
 */
function isCredentialField(key: string, value: unknown): boolean {
  if (typeof value === "boolean") return false;
  const name = key.toLowerCase().replace(/[-_\s]/g, "");
  if (typeof value === "number" && TOKEN_COUNT_NAME.test(name)) return false;
  return (
    CREDENTIAL_WHOLE_NAMES.has(name) ||
    CREDENTIAL_NAME_PARTS.some(part => name.includes(part)) ||
    CREDENTIAL_KEY_NAME.test(name)
  );
}

/**
 * A `Bearer` or `Basic` credential in running text: the scheme, then the
 * token68 characters RFC 9110 allows a credential to be made of.
 */
const CREDENTIAL_IN_TEXT = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

/** Credentials before a host in an address: `https://user:password@host`. */
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@"'<>]+@/gi;

/**
 * A parameter named like a credential, with its value, wherever it appears:
 * in a signed or tokenized URL's query (`X-Amz-Signature=…`, `token=…`) or in
 * running text. The one definition every log sanitiser uses.
 */
export const CREDENTIAL_PARAMETER =
  /\b(x-amz-[\w-]+|[\w-]*(?:token|signature|secret|password|credential|key|sig)|[\w-]*(?:session|cookie|csrf)[\w-]*)=[^\s&"'<>]*/gi;

/**
 * A `Cookie` or `Set-Cookie` header quoted in text, to the end of its line:
 * every cookie on it, whatever it is named, may be a session.
 */
const COOKIE_HEADER_IN_TEXT = /\b((?:set-)?cookie):[^\r\n]*/gi;

/**
 * Every credential in a piece of text redacted: a `Bearer` or `Basic`
 * credential, the user and password before a host, a quoted cookie header,
 * and the value of a parameter named like a credential or a session.
 */
function redactCredentialsInText(text: string): string {
  return text
    .replace(CREDENTIAL_IN_TEXT, (_, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(URL_USERINFO, `$1${REDACTED}@`)
    .replace(COOKIE_HEADER_IN_TEXT, `$1: ${REDACTED}`)
    .replace(CREDENTIAL_PARAMETER, `$1=${REDACTED}`);
}

/**
 * A copy of a value with every credential in it taken out: in strings, field
 * names, the fields of plain objects and lists, and an error's message, stack,
 * cause and own fields, at any depth, and any request, response or headers
 * object. The value given is never changed.
 */
function redactCredentials<T>(value: T): T {
  return copyForLog(value, {
    text: redactCredentialsInText,
    hideField: isCredentialField,
    hidden: REDACTED,
    other: httpMessageSummary,
  });
}

/**
 * What a request, response or headers object is logged as, or `undefined` for
 * anything else. A request keeps its method and path, which is what tells one
 * call from another, and loses its query, which can carry a token as easily as
 * a header can. Reading any of these may throw on an exotic object, so a
 * failure is logged as the redaction marker rather than thrown from a log
 * call.
 */
function httpMessageSummary(value: object): unknown {
  try {
    if (typeof Request !== "undefined" && value instanceof Request) {
      return { method: value.method, path: new URL(value.url).pathname };
    }
    if (typeof Response !== "undefined" && value instanceof Response) {
      return { status: value.status };
    }
    if (typeof Headers !== "undefined" && value instanceof Headers) {
      return REDACTED;
    }
    // A request of another shape (Node's `IncomingMessage`, a framework's own)
    // prints its headers just the same when the console inspects it.
    if (!isPlainObject(value) && "headers" in value) {
      return `[${value.constructor?.name ?? "object"} ${REDACTED}]`;
    }
  } catch {
    return REDACTED;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Email addresses, masked outside development and test
// ---------------------------------------------------------------------------

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
  try {
    return maskEmailsWhenActive(redactCredentials(value));
  } catch {
    // A value the walk can't read at all (a revoked proxy, say) is logged as a
    // marker: a log call never throws, and never writes what it couldn't check.
    return UNREADABLE as T;
  }
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
