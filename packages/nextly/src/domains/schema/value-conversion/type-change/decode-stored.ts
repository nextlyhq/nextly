/**
 * A stored value read as the old field reads it, for the type-change judgement (`judgeValue`). The
 * value arrives as the database's own text of it (`readStoredValues`): a boolean as `true`/`false`
 * (PostgreSQL) or `1`/`0` (MySQL, SQLite), a timestamp as `YYYY-MM-DD HH:MM:SS[.fraction]`
 * (PostgreSQL, MySQL) or whole seconds since 1970 (SQLite), JSON as its writing, and a number with
 * every digit it has. A text the old field could not have stored (a JSON value that does not parse,
 * a date that is no date) is read as a text, which the judgement then judges by the text rules.
 *
 * @module domains/schema/value-conversion/type-change/decode-stored
 */
import type { StoredValue } from "../types";
import { keptByDouble } from "../value-readings";

import type { FieldTypeOnDialect } from "./field-type";
import type { Instant, OldValue } from "./judge";
import { readNumber } from "./numbers";

/** A stored value as the old field reads it. */
export function decodeStored(
  from: FieldTypeOnDialect,
  value: Pick<StoredValue, "text" | "exactReal">
): OldValue {
  const text = value.exactReal ?? value.text;
  if (text === null) return { kind: "empty" };
  const decode = DECODE_BY_FAMILY[from.family];
  return decode === undefined ? { kind: "text", text } : decode(from, text);
}

/** How each family's stored text is read; a family absent here is read as a text. */
const DECODE_BY_FAMILY: Partial<
  Record<
    FieldTypeOnDialect["family"],
    (from: FieldTypeOnDialect, text: string) => OldValue
  >
> = {
  number: (_from, text) => numberOf(text),
  checkbox: (_from, text) => booleanOf(text),
  date: (from, text) => dateOf(from.dialect, text),
  json: (_from, text) => jsonOf(text),
  richText: (_from, text) => documentOf(text),
  list: (from, text) => listOf(from, text),
  relationship: (from, text) => relationOf(from, text),
};

/**
 * A relationship's stored links as the way it keeps them reads them: one id as a text, a list of
 * links (`list`, `targetList`) as a list, each link an item, and one `{ relationTo, value }`
 * reference as JSON.
 */
function relationOf(from: FieldTypeOnDialect, text: string): OldValue {
  const kept = from.relation?.kept;
  if (kept === "one") return { kind: "text", text };
  if (kept === "list" || kept === "targetList") return listOf(from, text);
  return jsonOf(text);
}

function numberOf(text: string): OldValue {
  const number = readNumber(text);
  return number === null ? { kind: "text", text } : { kind: "number", number };
}

/** A boolean as each database writes one: `true`/`false`, `t`/`f`, or `1`/`0`. */
function booleanOf(text: string): OldValue {
  const lower = text.toLowerCase();
  if (lower === "true" || lower === "t" || lower === "1") {
    return { kind: "boolean", value: true };
  }
  if (lower === "false" || lower === "f" || lower === "0") {
    return { kind: "boolean", value: false };
  }
  return { kind: "text", text };
}

/**
 * A date as the column keeps it, in UTC: SQLite's whole seconds since 1970, or PostgreSQL's and
 * MySQL's `YYYY-MM-DD HH:MM:SS[.fraction]`, a timestamp the field wrote in UTC.
 */
function dateOf(
  dialect: FieldTypeOnDialect["dialect"],
  text: string
): OldValue {
  if (dialect === "sqlite") {
    return /^-?\d+$/.test(text)
      ? { kind: "date", date: { seconds: Number(text), fraction: "" } }
      : { kind: "text", text };
  }
  const instant = timestampOf(text);
  return instant === null
    ? { kind: "text", text }
    : { kind: "date", date: instant };
}

const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;

/** A `YYYY-MM-DD HH:MM:SS[.fraction]` timestamp read as UTC, or null where it is not one. */
function timestampOf(text: string): Instant | null {
  const parts = TIMESTAMP.exec(text);
  if (parts === null) return null;
  const [, y, mo, d, h, mi, s, fraction = ""] = parts;
  const seconds =
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s)
    ) / 1000;
  return Number.isNaN(seconds)
    ? null
    : { seconds, fraction: fraction.replace(/0+$/, "") };
}

/** A JSON value as it parses, or the text where it does not. */
function jsonOf(text: string): OldValue {
  const parsed = parseJson(text);
  if (parsed === null) return { kind: "text", text };
  return parsed.inexact
    ? { kind: "json", value: parsed.value, inexact: true }
    : { kind: "json", value: parsed.value };
}

/**
 * A JSON text as it parses, with whether it holds a number a JavaScript number does not keep
 * exactly: each number read from its own writing (the reviver's source), so 0.10000000000000001 is
 * told from the 0.1 it parses to. Null where the text is no JSON.
 */
function parseJson(text: string): { value: unknown; inexact: boolean } | null {
  let inexact = false;
  const reviver = (
    _key: string,
    value: unknown,
    context?: { source?: string }
  ): unknown => {
    if (
      typeof value === "number" &&
      context?.source !== undefined &&
      !keptByDouble(context.source)
    ) {
      inexact = true;
    }
    return value;
  };
  try {
    return { value: JSON.parse(text, reviver) as unknown, inexact };
  } catch {
    return null;
  }
}

/** A rich text value as the document it parses to, or the text where it does not parse. */
function documentOf(text: string): OldValue {
  try {
    return { kind: "document", value: JSON.parse(text) as unknown };
  } catch {
    return { kind: "text", text };
  }
}

/**
 * A list as its items: each item read as the list's item type reads one, an empty list as empty
 * (rule 4), and a text that is no JSON list as a text.
 */
function listOf(from: FieldTypeOnDialect, text: string): OldValue {
  const read = parseJson(text);
  if (read === null) return { kind: "text", text };
  const parsed = read.value;
  // An item JavaScript reads rounded: the list is judged as the JSON it is, which blocks it.
  if (read.inexact) return { kind: "json", value: parsed, inexact: true };
  if (!Array.isArray(parsed)) return { kind: "json", value: parsed };
  if (parsed.length === 0) return { kind: "empty" };
  return { kind: "list", items: parsed.map(item => itemOf(from.item, item)) };
}

/** One item of a list, as its JSON value reads for the list's item type. */
function itemOf(
  item: FieldTypeOnDialect | undefined,
  value: unknown
): OldValue {
  if (value === null) return { kind: "empty" };
  if (item?.family === "number" && typeof value === "number") {
    return numberOf(String(value));
  }
  if (typeof value === "string") return { kind: "text", text: value };
  return { kind: "json", value };
}
