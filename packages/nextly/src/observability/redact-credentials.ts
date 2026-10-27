/**
 * Credentials taken out of what Nextly logs, in every environment.
 *
 * A service that logs its options logs the request they carry, and Node's
 * console prints a Fetch `Request` with its headers: the caller's
 * `Authorization: Bearer` API key and session cookie reached production logs
 * that way. OWASP's Logging Cheat Sheet lists session identifiers, access
 * tokens, passwords and keys among what is never to be logged.
 *
 * Unlike email masking, this applies in development and test too. A key in a
 * local log is still a key, and a test environment that prints them would hide
 * the leak until production.
 *
 * What is taken out:
 * - a `Request` or `Response`, kept as its method and path or its status;
 * - a `Headers` object, and any other non-plain object carrying `headers`
 *   (Node's `IncomingMessage`, say), kept as its class name;
 * - the value of a field named like a credential (`authorization`, `cookie`,
 *   `password`, `rawToken`, `apiKey`, ...), whatever its case or separators;
 * - a `Bearer` or `Basic` credential in running text, a field's name included;
 * - all of these inside an error's message, stack, cause and own fields.
 *
 * @module observability/redact-credentials
 */

import { copyForLog } from "./log-copy";

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

/** Every `Bearer` or `Basic` credential in a piece of text redacted. */
export function redactCredentialsInText(text: string): string {
  return text.replace(
    CREDENTIAL_IN_TEXT,
    (_, scheme: string) => `${scheme} ${REDACTED}`
  );
}

/**
 * A copy of a value with every credential in it taken out: in strings, field
 * names, the fields of plain objects and lists, and an error's message, stack,
 * cause and own fields, at any depth, and any request, response or headers
 * object. The value given is never changed.
 */
export function redactCredentials<T>(value: T): T {
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

/** Whether a value is plain data: an object literal or a null-prototype one. */
function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
