/**
 * The judgement of one stored value when its field's type changes: kept, changed, lost or blocked,
 * by eight rules applied the same way to every pair of types.
 *
 * 1. What the new column holds: a value it cannot hold at all is lost; one it holds only cut,
 *    rounded or with a part made up is blocked.
 * 2. A value is kept only where the new type reads back a value of the same kind that compares
 *    equal; a value that changes kind is changed.
 * 3. A pair where no value of the old type could ever be held is blocked, not lossy.
 * 4. An empty value (no value, a JSON null, an old list's empty list) stays empty, kept.
 * 5. A value becoming a list is a one-item list; a list is judged item by item and never cut; a
 *    list becoming one value is its only item.
 * 6. A non-finite number is lost where the new column cannot hold it.
 * 7. A date is never given a part it does not have: a text naming no time or no offset is blocked.
 * 8. A JSON value is judged by its kind's rules; an object is kept to rich text where it is a
 *    document, written as JSON to text, and lost elsewhere; a kind that could never be held is
 *    lost rather than blocked.
 *
 * The judgement reads values exactly (numbers by their digits, dates by their seconds and the
 * digits of a second), and only the families and what each column holds decide an outcome, so one
 * change can be safe on one database and blocked on another.
 *
 * @module domains/schema/value-conversion/type-change/judge
 */
import { EMAIL_RE } from "../../../../shared/lib/entry-validation";
import type { ConversionClass } from "../types";

import { documentOfText, isEditorDocument } from "./document";
import type {
  DateColumn,
  Family,
  FieldTypeOnDialect,
  NumberFormat,
  TextBound,
} from "./field-type";
import {
  decimalWriting,
  type ExactDecimal,
  fitsDecimal,
  fitsDouble,
  fitsInteger,
  numberWriting,
  type ReadNumber,
  readNumber,
} from "./numbers";

/** What a change does to one stored value. */
export type ValueOutcome = "kept" | "changed" | "lost" | "blocked";

/** Why a value meets its outcome, as a report names it. */
export type OutcomeReason =
  /** The new type reads back the same value. */
  | "same-value"
  /** The value is empty and stays so. */
  | "empty"
  /** The value is stored in the new type's form, nothing of it lost. */
  | "new-form"
  /** Longer than the new column holds on this database. */
  | "too-long"
  /** The new column holds it only rounded. */
  | "rounded"
  /** Outside the range the new column holds. */
  | "out-of-range"
  /** A date text naming no time or no offset from UTC. */
  | "no-time-or-offset"
  | "not-a-number"
  | "not-a-date"
  | "not-an-email"
  | "not-an-option"
  | "not-a-boolean"
  /** A non-finite number the new column cannot hold. */
  | "non-finite"
  /** A list of several items becoming one value, which cannot keep them. */
  | "several-items"
  /** A list holding an item that would be lost or blocked, since a list is never cut. */
  | "item-not-held"
  /** A JSON object, which only rich text or text can take. */
  | "object"
  /** A JSON value of a kind the new type could never hold. */
  | "kind-never-held"
  /** The pair of types is blocked whatever its values hold (`pairBlocked`). */
  | "pair-blocked";

/** The judgement of one value, and, where it is kept or changed, the value the new type reads. */
export interface ValueVerdict {
  outcome: ValueOutcome;
  reason: OutcomeReason;
  /**
   * The value as the new type reads it back, written so two values the new type holds as one have
   * one writing: what a unique field's repeats are counted by. Absent where the value is lost or
   * blocked, or empty.
   */
  readsAs?: string;
}

/** Why a pair of types is blocked whatever its values hold. */
export type PairBlockReason =
  /** No value of the old type could ever be held by the new one. */
  | "never-held"
  /** What a relationship's value points at, or where its links are kept, would change. */
  | "relationship"
  /** A field moves between containers by a move, never by a type change. */
  | "container"
  /** A stored password hash is not the password. */
  | "password"
  /** A plugin's type no plugin has loaded, so no rule can read its values. */
  | "unloaded"
  /** No rule converts the pair. */
  | "no-rule";

/**
 * One stored value, as the old field reads it. A Text, Email or Choice value is a `text`; a JSON
 * value is `json`, judged by its kind; a rich text value is the `document` it parses to. `empty` is
 * a null, or an empty list where the old type is a list.
 */
export type OldValue =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "number"; number: ReadNumber }
  | { kind: "boolean"; value: boolean }
  | { kind: "date"; date: Instant }
  | { kind: "list"; items: OldValue[] }
  | { kind: "json"; value: unknown }
  | { kind: "document"; value: unknown };

/** An instant: whole seconds since 1970 UTC, and the digits of a second, with no trailing zero. */
export interface Instant {
  seconds: number;
  fraction: string;
}

/**
 * Whether a change from `from` to `to` is blocked whatever its values hold, and why: rule 3, and
 * the pairs no rule converts. Null where some value could be kept, changed or lost.
 */
export function pairBlocked(
  from: FieldTypeOnDialect,
  to: FieldTypeOnDialect
): PairBlockReason | null {
  if (from.family === "unloaded" || to.family === "unloaded") return "unloaded";
  if (from.family === "password" || to.family === "password") return "password";
  if (from.family === "container" || to.family === "container") return "container";
  if (from.family === "relationship" || to.family === "relationship") {
    return from.family === to.family &&
      from.relation !== undefined &&
      to.relation !== undefined &&
      sameTargets(from, to) &&
      from.relation.kept !== "join" &&
      to.relation.kept !== "join"
      ? null
      : "relationship";
  }
  if (from.family === "json") return null;
  return neverHeld(from, to) ? "never-held" : null;
}

function sameTargets(from: FieldTypeOnDialect, to: FieldTypeOnDialect): boolean {
  const a = from.relation;
  const b = to.relation;
  return (
    a !== undefined &&
    b !== undefined &&
    a.upload === b.upload &&
    a.targets.join() === b.targets.join()
  );
}

/** The families no value of each family could ever reach (rule 3). */
const NEVER_HELD: Partial<Record<Family, readonly Family[]>> = {
  number: ["email", "date"],
  checkbox: ["email", "date"],
  date: ["number", "checkbox", "email"],
  richText: ["email", "choice", "number", "checkbox", "date", "list"],
};

/**
 * Whether no value of `from` could ever be held by `to`: a family the table names, and a list
 * whose items no value (or, from a list, no item) of the old type could ever be.
 */
function neverHeld(from: FieldTypeOnDialect, to: FieldTypeOnDialect): boolean {
  const source = from.family === "list" && from.item ? from.item : from;
  if (source.family === "json") return false;
  if (NEVER_HELD[source.family]?.includes(to.family) === true) return true;
  return to.family === "list" && to.item !== undefined && source !== from
    ? neverHeld(source, to.item)
    : to.family === "list" && to.item !== undefined
      ? NEVER_HELD[source.family]?.includes(to.item.family) === true
      : false;
}

/**
 * What a change from `from` to `to` does to one stored value. The pair is judged first: a pair
 * blocked whatever its values hold blocks every value.
 */
export function judgeValue(
  from: FieldTypeOnDialect,
  to: FieldTypeOnDialect,
  value: OldValue
): ValueVerdict {
  if (value.kind === "empty") return { outcome: "kept", reason: "empty" };
  if (pairBlocked(from, to) !== null) {
    return { outcome: "blocked", reason: "pair-blocked" };
  }
  if (from.family === "relationship") return judgeRelation(from, to, value);
  return judgeAs(to, value, from.family === "json");
}

/** A relationship to the same targets: one target to several, or several to one (rule 5). */
function judgeRelation(
  from: FieldTypeOnDialect,
  to: FieldTypeOnDialect,
  value: OldValue
): ValueVerdict {
  const kept = from.relation?.kept;
  if (kept === to.relation?.kept) {
    return { outcome: "kept", reason: "same-value", readsAs: writingOf(value) };
  }
  if (value.kind === "list") {
    if (value.items.length === 0) return { outcome: "kept", reason: "empty" };
    if (value.items.length > 1) return { outcome: "blocked", reason: "several-items" };
    return { outcome: "changed", reason: "new-form", readsAs: writingOf(value.items[0]) };
  }
  return {
    outcome: "changed",
    reason: "new-form",
    readsAs: JSON.stringify([writingOf(value)]),
  };
}

/**
 * One value judged as `to` reads it. `fromJson` says the value came out of a JSON field, whose
 * values of a kind the new type could never hold are lost rather than blocked (rule 8).
 */
function judgeAs(
  to: FieldTypeOnDialect,
  value: OldValue,
  fromJson: boolean
): ValueVerdict {
  if (value.kind === "empty") return { outcome: "kept", reason: "empty" };
  if (value.kind === "json") return judgeJson(to, value.value);
  // JSON holds every kind as it is, a list included, so it is asked before any list rule.
  if (to.family === "json") return judgeIntoJson(value);
  if (to.family === "list") return judgeIntoList(to, value, fromJson);
  if (value.kind === "list") return judgeListIntoOne(to, value, fromJson);
  switch (to.family) {
    case "text":
    case "email":
    case "choice":
      return judgeIntoText(to, value);
    case "richText":
      return judgeIntoRichText(to, value);
    case "number":
      return judgeIntoNumber(to, value, fromJson);
    case "checkbox":
      return judgeIntoCheckbox(value);
    case "date":
      return judgeIntoDate(to, value, fromJson);
    default:
      return { outcome: "blocked", reason: "kind-never-held" };
  }
}

/** A JSON value, judged by its kind (rule 8). */
function judgeJson(to: FieldTypeOnDialect, value: unknown): ValueVerdict {
  if (value === null) return { outcome: "kept", reason: "empty" };
  if (to.family === "json") {
    return { outcome: "kept", reason: "same-value", readsAs: stableJson(value) };
  }
  const kind = kindOfJson(value);
  if (kind === null) return { outcome: "lost", reason: "kind-never-held" };
  if (kind.kind === "document") {
    if (to.family === "richText" && isEditorDocument(value)) {
      return { outcome: "kept", reason: "same-value", readsAs: stableJson(value) };
    }
    if (to.family === "text") return textWriting(to, stableJson(value));
    return { outcome: "lost", reason: "object" };
  }
  return judgeAs(to, kind, true);
}

/** A parsed JSON value as the kind its rules judge it by; null for a kind no rule reads. */
function kindOfJson(value: unknown): OldValue | null {
  if (typeof value === "string") return { kind: "text", text: value };
  if (typeof value === "number") {
    const number = readNumber(String(value));
    return number === null ? null : { kind: "number", number };
  }
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (Array.isArray(value)) {
    return { kind: "list", items: value.map(item => ({ kind: "json", value: item })) };
  }
  if (typeof value === "object" && value !== null) {
    return { kind: "document", value };
  }
  return null;
}

/** A value becoming a list: a one-item list, or a list judged item by item (rule 5). */
function judgeIntoList(
  to: FieldTypeOnDialect,
  value: OldValue,
  fromJson: boolean
): ValueVerdict {
  const item = to.item;
  if (item === undefined) return { outcome: "blocked", reason: "kind-never-held" };
  if (value.kind === "list") {
    const verdicts = value.items.map(each => judgeAs(item, each, fromJson));
    if (verdicts.some(v => v.outcome === "lost" || v.outcome === "blocked")) {
      return { outcome: "blocked", reason: "item-not-held" };
    }
    const readsAs = JSON.stringify(verdicts.map(v => v.readsAs ?? null));
    return verdicts.every(v => v.outcome === "kept")
      ? { outcome: "kept", reason: "same-value", readsAs }
      : { outcome: "changed", reason: "new-form", readsAs };
  }
  if (value.kind === "document") return { outcome: "lost", reason: "object" };
  const one = judgeAs(item, value, fromJson);
  if (one.outcome === "lost" || one.outcome === "blocked") return one;
  return {
    outcome: "changed",
    reason: "new-form",
    readsAs: JSON.stringify([one.readsAs ?? null]),
  };
}

/** A list becoming one value: its only item, changed; several items blocked (rule 5). */
function judgeListIntoOne(
  to: FieldTypeOnDialect,
  value: Extract<OldValue, { kind: "list" }>,
  fromJson: boolean
): ValueVerdict {
  if (value.items.length === 0) return { outcome: "kept", reason: "empty" };
  if (value.items.length > 1) return { outcome: "blocked", reason: "several-items" };
  const one = judgeAs(to, value.items[0], fromJson);
  if (one.outcome === "lost" || one.outcome === "blocked") {
    return { outcome: "blocked", reason: "item-not-held" };
  }
  return { ...one, outcome: "changed", reason: "new-form" };
}

/** Into Text, Email or Choice: a string, judged by what the column holds and the type's rule. */
function judgeIntoText(to: FieldTypeOnDialect, value: OldValue): ValueVerdict {
  switch (value.kind) {
    case "text": {
      // Longer than the column holds is blocked whatever else the value is: holding it would cut it.
      if (!holdsText(to.textBound, value.text)) {
        return { outcome: "blocked", reason: "too-long" };
      }
      if (to.family === "email" && !EMAIL_RE.test(value.text)) {
        return { outcome: "lost", reason: "not-an-email" };
      }
      if (to.family === "choice" && !(to.options ?? []).includes(value.text)) {
        return { outcome: "lost", reason: "not-an-option" };
      }
      return { outcome: "kept", reason: "same-value", readsAs: value.text };
    }
    case "document":
      return to.family === "text"
        ? textWriting(to, stableJson(value.value))
        : { outcome: "blocked", reason: "kind-never-held" };
    default:
      return changedTo(judgeIntoText(to, { kind: "text", text: textOf(value) }));
  }
}

/** A document or an object written as its JSON to Text: changed, blocked where too long. */
function textWriting(to: FieldTypeOnDialect, writing: string): ValueVerdict {
  return holdsText(to.textBound, writing)
    ? { outcome: "changed", reason: "new-form", readsAs: writing }
    : { outcome: "blocked", reason: "too-long" };
}

/** Into Rich text: a document holding the text, one paragraph per line. */
function judgeIntoRichText(to: FieldTypeOnDialect, value: OldValue): ValueVerdict {
  if (value.kind === "document") {
    return { outcome: "kept", reason: "same-value", readsAs: stableJson(value.value) };
  }
  const writing = JSON.stringify(documentOfText(textOf(value)));
  return holdsText(to.textBound, writing)
    ? { outcome: "changed", reason: "new-form", readsAs: writing }
    : { outcome: "blocked", reason: "too-long" };
}

/** Into Number: exactly, or blocked where rounded or out of range (rules 1 and 6). */
function judgeIntoNumber(
  to: FieldTypeOnDialect,
  value: OldValue,
  fromJson: boolean
): ValueVerdict {
  const format = to.number ?? { kind: "double" as const };
  switch (value.kind) {
    case "number":
      return numberInto(format, to.dialect, value.number, "kept");
    case "text": {
      const number = readNumber(value.text);
      return number === null
        ? { outcome: "lost", reason: "not-a-number" }
        : numberInto(format, to.dialect, number, "changed");
    }
    case "boolean":
      return {
        outcome: "changed",
        reason: "new-form",
        readsAs: value.value ? "1" : "0",
      };
    default:
      return fromJson
        ? { outcome: "lost", reason: "kind-never-held" }
        : { outcome: "blocked", reason: "kind-never-held" };
  }
}

/** A number into a number column: `kept` or `changed` where it fits, by its kind. */
function numberInto(
  format: NumberFormat,
  dialect: FieldTypeOnDialect["dialect"],
  number: ReadNumber,
  fits: "kept" | "changed"
): ValueVerdict {
  if (!number.finite) {
    return holdsNonFinite(format, dialect, number.value)
      ? { outcome: fits, reason: fits === "kept" ? "same-value" : "new-form", readsAs: number.value }
      : { outcome: "lost", reason: "non-finite" };
  }
  const held = holdsNumber(format, number.value);
  if (held !== "exactly") {
    return { outcome: "blocked", reason: held === "rounded" ? "rounded" : "out-of-range" };
  }
  return {
    outcome: fits,
    reason: fits === "kept" ? "same-value" : "new-form",
    readsAs: decimalWriting(number.value),
  };
}

/** Whether a number column holds a finite number exactly. */
function holdsNumber(
  format: NumberFormat,
  value: ExactDecimal
): "exactly" | "rounded" | "out of range" {
  switch (format.kind) {
    case "integer":
      if (value.fraction !== "") return "rounded";
      return fitsInteger(value, format.bits) ? "exactly" : "out of range";
    case "double":
      return fitsDouble(value) ? "exactly" : "rounded";
    case "decimal":
      return fitsDecimal(value, format.precision, format.scale);
  }
}

/**
 * Which number columns hold a non-finite number, as measured on each database, written as a bound
 * parameter and read back (`non-finite-columns.integration.test.ts`): PostgreSQL's double holds all
 * three, its constrained `numeric` holds `NaN` and no infinity, and its integer none; every SQLite
 * number column, whatever its affinity, holds the infinities and keeps no `NaN`; MySQL's hold none.
 */
export function holdsNonFinite(
  format: NumberFormat,
  dialect: FieldTypeOnDialect["dialect"],
  value: "NaN" | "Infinity" | "-Infinity"
): boolean {
  if (dialect === "mysql") return false;
  if (dialect === "sqlite") return value !== "NaN";
  if (format.kind === "integer") return false;
  return format.kind === "double" || value === "NaN";
}

/** Into Checkbox: `true`, `false`, `1` or `0`, in any letter case; a boolean kept. */
function judgeIntoCheckbox(value: OldValue): ValueVerdict {
  switch (value.kind) {
    case "boolean":
      return { outcome: "kept", reason: "same-value", readsAs: String(value.value) };
    case "text": {
      const lower = value.text.toLowerCase();
      if (lower === "true" || lower === "1") return changedBoolean(true);
      if (lower === "false" || lower === "0") return changedBoolean(false);
      return { outcome: "lost", reason: "not-a-boolean" };
    }
    case "number": {
      const writing = numberWriting(value.number);
      if (writing === "1") return changedBoolean(true);
      if (writing === "0") return changedBoolean(false);
      return { outcome: "lost", reason: "not-a-boolean" };
    }
    default:
      return { outcome: "lost", reason: "kind-never-held" };
  }
}

function changedBoolean(value: boolean): ValueVerdict {
  return { outcome: "changed", reason: "new-form", readsAs: String(value) };
}

/** Into Date: an ISO 8601 date-time naming its offset, held exactly (rules 1 and 7). */
function judgeIntoDate(
  to: FieldTypeOnDialect,
  value: OldValue,
  fromJson: boolean
): ValueVerdict {
  const column = to.date ?? { fractionDigits: 6 };
  if (value.kind === "date") return instantInto(column, value.date, "kept");
  if (value.kind === "text") {
    const read = readIsoInstant(value.text);
    if (read === "not-a-date") return { outcome: "lost", reason: "not-a-date" };
    if (read === "no-time-or-offset") {
      return { outcome: "blocked", reason: "no-time-or-offset" };
    }
    return instantInto(column, read, "changed");
  }
  return fromJson
    ? { outcome: "lost", reason: "kind-never-held" }
    : { outcome: "blocked", reason: "kind-never-held" };
}

function instantInto(
  column: DateColumn,
  instant: Instant,
  fits: "kept" | "changed"
): ValueVerdict {
  if (instant.fraction.length > column.fractionDigits) {
    return { outcome: "blocked", reason: "rounded" };
  }
  if (
    column.range !== undefined &&
    (instant.seconds < column.range.first || instant.seconds > column.range.last)
  ) {
    return { outcome: "blocked", reason: "out-of-range" };
  }
  return {
    outcome: fits,
    reason: fits === "kept" ? "same-value" : "new-form",
    readsAs: instantWriting(instant),
  };
}

/** Into JSON: a string, a finite number, a boolean or a list kept; a date written as text. */
function judgeIntoJson(value: OldValue): ValueVerdict {
  switch (value.kind) {
    case "text":
      return { outcome: "kept", reason: "same-value", readsAs: JSON.stringify(value.text) };
    case "number":
      return value.number.finite
        ? { outcome: "kept", reason: "same-value", readsAs: decimalWriting(value.number.value) }
        : { outcome: "lost", reason: "non-finite" };
    case "boolean":
      return { outcome: "kept", reason: "same-value", readsAs: String(value.value) };
    case "date":
      return {
        outcome: "changed",
        reason: "new-form",
        readsAs: JSON.stringify(instantWriting(value.date)),
      };
    case "document":
      return { outcome: "kept", reason: "same-value", readsAs: stableJson(value.value) };
    default:
      return { outcome: "kept", reason: "same-value", readsAs: writingOf(value) };
  }
}

/** A changed verdict where a judgement of the value's writing kept it. */
function changedTo(verdict: ValueVerdict): ValueVerdict {
  return verdict.outcome === "kept"
    ? { ...verdict, outcome: "changed", reason: "new-form" }
    : verdict;
}

/** A value's writing as text: a number's decimal writing, `true`/`false`, a date's ISO writing. */
function textOf(value: OldValue): string {
  switch (value.kind) {
    case "text":
      return value.text;
    case "number":
      return numberWriting(value.number);
    case "boolean":
      return String(value.value);
    case "date":
      return instantWriting(value.date);
    default:
      return writingOf(value);
  }
}

/** A value written so two equal values have one writing. */
function writingOf(value: OldValue): string {
  switch (value.kind) {
    case "empty":
      return "null";
    case "list":
      return JSON.stringify(value.items.map(writingOf));
    case "json":
    case "document":
      return stableJson(value.value);
    default:
      return textOf(value);
  }
}

/** JSON with every object's keys in order, so two values that parse alike have one writing. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          )
        )
      : inner
  );
}

/** Whether a text column holds `text` whole: by its characters, or by its UTF-8 bytes. */
function holdsText(bound: TextBound | undefined, text: string): boolean {
  if (bound === undefined) return true;
  const size =
    bound.unit === "characters"
      ? [...text].length
      : new TextEncoder().encode(text).length;
  return size <= bound.most;
}

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?)?$/;

/**
 * The instant an ISO 8601 text names, `no-time-or-offset` where it names no time or no offset from
 * UTC, or `not-a-date` where it is not an ISO 8601 date or date-time, or names a day or a time that
 * does not exist.
 */
export function readIsoInstant(
  text: string
): Instant | "no-time-or-offset" | "not-a-date" {
  const match = ISO.exec(text);
  if (!match) return "not-a-date";
  const [, y, mo, d, h, mi, s = "0", fraction = "", offset] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > days) return "not-a-date";
  if (h === undefined) return "no-time-or-offset";
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (hour > 23 || minute > 59 || second > 59) return "not-a-date";
  if (offset === undefined) return "no-time-or-offset";
  const offsetMinutes = offsetOf(offset);
  if (offsetMinutes === null) return "not-a-date";
  const local = Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
  return {
    seconds: local - offsetMinutes * 60,
    fraction: fraction.replace(/0+$/, ""),
  };
}

/** An offset's minutes east of UTC, or null where it names none that exists. */
function offsetOf(offset: string): number | null {
  if (offset === "Z" || offset === "z") return 0;
  const match = /^([+-])(\d{2}):?(\d{2})?$/.exec(offset);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  if (hours > 23 || minutes > 59) return null;
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

/** An instant's ISO 8601 writing in UTC, with `Z`, keeping every digit of its second. */
export function instantWriting(instant: Instant): string {
  const whole = new Date(instant.seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "");
  return instant.fraction === "" ? `${whole}Z` : `${whole}.${instant.fraction}Z`;
}

/** The class a change takes from its values: the worst decides (safe, lossy, blocked). */
export function classOf(outcomes: Iterable<ValueOutcome>): ConversionClass {
  let worst: ConversionClass = "safe";
  for (const outcome of outcomes) {
    if (outcome === "blocked") return "blocked";
    if (outcome === "lost") worst = "lossy";
  }
  return worst;
}
