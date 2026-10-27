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
 *   `password`, `token`, `apiKey`, ...), whatever its case or separators;
 * - a `Bearer` or `Basic` credential in running text.
 *
 * @module observability/redact-credentials
 */

/** What a removed credential is replaced with. */
const REDACTED = "[redacted]";

/**
 * Field names whose value is a credential, compared lower-cased with `-` and
 * `_` removed, so `Authorization`, `set-cookie`, `api_key` and `apiKey` are
 * all found.
 */
const CREDENTIAL_FIELDS: ReadonlySet<string> = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "password",
  "passwordhash",
  "currentpassword",
  "newpassword",
  "secret",
  "clientsecret",
  "signingsecret",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "csrftoken",
  "xcsrftoken",
  "apikey",
  "xapikey",
  "privatekey",
]);

/** Whether a field's value is a credential, judged by its name. */
function isCredentialField(key: string): boolean {
  return CREDENTIAL_FIELDS.has(key.toLowerCase().replace(/[-_]/g, ""));
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
 * A copy of a value with every credential in it taken out: in strings, the
 * fields of plain objects and lists at any depth, and any request, response or
 * headers object. The value given is never changed. Errors and objects of
 * other classes are kept as they are, as the email masker keeps them.
 */
export function redactCredentials<T>(value: T): T {
  return redactValue(value, new WeakMap()) as T;
}

function redactValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === "string") return redactCredentialsInText(value);
  if (value === null || typeof value !== "object") return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  const http = httpMessageSummary(value);
  if (http !== undefined) return http;
  if (Array.isArray(value)) return redactList(value, seen);
  return isPlainObject(value) ? redactRecord(value, seen) : value;
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

/** A list copied with each member redacted. */
function redactList(
  value: readonly unknown[],
  seen: WeakMap<object, unknown>
): unknown[] {
  const list: unknown[] = [];
  // Recorded before the members, so a list that contains itself ends.
  seen.set(value, list);
  for (let i = 0; i < value.length; i++) list[i] = redactValue(value[i], seen);
  return list;
}

/** A plain object copied with each credential field's value replaced. */
function redactRecord(
  value: Record<string, unknown>,
  seen: WeakMap<object, unknown>
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  // Recorded before the fields, so an object that contains itself ends.
  seen.set(value, copy);
  for (const [key, field] of Object.entries(value)) {
    // Defined rather than assigned, so a `__proto__` key becomes a field and
    // not the copy's prototype.
    Object.defineProperty(copy, key, {
      value: isCredentialField(key) ? REDACTED : redactValue(field, seen),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  return copy;
}
