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

import { redactCredentialTokens } from "./credential-shapes";

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
 * goes to `rules.other`; when that has nothing to say, its own fields are
 * copied as a plain record, and a function is logged as its fields or its
 * name, so nothing reaches a logger with a hook of its own.
 */
function copyForLog<T>(value: T, rules: LogCopyRules): T {
  return walk(value, rules, new WeakMap()) as T;
}

function walk(
  value: unknown,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>,
  serialised = false
): unknown {
  if (typeof value === "string") return rules.text(value);
  // A console prints a symbol's description, so it is logged as that text.
  if (typeof value === "symbol") return rules.text(value.toString());
  if (!isReference(value)) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  // As JSON does, a value's `toJSON` is called once, and its result is not
  // asked again, so a method returning a fresh object each time still ends.
  // Asked before anything is copied, an error included: a copy keeping the
  // method would let a JSON writer call it past every rule.
  if (!serialised) {
    const form = serialisedForm(value);
    if (form !== value) return walk(form, rules, seen, true);
  }
  return copyByKind(value, rules, seen);
}

/**
 * Whether `value` can carry a `toJSON` of its own: an object, or a function,
 * since a JSON writer calls the method on a function as on an object.
 */
function isReference(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

/**
 * A function, once its `toJSON` has been asked. No function reaches a logger:
 * a console logger prints its fields and calls any inspection hook it has or
 * inherits, so one with fields is logged as a copy of them, each judged as a
 * field is, and one without as the name a console would print for it.
 */
function copyFunction(
  value: object,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): unknown {
  if (Object.keys(value).length > 0) return copyRecord(value, rules, seen);
  const name = readText(() => Reflect.get(value, "name"), "");
  return rules.text(`[Function${name ? `: ${name}` : ""}]`);
}

/**
 * An object of a class this copy does not know, once nothing more specific
 * applies. Nothing leaves as the object it was given, since a console prints
 * an object's fields and calls any inspection hook it has or inherits: a
 * built-in is logged as its data alone, and any other object as a plain
 * record of its own fields, each judged as a field is.
 */
function copyInstance(
  value: object,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): unknown {
  return builtInForm(value, rules) ?? copyRecord(value, rules, seen);
}

/**
 * What a built-in is logged as, or undefined for any other object. A date is
 * a fresh one holding only its time, a pattern its text, and bytes their kind
 * and length, never their contents. A promise, a weak map or a weak set is
 * logged by kind alone: a console would print what a promise settled to.
 */
function builtInForm(value: object, rules: LogCopyRules): unknown {
  // A boxed string is read whole as text, so a credential in it is seen as
  // one; copied by its character indices, no rule would ever see it.
  if (value instanceof String) return rules.text(value.valueOf());
  if (value instanceof Number || value instanceof Boolean) {
    return value.valueOf();
  }
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return rules.text(value.toString());
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const kind = value.constructor?.name ?? "bytes";
    return `[${kind} ${value.byteLength} bytes]`;
  }
  if (value instanceof Promise) return "[Promise]";
  if (value instanceof WeakMap) return "[WeakMap]";
  if (value instanceof WeakSet) return "[WeakSet]";
  return undefined;
}

/** A copy of `value` by what it is, once its `toJSON` has been asked. */
function copyByKind(
  value: object,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): unknown {
  if (typeof value === "function") return copyFunction(value, rules, seen);
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
  // A summary is walked like any value, so the text it keeps (a request's
  // path) is rewritten too.
  const summary = rules.other?.(value);
  return summary === undefined
    ? copyInstance(value, rules, seen)
    : walk(summary, rules, seen, true);
}

/**
 * What a JSON writer would write for `value`: the result of its `toJSON`, or
 * `value` itself when it has none. A logger serialising the copy calls
 * `toJSON`, so a copy that kept the method would let it write whatever it
 * returns, past every rule. A `Date` keeps its own, which writes only the
 * time. A `toJSON` that throws leaves the unreadable marker.
 */
function serialisedForm(value: object): unknown {
  if (value instanceof Date) return value;
  try {
    const toJSON: unknown = Reflect.get(value, "toJSON");
    return typeof toJSON === "function"
      ? Reflect.apply(toJSON, value, [""])
      : value;
  } catch {
    return UNREADABLE;
  }
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
    const copiedKey = walk(key, rules, seen);
    // Two keys that rewrite alike stay two entries, as two field names do.
    copy.set(
      typeof copiedKey === "string" ? freeKey(copy, copiedKey) : copiedKey,
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
  value: object,
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
function freeKey(
  copy: object | ReadonlyMap<unknown, unknown>,
  key: string
): string {
  const taken = (name: string) =>
    copy instanceof Map ? copy.has(name) : Object.hasOwn(copy, name);
  if (!taken(key)) return key;
  let n = 2;
  while (taken(`${key} (${n})`)) n++;
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

/** The symbol Node's `util.inspect` (and so `console.*`) asks a value for. */
const INSPECT_HOOK = Symbol.for("nodejs.util.inspect.custom");

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
  // The copy keeps the error's class, and with it any inspection hook or
  // display tag the class defines, which a console logger would read past
  // every rule. Own empty ones shadow them, so the copy prints as its
  // redacted fields.
  for (const hook of [INSPECT_HOOK, Symbol.toStringTag]) {
    Object.defineProperty(copy, hook, {
      value: undefined,
      configurable: true,
      enumerable: false,
      writable: true,
    });
  }
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
  "signature",
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

/** A name lower-cased with `-`, `_` and spaces removed, as the rules read it. */
function normalisedName(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, "");
}

/**
 * Whether a name says what it holds is a credential: the one answer fields
 * and text parameters share, so `otp` hides a field and an `otp=` alike.
 */
function isCredentialName(key: string): boolean {
  const name = normalisedName(key);
  return (
    CREDENTIAL_WHOLE_NAMES.has(name) ||
    CREDENTIAL_NAME_PARTS.some(part => name.includes(part)) ||
    CREDENTIAL_KEY_NAME.test(name)
  );
}

/**
 * Whether a field holds a credential, judged by its name. A flag never is
 * (`hasPassword: true`), and a number is kept only under a token count; a
 * number under any other credential name (`password: 123456`, an OTP) is not.
 */
function isCredentialField(key: string, value: unknown): boolean {
  if (typeof value === "boolean") return false;
  if (typeof value === "number" && TOKEN_COUNT_NAME.test(normalisedName(key))) {
    return false;
  }
  return isCredentialName(key);
}

/**
 * A `Bearer` or `Basic` credential in running text: the scheme, then the
 * token68 characters RFC 9110 allows a credential to be made of.
 */
const CREDENTIAL_IN_TEXT = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * Credentials before a host in an address, with a scheme or without one:
 * `https://user:password@host` and `//user:password@host`.
 *
 * A scheme is read up to 64 characters. A long run of dashed or dotted words
 * is tried from each word in it, and an unbounded scheme made every try read
 * the run to its end, so a long line cost its length squared. What is
 * redacted does not change: the scheme is put back as written, and an
 * address after a longer run is matched from its `//`.
 */
const URL_USERINFO = /((?:\b[a-z][a-z0-9+.-]{0,63}:)?\/\/)[^\s/@"'<>]+@/gi;

/**
 * The name of a named value in text, in each form an upstream message quotes
 * one: a URL's `name=value`, a header's `Name: value`, JSON's
 * `"name":"value"` (escaped too, when a body sits inside a message) and
 * `name="value"`, and a form's bracketed `user[password]=` or `tokens[]=`.
 *
 * A double-quoted name is read as JSON reads one, whatever sits between its
 * quotes (`"access token"`, `"2fa_token"`), not only an identifier; up to 256
 * characters, so a long line costs a bounded step at each quote. It holds no
 * `=` or `:`, though: a name that does (a map keyed by a URL with a `token=`
 * in it) is left to be searched as text, so the parameter inside it is still
 * found. Any other name keeps the identifier grammar, up to 256 characters
 * too, and is read from its first word only: the first that starts with a
 * letter or `_`, after any words that start with a digit (`token` in
 * `2fa.token`, or in `--token`). Tried from every word in a long run of
 * dotted or dashed words, an unbounded name read the run to its end each
 * time, so a long line cost its length squared; and a bounded name tried
 * from a word near the separator would be judged by that word alone.
 *
 * A name longer than either bound, counting its bracketed parts with its
 * stem, is read backwards instead, whole: at a separator no other form
 * reached, from the separator through an optional closing quote and any
 * bracketed parts, back to the start of the name, so it is judged as a name
 * of any length would be (`password…=` as well as `…password=`, and
 * `user[…][password]`), bare, quoted or escaped. Its length is what is
 * measured, so a short stem with long bracketed parts is read this way too;
 * a name within the bound is left to the forms above, which read it
 * forwards. It is read only where a separator could follow, and only back
 * to the start of the name, so each name is read once and a long line still
 * costs its length.
 *
 * A double-quoted name past the bound is read back the same way, by the JSON
 * grammar that reads it forwards within the bound, so a long name with spaces
 * or escapes in it (`"… access token"`, `\"… \\\"api\\\" token\"`) is
 * judged whole too. That read is tried only at a quote a separator follows,
 * and the grammar passes an escaped quote but never one that ends a string:
 * so a read covers the one string that ends at its quote, no two reads cover
 * the same text, and a line costs its length. Read forwards with no bound,
 * a run of escaped quotes (`\" \" \" …`) would be read from each quote to its
 * end, the length squared. It is tried before the bare name read backwards,
 * which would judge `"password <long word>"` by its last word.
 *
 * An escaped JSON name is a JSON string inside another one, so it is read
 * as the outer quoting wrote the inner one's characters: a plain character,
 * an inner escape (`\\` and what follows it, where an inner quote is `\\\"`
 * and an inner backslash `\\\\`), or an outer escape of any other character.
 * Read that way, an inner quote stays part of the name (`password\"hint`),
 * and a name ending in an inner backslash still ends at its own `\"`.
 *
 * Groups: an escaped JSON name's quote and text, a JSON name's quote and
 * text, any other name's quote and text, a long escaped JSON name's quote
 * and text, a long JSON name's quote and text, any other long name and the
 * quote after it, and the separator. The value is read
 * only after a credential's name (`TEXT_PARAMETER_VALUE`), so any other value
 * is searched as ordinary text.
 */
const TEXT_PARAMETER =
  /(?:(\\")((?:[^"\\\r\n=:]|\\\\\\["\\]|\\\\[^"\\\r\n]|\\[^"\\\r\n]){0,256})\\"|(")((?:[^"\\\r\n=:]|\\[^\r\n]){0,256})"|(\\?'|)\b(?=[A-Za-z_])(?<=(?:^|[^\w.-])[.-]*(?:[0-9]\w*[.-]+)*)([A-Za-z_][\w.-]{0,255}(?:\[[\w.-]*\])*)\5|(?<=")(?=\s*[=:])(?<=(\\")((?:[^"\\\r\n=:]|\\\\\\["\\]|\\\\[^"\\\r\n]|\\[^"\\\r\n]){257,})\\"|(")((?:[^"\\\r\n=:]|\\[^\r\n]){257,})")|(?=[\s=:])(?<=(?<![\w.-])(?=[\w.[\]-]{257})([\w.-]+(?:\[[\w.-]*\])*)(\\?["']?)))(\s*[=:]\s*)/g;

/**
 * The quote and the name a `TEXT_PARAMETER` match found. A JSON name's escapes
 * are decoded as JSON decodes them, so `"\u0074oken"` is judged as `token`;
 * one JSON would refuse is judged as written. An escaped JSON name is a JSON
 * string inside another one, so it is decoded a level at a time by the same
 * decoder: `\"\\u0074oken\"` loses the outer quoting's escapes first, then
 * its own, and is judged as `token` too.
 */
function parameterName(match: RegExpExecArray): {
  nameQuote: string;
  name: string;
} {
  const [, escapedQuote, escapedName, jsonQuote, jsonName, quote, name] = match;
  const [, , , , , , , longEscapedQuote, longEscapedName] = match;
  const [, , , , , , , , , longJsonQuote, longJsonName] = match;
  // A JSON name past the bound is the same name read from its other end, so
  // it is decoded as the bounded reads of each form are.
  const escaped = escapedQuote ?? longEscapedQuote;
  if (escaped !== undefined) {
    return {
      nameQuote: escaped,
      name: decodedJsonName(
        decodedJsonName(escapedName ?? longEscapedName ?? "")
      ),
    };
  }
  const json = jsonQuote ?? longJsonQuote;
  if (json !== undefined) {
    return {
      nameQuote: json,
      name: decodedJsonName(jsonName ?? longJsonName ?? ""),
    };
  }
  const [, , , , , , , , , , , longName, longNameQuote] = match;
  if (longName !== undefined) {
    return { nameQuote: longNameQuote ?? "", name: longName };
  }
  return { nameQuote: quote ?? "", name: name ?? "" };
}

/** A JSON name's text decoded, or as written when JSON would refuse it. */
function decodedJsonName(text: string): string {
  try {
    const decoded: unknown = JSON.parse(`"${text}"`);
    return typeof decoded === "string" ? decoded : text;
  } catch {
    return text;
  }
}

/**
 * A credential's value, read where its name ends: quoted, and then taken
 * whole so a quote is never read as an empty value with the secret after it;
 * an opening quote never closed (a message cut short), and then the rest of
 * the line, failing closed; a JSON array or object, which is not parsed and
 * so takes the rest of the line too (but not the `[redacted]` marker itself,
 * so text already redacted reads the same through a second pass); or bare, with any `Bearer` or `Basic`
 * scheme as the second group.
 */
const TEXT_PARAMETER_VALUE =
  /(\\"(?:[^\\]|\\(?!"))*\\"|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\\?["'][^\r\n]*|(?!\[redacted\])[[{][^\r\n]*|((?:[Bb]earer|[Bb]asic|BEARER|BASIC)\s+)?[^\s&"'<>]*)/y;

/**
 * An `Authorization` header's value, read to the end of its line: a scheme
 * word (`Token`, `Digest`, `Bearer`) kept as the first group, and everything
 * after it, which can run to several words, as the credential.
 */
const AUTHORIZATION_HEADER_VALUE = /([A-Za-z][\w.+-]*[ \t]+)?[^\r\n]*/y;

/**
 * Any other credential header's value (`Password: …`, `X-Api-Key: …`), which
 * can run to several words: read to the end of its line, or to where the
 * line goes on to another named value (`, page=2`).
 */
const HEADER_VALUE = /(?:(?!,\s*[A-Za-z_][\w.-]*\s*[=:])[^\r\n])*/y;

/** A value's quotes, kept around its redaction so JSON still reads as JSON. */
const VALUE_QUOTES = /^(\\?["']?)[\s\S]*?(\1)$/;

/**
 * Names that are credentials as text parameters, though not as fields: a
 * bare `key=` or `sig=` in a URL is typically an API key or a signature,
 * while a field named `key` is usually an identifier such as a storage path.
 */
const CREDENTIAL_PARAMETER_ONLY_NAMES: ReadonlySet<string> = new Set([
  "key",
  "sig",
]);

/** The sticky patterns a credential's value is read with, one per form. */
interface ValueReaders {
  value: RegExp;
  authorization: RegExp;
  header: RegExp;
}

/**
 * A credential's value at `valueStart`, and the scheme word kept before its
 * redaction. A header (`Password: correct horse`, its name unquoted) runs on
 * to the end of its line, and an `Authorization` header keeps its scheme
 * word; JSON's quoted names, and a quoted or structured value, end where
 * their own form says.
 */
function readCredentialValue(
  text: string,
  valueStart: number,
  found: {
    nameQuote: string;
    name: string;
    separator: string;
    readers: ValueReaders;
  }
): { value: string; scheme: string | undefined } {
  const { nameQuote, name, separator, readers } = found;
  const header =
    separator.includes(":") &&
    nameQuote === "" &&
    !/["'\\[{]/.test(text.charAt(valueStart));
  const authorization =
    header && normalisedName(name).includes("authorization");
  const reader = authorization
    ? readers.authorization
    : header
      ? readers.header
      : readers.value;
  reader.lastIndex = valueStart;
  const [value = "", headerScheme, valueScheme] = reader.exec(text) ?? [];
  const scheme = authorization
    ? headerScheme
    : header
      ? undefined
      : valueScheme;
  return { value, scheme };
}

/**
 * Every parameter in a piece of text whose name says it holds a credential,
 * its value redacted: `X-Amz-Signature=…`, `token=…`, `otp=…`, `key=…`. Judged
 * by the same names fields are, so the two can't come to disagree. The one
 * definition every log sanitiser uses.
 *
 * Any other parameter's value is searched in turn: `https:` reads as a name
 * whose value runs on into the address, and a token in that address's query
 * must still be found.
 */
function redactCredentialParameters(text: string): string {
  // One pass over the text, never recursing: a value after any other name is
  // searched as the text it is part of, so a chain like `a:a:a:…` costs one
  // step per name rather than one stack frame.
  const names = new RegExp(TEXT_PARAMETER.source, "g");
  const readers: ValueReaders = {
    value: new RegExp(TEXT_PARAMETER_VALUE.source, "y"),
    authorization: new RegExp(AUTHORIZATION_HEADER_VALUE.source, "y"),
    header: new RegExp(HEADER_VALUE.source, "y"),
  };
  let out = "";
  let from = 0;
  for (let match = names.exec(text); match; match = names.exec(text)) {
    const [prefix] = match;
    const separator = match[13] ?? "";
    const { nameQuote, name } = parameterName(match);
    if (
      !isCredentialName(name) &&
      !CREDENTIAL_PARAMETER_ONLY_NAMES.has(normalisedName(name))
    ) {
      // A quoted name read from an escaped quote may be the tail of a longer
      // quoted name (`"… token for \"api\"":`), so the search goes on from
      // where it ends: the whole name, read back from the separator, is still
      // judged. Each place is still tried once, so a line costs its length;
      // a name read backwards has no width here, and the search moves on.
      const nameEnd = match.index + prefix.length - separator.length;
      if (
        nameEnd > match.index &&
        nameQuote.endsWith('"') &&
        text.charAt(match.index - 1) === "\\"
      ) {
        names.lastIndex = nameEnd;
      }
      continue;
    }
    const valueStart = match.index + prefix.length;
    const { value, scheme } = readCredentialValue(text, valueStart, {
      nameQuote,
      name,
      separator,
      readers,
    });
    const [, open = "", close = ""] = VALUE_QUOTES.exec(value) ?? [];
    // The scheme says how a caller authenticated, which an operator needs;
    // only what follows it is the credential.
    const redacted = scheme
      ? `${scheme}${REDACTED}`
      : `${open}${REDACTED}${close}`;
    out += `${text.slice(from, valueStart)}${redacted}`;
    from = valueStart + value.length;
    names.lastIndex = from;
  }
  return out + text.slice(from);
}

/**
 * A `Cookie` or `Set-Cookie` header quoted in text, to the end of its line:
 * every cookie on it, whatever it is named, may be a session.
 */
const COOKIE_HEADER_IN_TEXT = /\b((?:set-)?cookie):[^\r\n]*/gi;

/**
 * Every credential in a piece of text redacted: a token with a known
 * credential's shape (a JWT, a GitHub or npm token, an AWS key id, a PEM
 * block) wherever it sits, a `Bearer` or `Basic` credential, the user and
 * password before a host, a quoted cookie header, and the value of a parameter
 * named like a credential or a session. Since every string the log walk meets
 * passes through here, a shaped credential under a neutral field name (a
 * `toJSON` result, a header pair in a list) is taken out too.
 */
export function redactCredentialsInText(text: string): string {
  return redactCredentialParameters(
    // Shapes first: a PEM block is taken whole, before a header rule that
    // reads one line could leave its body behind.
    redactCredentialTokens(text, REDACTED)
      .replace(
        CREDENTIAL_IN_TEXT,
        (_, scheme: string) => `${scheme} ${REDACTED}`
      )
      .replace(URL_USERINFO, `$1${REDACTED}@`)
      .replace(COOKIE_HEADER_IN_TEXT, `$1: ${REDACTED}`)
  );
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
 * other class is copied as a plain record of its own fields, and a function
 * as its fields or its name.
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
