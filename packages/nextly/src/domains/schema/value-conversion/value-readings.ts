// How a stored value reads, and how each database would store it under a new type.
//
// Every function here takes the database's own text of a value, never a JavaScript number, so a
// 64-bit integer or a decimal is judged with every digit it has.
//
// @module domains/schema/value-conversion/value-readings

import type { SqliteAffinity } from "./column-type";
import type { SqliteStorage } from "./types";

/** A decimal literal, as each database writes a number as text: digits, a point, an exponent. */
const DECIMAL_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** An integer literal. */
const INTEGER_LITERAL = /^[+-]?\d+$/;

/**
 * A number's value in one canonical spelling, or null when `text` is not a decimal literal.
 *
 * Two texts name the same number exactly when their canonical spellings are equal: `7`, `7.0` and
 * `0.7e1` are one value, `0.1` and `0.10000000000000001` are two. Compared as spellings rather than
 * as JavaScript numbers, which would make the second pair equal.
 */
export function exactNumber(text: string): string | null {
  const trimmed = text.trim();
  if (!DECIMAL_LITERAL.test(trimmed)) return null;
  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^[+-]/, "");
  const [mantissa = "", exponentText = "0"] = unsigned.split(/[eE]/);
  const [whole = "", fraction = ""] = mantissa.split(".");
  let digits = `${whole}${fraction}`.replace(/^0+/, "");
  let exponent = Number(exponentText) - fraction.length;
  if (digits === "") return "0";
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    exponent += 1;
  }
  return `${negative ? "-" : ""}${digits}e${exponent}`;
}

/** Whether a number written as `text` reads back as itself once stored as an eight-byte double. */
export function keptByDouble(text: string): boolean {
  return exactNumber(text) === exactNumber(String(Number(text)));
}

/** Whether a number written as `text` reads back as itself once stored as a four-byte float. */
export function keptByFloat4(text: string): boolean {
  return exactNumber(text) === exactNumber(String(Math.fround(Number(text))));
}

/** How many characters a value has, as a `varchar(N)` counts them: code points, not UTF-16 units. */
export function characterLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Whether PostgreSQL's `jsonb` reads `text`.
 *
 * `jsonb` refuses two things JavaScript's parser accepts: the escape `\u0000`, and a `\u` escape
 * naming half of a surrogate pair without its other half. Both are refused here too, so a value
 * the cast would refuse is never judged convertible.
 */
export function readsAsPostgresJson(text: string): boolean {
  let numbersFit = true;
  try {
    JSON.parse(text, (_key, value: unknown, context?: { source?: string }) => {
      if (typeof value === "number" && !fitsPostgresNumeric(value, context)) {
        numbersFit = false;
      }
      return value;
    });
  } catch {
    return false;
  }
  return numbersFit && escapesReadAsJsonb(text);
}

/** The most digits PostgreSQL's numeric holds before the decimal point, and after it. */
const NUMERIC_INTEGER_DIGITS = 131072;
const NUMERIC_SCALE_DIGITS = 16383;

/**
 * Whether `jsonb` stores a JSON number, which it keeps as a `numeric`: one with more digits before
 * the point, or more written after it, than a numeric holds is refused. The number is judged by how
 * it is written, as PostgreSQL reads it, so `10e-16384` is refused though its value has a shorter
 * spelling. Where the parser does not hand over the source text, a number JavaScript cannot hold is
 * refused, which a number PostgreSQL refuses also is.
 */
function fitsPostgresNumeric(
  value: number,
  context: { source?: string } | undefined
): boolean {
  const source = context?.source;
  if (source === undefined) return Number.isFinite(value);
  const [mantissa = "", exponentText = "0"] = source
    .replace(/^-/, "")
    .split(/[eE]/);
  const [whole = "", fraction = ""] = mantissa.split(".");
  const exponent = Number(exponentText);
  const scale = Math.max(0, fraction.length - exponent);
  const digits = `${whole}${fraction}`.replace(/^0+/, "");
  const integerDigits =
    digits === "" ? 0 : digits.length - fraction.length + exponent;
  return (
    scale <= NUMERIC_SCALE_DIGITS && integerDigits <= NUMERIC_INTEGER_DIGITS
  );
}

/** Which half of a UTF-16 surrogate pair a code unit is, or null when it is neither. */
function surrogateHalf(unit: number): "high" | "low" | null {
  if (unit >= 0xd800 && unit <= 0xdbff) return "high";
  if (unit >= 0xdc00 && unit <= 0xdfff) return "low";
  return null;
}

/**
 * Each `\u` escape in a JSON text: its code unit, where it starts and where it ends.
 *
 * The scan consumes every escape whole, so `\\u0000`, an escaped backslash followed by the letters
 * `u0000`, is read as the text it is and not as an escape.
 */
function* unicodeEscapes(
  text: string
): Generator<{ unit: number; start: number; end: number }> {
  const escapes = /\\(?:u([0-9a-fA-F]{4})|.)/g;
  for (let match = escapes.exec(text); match; match = escapes.exec(text)) {
    if (match[1] !== undefined) {
      yield {
        unit: parseInt(match[1], 16),
        start: match.index,
        end: escapes.lastIndex,
      };
    }
  }
}

/** Whether every `\u` escape in a parsed JSON text is one `jsonb` accepts. */
function escapesReadAsJsonb(text: string): boolean {
  // Where the escape after a high half must start for the two to pair, or -1 when none waits.
  let highEnd = -1;
  for (const { unit, start, end } of unicodeEscapes(text)) {
    const half = surrogateHalf(unit);
    if (highEnd !== -1) {
      if (half !== "low" || start !== highEnd) return false;
      highEnd = -1;
    } else if (unit === 0 || half === "low") {
      return false;
    } else if (half === "high") {
      highEnd = end;
    }
  }
  return highEnd === -1;
}

/**
 * Whether `c` is a space as PostgreSQL's array reader skips it: the ASCII spaces alone. A Unicode
 * space such as U+00A0 is part of an element to PostgreSQL, so it is here too.
 */
function isArraySpace(c: string): boolean {
  return /^[ \t\n\r\v\f]$/.test(c);
}

/** `text` without the spaces PostgreSQL's array reader skips at either end. */
function trimArraySpaces(text: string): string {
  return text.replace(/^[ \t\n\r\v\f]+|[ \t\n\r\v\f]+$/g, "");
}

/** The first position at or after `i` that is not a space. */
function skipSpaces(body: string, i: number): number {
  let at = i;
  while (at < body.length && isArraySpace(body.charAt(at))) at += 1;
  return at;
}

/**
 * Whether PostgreSQL reads `text` as a one-dimensional `text[]` literal: `{a,"b c",NULL}`.
 *
 * Deliberately stricter than PostgreSQL: a nested or dimension-decorated literal, which PostgreSQL
 * reads into a shape no relation's list ever held, is answered no. A value judged unreadable here is
 * reported, never converted, so the stricter answer can stop a conversion but never change a value.
 */
export function readsAsPostgresTextArray(text: string): boolean {
  const s = trimArraySpaces(text);
  if (!s.startsWith("{") || !s.endsWith("}")) return false;
  const body = s.slice(1, -1);
  if (trimArraySpaces(body) === "") return true;
  let i = 0;
  for (;;) {
    const end = readArrayElement(body, skipSpaces(body, i));
    if (end === null) return false;
    i = skipSpaces(body, end);
    if (i === body.length) return true;
    if (body.charAt(i) !== ",") return false;
    i += 1;
  }
}

/** Where one array element starting at `start` ends, or null when it is not one PostgreSQL reads. */
function readArrayElement(body: string, start: number): number | null {
  return body.charAt(start) === '"'
    ? readQuotedElement(body, start)
    : readUnquotedElement(body, start);
}

/** A quoted element: up to its closing quote, a backslash taking the next character as it is. */
function readQuotedElement(body: string, start: number): number | null {
  for (let i = start + 1; i < body.length; i += 1) {
    const c = body.charAt(i);
    if (c === "\\") i += 1;
    else if (c === '"') return i + 1;
  }
  return null;
}

/** Characters an unquoted element cannot hold: they open or close a dimension or a quoted element. */
const ARRAY_DELIMITERS = new Set(["{", "}", '"']);

/** An unquoted element: up to the next comma, holding at least one character that is not a space. */
function readUnquotedElement(body: string, start: number): number | null {
  let i = start;
  let read = false;
  while (i < body.length && body.charAt(i) !== ",") {
    const c = body.charAt(i);
    if (ARRAY_DELIMITERS.has(c)) return null;
    // A backslash takes the next character as it is, so the two are read together.
    const width = c === "\\" ? 2 : 1;
    if (i + width > body.length) return null;
    if (width === 2 || !isArraySpace(c)) read = true;
    i += width;
  }
  return read ? i : null;
}

/** A value as SQLite holds it: its storage class and its text. */
export interface SqliteValue {
  storage: SqliteStorage;
  text: string;
  /** A REAL's 17 significant digits, where `text` may be rounded (`StoredValue.exactReal`). */
  exact?: string;
}

/** The smallest and largest integers SQLite stores as an INTEGER. */
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/** `text` as SQLite's INTEGER, when it is an integer literal that fits in 64 bits. */
function asInteger(text: string): SqliteValue | null {
  if (!INTEGER_LITERAL.test(text)) return null;
  const value = BigInt(text);
  return value >= INT64_MIN && value <= INT64_MAX
    ? { storage: "integer", text: value.toString() }
    : null;
}

/** A double SQLite would make an INTEGER, where it has no fraction and fits in 64 bits. */
function realAsInteger(real: number): SqliteValue | null {
  if (!Number.isInteger(real)) return null;
  const value = BigInt(real);
  return value >= INT64_MIN && value <= INT64_MAX
    ? { storage: "integer", text: value.toString() }
    : null;
}

/** `text` as SQLite's REAL, when it is a number literal. */
function asReal(text: string): number | null {
  return DECIMAL_LITERAL.test(text) ? Number(text) : null;
}

/**
 * A number rendered as text, as a TEXT column stores it: SQLite's own text of it, whatever digits it
 * keeps. Anything else as it was.
 */
function storedAsText(value: SqliteValue): SqliteValue {
  return value.storage === "integer" || value.storage === "real"
    ? { storage: "text", text: value.text }
    : value;
}

/**
 * A NUMERIC or INTEGER column's value: a text that is an integer literal becomes an INTEGER, any
 * other number literal a REAL, and a REAL with no fraction an INTEGER.
 */
function storedAsNumeric(value: SqliteValue): SqliteValue {
  if (value.storage === "real")
    return realAsInteger(Number(value.exact ?? value.text)) ?? value;
  if (value.storage !== "text") return value;
  const trimmed = value.text.trim();
  const real = asReal(trimmed);
  if (real === null) return value;
  return (
    asInteger(trimmed) ??
    realAsInteger(real) ?? { storage: "real", text: String(real) }
  );
}

/** A REAL column's value: an integer or a text that is a number literal becomes a REAL. */
function storedAsReal(value: SqliteValue): SqliteValue {
  if (value.storage === "integer") {
    return { storage: "real", text: String(Number(BigInt(value.text))) };
  }
  if (value.storage !== "text") return value;
  const real = asReal(value.text.trim());
  return real === null ? value : { storage: "real", text: String(real) };
}

const STORED_AS: Record<SqliteAffinity, (value: SqliteValue) => SqliteValue> = {
  TEXT: storedAsText,
  NUMERIC: storedAsNumeric,
  INTEGER: storedAsNumeric,
  REAL: storedAsReal,
  BLOB: value => value,
};

/**
 * The value a rebuilt SQLite column stores when `value` is copied into a column of `affinity`, by
 * SQLite's datatype rules. Anything a rule does not name is stored as it was. A number's text is the
 * one `CAST(... AS TEXT)` gives, which is what the reader reads, so a TEXT column stores exactly the
 * text the judgement was handed.
 */
export function sqliteStores(
  value: SqliteValue,
  affinity: SqliteAffinity
): SqliteValue {
  return STORED_AS[affinity](value);
}
