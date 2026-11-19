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
import { canonicalJson } from "../../../../shared/lib/canonical-json";
import { EMAIL_RE } from "../../../../shared/lib/entry-validation";
import { readExactIsoInstant } from "../../../../shared/lib/iso-instant";
import type { ConversionClass } from "../types";
import {
  byteLengthIn,
  characterLength,
  decimalFit,
  holdsNonFinite,
  keptByInteger,
  readsAsPostgresJson,
} from "../value-readings";

import { documentOfText, isEditorDocument } from "./document";
import type {
  DateColumn,
  RelationTarget,
  Family,
  FieldTypeOnDialect,
  NumberFormat,
  TextBound,
} from "./field-type";
import {
  decimalWriting,
  type ExactDecimal,
  fitsDouble,
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
  | "pair-blocked"
  /** A link a relationship's change would not carry (`pairBlocked` says `relationship`). */
  | "link-not-carried"
  /** The new column refuses the value's writing outright, so it cannot hold it at all. */
  | "column-refuses"
  /** The new field's own validation refuses the value as the new type reads it. */
  | "field-refuses";

/** How a relationship keeps its links. */
type RelationKept = RelationTarget["kept"];

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
  /**
   * A parsed JSON value. `inexact` where it holds a number whose writing a JavaScript number does
   * not keep exactly (0.10000000000000001): every writing of it but its own JSON would round it.
   */
  | { kind: "json"; value: unknown; inexact?: true }
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
  if (from.family === "unlisted" || to.family === "unlisted") return "no-rule";
  if (from.family === "password" || to.family === "password") return "password";
  if (from.family === "container" || to.family === "container")
    return "container";
  if (from.family === "relationship" || to.family === "relationship") {
    return from.family === to.family &&
      from.relation !== undefined &&
      to.relation !== undefined &&
      sameTargets(from, to) &&
      sameKindOfLink(from.relation.kept, to.relation.kept)
      ? null
      : "relationship";
  }
  if (from.family === "json") return null;
  return neverHeld(from, to) ? "never-held" : null;
}

/**
 * Whether two ways of keeping links store the same kind of link, so one can become the other by
 * rule 5: an id alone or a list of ids, or a `{ relationTo, value }` reference alone or a list of
 * them. A join table, or an id becoming a reference, changes where or how a link is kept.
 */
function sameKindOfLink(from: RelationKept, to: RelationKept): boolean {
  const kind = (kept: RelationKept) =>
    kept === "one" || kept === "list"
      ? "id"
      : kept === "targets" || kept === "targetList"
        ? "reference"
        : "join";
  return kind(from) !== "join" && kind(from) === kind(to);
}

function sameTargets(
  from: FieldTypeOnDialect,
  to: FieldTypeOnDialect
): boolean {
  const a = from.relation;
  const b = to.relation;
  return (
    a !== undefined &&
    b !== undefined &&
    a.upload === b.upload &&
    // Element by element: a joined writing could make two target sets read alike.
    a.targets.length === b.targets.length &&
    a.targets.every((target, i) => target === b.targets[i])
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
  const targetItem = to.family === "list" ? to.item : undefined;
  return (
    neverReaches(source.family, to.family) ||
    (targetItem !== undefined && neverReaches(source.family, targetItem.family))
  );
}

/** Whether no value of the family `from` could ever be one of the family `to` (rule 3). */
function neverReaches(from: Family, to: Family): boolean {
  return NEVER_HELD[from]?.includes(to) === true;
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
  const blocked = pairBlocked(from, to);
  if (blocked !== null) {
    // A relationship's link is blocked as a link the change would not carry, which a row holds:
    // an empty one, judged above, is kept, as the switch's own conversion leaves it.
    return {
      outcome: "blocked",
      reason: blocked === "relationship" ? "link-not-carried" : "pair-blocked",
    };
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
    if (value.items.length > 1)
      return { outcome: "blocked", reason: "several-items" };
    return {
      outcome: "changed",
      reason: "new-form",
      readsAs: writingOf(value.items[0]),
    };
  }
  // A value that is no list, becoming one link: a list column's legacy writing of one link (a JSON
  // string, `"p1"`), which the many-to-one conversion unquotes, so it reads as that link.
  if (to.relation?.kept === "one") {
    return {
      outcome: "changed",
      reason: "new-form",
      readsAs:
        value.kind === "json" && typeof value.value === "string"
          ? value.value
          : writingOf(value),
    };
  }
  return {
    outcome: "changed",
    reason: "new-form",
    // A one-item list of the reference itself: an id, or a `{ relationTo, value }` object.
    readsAs: `[${jsonWritingOf(value)}]`,
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
  if (value.kind === "json") {
    // A number JavaScript reads rounded is rounded by any writing but the JSON it was read from.
    return value.inexact === true && to.family !== "json"
      ? { outcome: "blocked", reason: "rounded" }
      : judgeJson(to, value.value);
  }
  // JSON holds every kind as it is, a list included, so it is asked before any list rule.
  if (to.family === "json") return judgeIntoJson(to, value);
  if (to.family === "list") return judgeIntoList(to, value, fromJson);
  if (value.kind === "list") return judgeListIntoOne(to, value, fromJson);
  const judge = INTO_FAMILY[to.family];
  return judge === undefined
    ? { outcome: "blocked", reason: "pair-blocked" }
    : judge(to, value, fromJson);
}

/** How one value that is no list becomes a value of each family that holds one value. */
const INTO_FAMILY: Partial<
  Record<
    Family,
    (to: FieldTypeOnDialect, value: OldValue, fromJson: boolean) => ValueVerdict
  >
> = {
  text: (to, value) => judgeIntoText(to, value),
  email: (to, value) => judgeIntoText(to, value),
  choice: (to, value) => judgeIntoText(to, value),
  richText: (to, value) => judgeIntoRichText(to, value),
  number: (to, value, fromJson) => judgeIntoNumber(to, value, fromJson),
  checkbox: (_to, value) => judgeIntoCheckbox(value),
  date: (to, value, fromJson) => judgeIntoDate(to, value, fromJson),
};

/** A JSON value, judged by its kind (rule 8). */
function judgeJson(to: FieldTypeOnDialect, value: unknown): ValueVerdict {
  if (value === null) return { outcome: "kept", reason: "empty" };
  if (to.family === "json") {
    return {
      outcome: "kept",
      reason: "same-value",
      readsAs: stableJson(value),
    };
  }
  const kind = kindOfJson(value);
  if (kind === null) return { outcome: "lost", reason: "kind-never-held" };
  if (kind.kind === "document") {
    if (to.family === "richText" && isEditorDocument(value)) {
      const writing = stableJson(value);
      // Kept only where the rich text column holds its writing whole (MySQL's text is bounded).
      return holdsText(to.textBound, writing)
        ? { outcome: "kept", reason: "same-value", readsAs: writing }
        : { outcome: "blocked", reason: "too-long" };
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
    return {
      kind: "list",
      items: value.map(item => ({ kind: "json", value: item })),
    };
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
  if (item === undefined) {
    return { outcome: "blocked", reason: "pair-blocked" };
  }
  if (value.kind === "list") return listIntoList(to, item, value, fromJson);
  if (value.kind === "document") return { outcome: "lost", reason: "object" };
  return oneIntoList(to, item, value, fromJson);
}

/** A list judged item by item, never cut: every item held, or the list blocked (rule 5). */
function listIntoList(
  to: FieldTypeOnDialect,
  item: FieldTypeOnDialect,
  value: Extract<OldValue, { kind: "list" }>,
  fromJson: boolean
): ValueVerdict {
  const verdicts = value.items.map(each => judgeAs(item, each, fromJson));
  if (verdicts.some(itemNotHeld)) {
    return { outcome: "blocked", reason: "item-not-held" };
  }
  const readsAs = listWriting(item, verdicts);
  // The whole list is written to its column, which bounds it where the column is text.
  if (!holdsText(to.textBound, readsAs)) {
    return { outcome: "blocked", reason: "too-long" };
  }
  return verdicts.every(v => v.outcome === "kept")
    ? { outcome: "kept", reason: "same-value", readsAs }
    : { outcome: "changed", reason: "new-form", readsAs };
}

/**
 * Whether a list's item is one the list cannot hold: lost, blocked, or empty, since a typed list's
 * validator refuses a null in it.
 */
function itemNotHeld(verdict: ValueVerdict): boolean {
  return (
    verdict.outcome === "lost" ||
    verdict.outcome === "blocked" ||
    verdict.reason === "empty"
  );
}

/** One value becoming a one-item list: changed at best, never kept (rule 5). */
function oneIntoList(
  to: FieldTypeOnDialect,
  item: FieldTypeOnDialect,
  value: OldValue,
  fromJson: boolean
): ValueVerdict {
  const one = judgeAs(item, value, fromJson);
  if (one.outcome === "lost" || one.outcome === "blocked") return one;
  const writing = listWriting(item, [one]);
  if (!holdsText(to.textBound, writing)) {
    return { outcome: "blocked", reason: "too-long" };
  }
  return { outcome: "changed", reason: "new-form", readsAs: writing };
}

/**
 * A list's writing as the new list holds it: a list of numbers holds JSON numbers, any other list
 * JSON strings, each item as the item's verdict reads it.
 */
function listWriting(
  item: FieldTypeOnDialect,
  verdicts: readonly ValueVerdict[]
): string {
  const items = verdicts.map(v =>
    v.readsAs === undefined
      ? "null"
      : item.family === "number"
        ? v.readsAs
        : JSON.stringify(v.readsAs)
  );
  return `[${items.join(",")}]`;
}

/** A list becoming one value: its only item, changed; several items blocked (rule 5). */
function judgeListIntoOne(
  to: FieldTypeOnDialect,
  value: Extract<OldValue, { kind: "list" }>,
  fromJson: boolean
): ValueVerdict {
  if (value.items.length === 0) return { outcome: "kept", reason: "empty" };
  if (value.items.length > 1)
    return { outcome: "blocked", reason: "several-items" };
  const one = judgeAs(to, value.items[0], fromJson);
  if (one.outcome === "lost" || one.outcome === "blocked") {
    return { outcome: "blocked", reason: "item-not-held" };
  }
  return { ...one, outcome: "changed", reason: "new-form" };
}

/** Into Text, Email or Choice: a string, judged by what the column holds and the type's rule. */
function judgeIntoText(to: FieldTypeOnDialect, value: OldValue): ValueVerdict {
  switch (value.kind) {
    case "text":
      return textInto(to, value.text);
    case "document":
      return to.family === "text"
        ? textWriting(to, stableJson(value.value))
        : { outcome: "blocked", reason: "pair-blocked" };
    default:
      return changedTo(
        judgeIntoText(to, { kind: "text", text: textOf(value) })
      );
  }
}

/** A string into Text, Email or Choice: the column first, then the type's own rule. */
function textInto(to: FieldTypeOnDialect, text: string): ValueVerdict {
  // Longer than the column holds is blocked whatever else the value is: holding it would cut it.
  if (!holdsText(to.textBound, text)) {
    return { outcome: "blocked", reason: "too-long" };
  }
  const refused = refusedByType(to, text);
  return refused === null
    ? { outcome: "kept", reason: "same-value", readsAs: text }
    : { outcome: "lost", reason: refused };
}

/**
 * Why an Email or a Choice refuses a string: the email field's rule, or the option values, which
 * are asked only where options are declared, as the field's validator asks them.
 */
function refusedByType(
  to: FieldTypeOnDialect,
  text: string
): "not-an-email" | "not-an-option" | null {
  if (to.family === "email") return EMAIL_RE.test(text) ? null : "not-an-email";
  const options = to.options ?? [];
  if (to.family === "choice" && options.length > 0 && !options.includes(text)) {
    return "not-an-option";
  }
  return null;
}

/** A document or an object written as its JSON to Text: changed, blocked where too long. */
function textWriting(to: FieldTypeOnDialect, writing: string): ValueVerdict {
  return holdsText(to.textBound, writing)
    ? { outcome: "changed", reason: "new-form", readsAs: writing }
    : { outcome: "blocked", reason: "too-long" };
}

/** Into Rich text: a document holding the text, one paragraph per line. */
function judgeIntoRichText(
  to: FieldTypeOnDialect,
  value: OldValue
): ValueVerdict {
  if (value.kind === "document") {
    return {
      outcome: "kept",
      reason: "same-value",
      readsAs: stableJson(value.value),
    };
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
        : { outcome: "blocked", reason: "pair-blocked" };
  }
}

/** A number into a number column: `kept` or `changed` where it fits, by its kind. */
function numberInto(
  format: NumberFormat,
  dialect: FieldTypeOnDialect["dialect"],
  number: ReadNumber,
  fits: "kept" | "changed"
): ValueVerdict {
  if (number.finite === "beyond") return beyondVerdict(number);
  if (!number.finite) return nonFiniteInto(format, dialect, number.value, fits);
  const held = holdsNumber(format, dialect, number.value);
  if (held !== "exactly") {
    return {
      outcome: "blocked",
      reason: held === "rounded" ? "rounded" : "out-of-range",
    };
  }
  return heldAs(fits, decimalWriting(number.value));
}

/** A number past every column: blocked, as out of range or, for a tiny one, as rounded. */
function beyondVerdict(
  number: Extract<ReadNumber, { finite: "beyond" }>
): ValueVerdict {
  return {
    outcome: "blocked",
    reason: number.large ? "out-of-range" : "rounded",
  };
}

/**
 * A non-finite number into a number field. Its validator refuses NaN, and a whole-number field's
 * any non-finite number, whatever the column holds; otherwise the column decides (rule 6).
 */
function nonFiniteInto(
  format: NumberFormat,
  dialect: FieldTypeOnDialect["dialect"],
  value: "NaN" | "Infinity" | "-Infinity",
  fits: "kept" | "changed"
): ValueVerdict {
  const refused =
    value === "NaN" ||
    format.kind === "integer" ||
    !holdsNonFinite(format.kind, dialect, value);
  return refused
    ? { outcome: "lost", reason: "non-finite" }
    : heldAs(fits, value);
}

/** A value the new type holds, kept or changed by its kind, reading back as `readsAs`. */
function heldAs(fits: "kept" | "changed", readsAs: string): ValueVerdict {
  return {
    outcome: fits,
    reason: fits === "kept" ? "same-value" : "new-form",
    readsAs,
  };
}

/** Whether a number column holds a finite number exactly. */
function holdsNumber(
  format: NumberFormat,
  dialect: FieldTypeOnDialect["dialect"],
  value: ExactDecimal
): "exactly" | "rounded" | "out of range" {
  const held = columnHolds(format, value);
  // SQLite's driver reads and binds every number as a JavaScript number, so a value a double does
  // not hold exactly reads back as another whatever the column's own range.
  if (held === "exactly" && dialect === "sqlite" && !fitsDouble(value)) {
    return "rounded";
  }
  return held;
}

/** Whether a number column, by its own range and digits, holds a finite number exactly. */
function columnHolds(
  format: NumberFormat,
  value: ExactDecimal
): "exactly" | "rounded" | "out of range" {
  switch (format.kind) {
    case "integer":
      return wholeNumberHolds(value, number =>
        keptByInteger(decimalWriting(number), format.bits)
          ? "exactly"
          : "out of range"
      );
    case "double":
      return doubleHolds(value);
    case "decimal":
      return decimalFit(decimalWriting(value), format.precision, format.scale);
    case "json":
      // A JSON number is read back as a JavaScript number, and a whole-number list holds no fraction.
      return format.whole
        ? wholeNumberHolds(value, doubleHolds)
        : doubleHolds(value);
  }
}

/** A whole number's fit: a fraction is held only rounded; a whole one as `fit` says. */
function wholeNumberHolds(
  value: ExactDecimal,
  fit: (value: ExactDecimal) => "exactly" | "rounded" | "out of range"
): "exactly" | "rounded" | "out of range" {
  return value.fraction !== "" ? "rounded" : fit(value);
}

/** Whether a double, which reads a number back as a JavaScript number, holds it exactly. */
function doubleHolds(value: ExactDecimal): "exactly" | "rounded" {
  return fitsDouble(value) ? "exactly" : "rounded";
}

/** Into Checkbox: `true`, `false`, `1` or `0`, in any letter case; a boolean kept. */
function judgeIntoCheckbox(value: OldValue): ValueVerdict {
  switch (value.kind) {
    case "boolean":
      return {
        outcome: "kept",
        reason: "same-value",
        readsAs: String(value.value),
      };
    case "text":
      return booleanFromWriting(value.text.toLowerCase());
    case "number":
      return booleanFromWriting(numberWriting(value.number));
    default:
      return { outcome: "lost", reason: "kind-never-held" };
  }
}

/** The writings a checkbox reads as a boolean: `true`, `false`, `1` and `0`. */
const BOOLEAN_WRITINGS: Readonly<Record<string, boolean>> = {
  true: true,
  "1": true,
  false: false,
  "0": false,
};

/** A writing (a text in lower case, or a number's) as the boolean it names, changed; else lost. */
function booleanFromWriting(writing: string): ValueVerdict {
  const value = Object.hasOwn(BOOLEAN_WRITINGS, writing)
    ? BOOLEAN_WRITINGS[writing]
    : undefined;
  return value === undefined
    ? { outcome: "lost", reason: "not-a-boolean" }
    : { outcome: "changed", reason: "new-form", readsAs: String(value) };
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
    const read = readDateText(value.text);
    if (read === "not-a-date") return { outcome: "lost", reason: "not-a-date" };
    if (read === "no-time-or-offset") {
      return { outcome: "blocked", reason: "no-time-or-offset" };
    }
    return instantInto(column, read, "changed");
  }
  return fromJson
    ? { outcome: "lost", reason: "kind-never-held" }
    : { outcome: "blocked", reason: "pair-blocked" };
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
    (instant.seconds < column.range.first ||
      instant.seconds > column.range.last)
  ) {
    return { outcome: "blocked", reason: "out-of-range" };
  }
  return {
    outcome: fits,
    reason: fits === "kept" ? "same-value" : "new-form",
    readsAs: instantWriting(instant),
  };
}

/**
 * Into JSON: a string, a finite number, a boolean or a list kept, a date written as text; and only
 * where the database's JSON column takes the value's writing. PostgreSQL's `jsonb` refuses some
 * JSON that parses (a `\u0000` escape, half a surrogate pair, a number past its numeric's range),
 * so it cannot hold such a value at all, and it is lost (rule 1), as the column judgement reads it
 * (`readsAsPostgresJson`).
 */
function judgeIntoJson(to: FieldTypeOnDialect, value: OldValue): ValueVerdict {
  const verdict = jsonVerdict(value);
  if (
    to.dialect === "postgresql" &&
    verdict.readsAs !== undefined &&
    !readsAsPostgresJson(verdict.readsAs)
  ) {
    return { outcome: "lost", reason: "column-refuses" };
  }
  return verdict;
}

/** A value's verdict as JSON, before the column is asked whether it takes the writing. */
function jsonVerdict(value: OldValue): ValueVerdict {
  switch (value.kind) {
    case "text":
      return {
        outcome: "kept",
        reason: "same-value",
        readsAs: JSON.stringify(value.text),
      };
    case "number":
      return numberAsJson(value.number);
    case "boolean":
      return {
        outcome: "kept",
        reason: "same-value",
        readsAs: String(value.value),
      };
    case "date":
      return {
        outcome: "changed",
        reason: "new-form",
        readsAs: JSON.stringify(instantWriting(value.date)),
      };
    case "document":
      return {
        outcome: "kept",
        reason: "same-value",
        readsAs: stableJson(value.value),
      };
    default:
      return {
        outcome: "kept",
        reason: "same-value",
        readsAs: writingOf(value),
      };
  }
}

/**
 * A number into JSON: kept where JSON's reader, a JavaScript number, reads it back as the same
 * number; blocked where it reads it only rounded or out of range; lost where it is non-finite,
 * which JSON cannot hold (rule 6).
 */
function numberAsJson(number: ReadNumber): ValueVerdict {
  if (number.finite === "beyond") return beyondVerdict(number);
  if (!number.finite) return { outcome: "lost", reason: "non-finite" };
  return fitsDouble(number.value)
    ? {
        outcome: "kept",
        reason: "same-value",
        readsAs: decimalWriting(number.value),
      }
    : { outcome: "blocked", reason: "rounded" };
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
      return jsonWritingOf(value);
    case "json":
    case "document":
      return stableJson(value.value);
    default:
      return textOf(value);
  }
}

/**
 * A value's writing as JSON: a number as a JSON number, a text or a date as a JSON string, a
 * boolean as one, a list item by item, so a list of numbers writes `[3]`, never `["3"]`.
 */
function jsonWritingOf(value: OldValue): string {
  switch (value.kind) {
    case "list":
      return `[${value.items.map(jsonWritingOf).join(",")}]`;
    case "json":
    case "document":
      return stableJson(value.value);
    default:
      return scalarJsonWriting(value);
  }
}

/** One value that is no list and no JSON, as JSON: `null`, a number, a boolean, or a string. */
function scalarJsonWriting(
  value: Exclude<OldValue, { kind: "list" | "json" | "document" }>
): string {
  if (value.kind === "empty") return "null";
  if (value.kind === "number") {
    return value.number.finite === true
      ? decimalWriting(value.number.value)
      : "null";
  }
  // A boolean is written bare; a text, or a date's ISO writing, as a JSON string.
  return value.kind === "boolean"
    ? String(value.value)
    : JSON.stringify(textOf(value));
}

/**
 * JSON with every object's keys in order, so two values that parse alike have one writing: the one
 * canonical writing (`canonicalJson`). Every value here was parsed from JSON, so it has a writing;
 * one that had none would be written as `null`.
 */
function stableJson(value: unknown): string {
  return canonicalJson(value) ?? "null";
}

/** Whether a text column holds `text` whole: by its characters, or by its UTF-8 bytes. */
function holdsText(bound: TextBound | undefined, text: string): boolean {
  if (bound === undefined) return true;
  // Characters as a `varchar(N)` counts them, which the column judgement counts the same way.
  const size =
    bound.unit === "characters"
      ? characterLength(text)
      : byteLengthIn(text, bound.charset);
  return size <= bound.most;
}

/**
 * The instant a date text names, read by the one exact ISO 8601 reader (`readExactIsoInstant`):
 * `no-time-or-offset` where it names no time or no offset from UTC (blocked, rule 7), or
 * `not-a-date` where it is not an ISO 8601 date or date-time, or names one that does not exist.
 */
export function readDateText(
  text: string
): Instant | "no-time-or-offset" | "not-a-date" {
  const read = readExactIsoInstant(text);
  if (read.ok) {
    return {
      seconds: read.instant.seconds,
      fraction: read.instant.fraction.replace(/0+$/, ""),
    };
  }
  return read.problem === "no-time" || read.problem === "no-offset"
    ? "no-time-or-offset"
    : "not-a-date";
}

/** An instant's ISO 8601 writing in UTC, with `Z`, keeping every digit of its second. */
export function instantWriting(instant: Instant): string {
  const whole = new Date(instant.seconds * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "");
  return instant.fraction === ""
    ? `${whole}Z`
    : `${whole}.${instant.fraction}Z`;
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
