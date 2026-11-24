/**
 * What a change from one field type to another can do to the values a field of the first type may
 * hold, as a picker marks each type before anything is saved: keeps every value, converts some, or
 * may lose some. Judged by the rules themselves (`judgeValue`), over a value of each kind the old
 * type holds and one longer than the new type's column does, so the mark never says more than the
 * rules would of a stored value: a stored value the rules would round, or cut once it is written as
 * the new type writes it, or two values a unique field would read as one, are found only by judging
 * the stored values, which the save does.
 *
 * @module domains/schema/value-conversion/type-change/pair-outcome
 */
import { documentOfText } from "./document";
import type { FieldTypeOnDialect, NumberFormat } from "./field-type";
import { judgeValue, type OldValue, pairBlocked, readDateText } from "./judge";
import { readNumber } from "./numbers";

/** What a type change can do to a field's values: none changed, some changed, or some lost. */
export type PairOutcome = "keeps" | "converts" | "may-lose";

/** A text of each shape the rules read differently: words, numbers, a boolean, dates, a long one. */
const TEXTS: readonly string[] = [
  "words",
  "42",
  "3.5",
  "true",
  "2026-01-02T03:04:05.000Z",
  "2026-01-02",
  "x".repeat(70_000),
];

/** A number of each kind a column holds differently: whole, fraction, negative, beyond 64 bits. */
const NUMBERS: readonly string[] = [
  "0",
  "7",
  "-3",
  "3.5",
  "123456789012345678901234567890",
];

/** A number as long as any a column of `format` holds, written in full. */
function longestNumber(format: NumberFormat | undefined): string {
  switch (format?.kind) {
    case "integer":
      return "-2147483648";
    case "decimal":
      return `-${"9".repeat(format.precision - format.scale)}.${"9".repeat(format.scale)}`;
    default:
      return "-1.7976931348623157e308";
  }
}

/** A JSON value of each kind the rules judge (rule 8). */
const JSON_VALUES: readonly unknown[] = [{ a: 1 }, [1, 2], "words", 1.5, true];

function textValue(text: string): OldValue {
  return { kind: "text", text };
}

function numberValues(format: NumberFormat | undefined): OldValue[] {
  return [...NUMBERS, longestNumber(format)].flatMap(writing => {
    const number = readNumber(writing);
    return number === null ? [] : [{ kind: "number" as const, number }];
  });
}

function dateValues(): OldValue[] {
  return ["2026-01-02T03:04:05.000Z", "2026-01-02T03:04:05.123Z"].flatMap(
    iso => {
      const date = readDateText(iso);
      return typeof date === "string" ? [] : [{ kind: "date" as const, date }];
    }
  );
}

/** An address an email field holds, which no plain text above is. */
const EMAIL = "someone@example.com";

/** A text longer than `to` holds, where its column bounds a text; a short one where none does. */
function longerThan(to: FieldTypeOnDialect): string {
  return "x".repeat((to.textBound?.most ?? 0) + 1);
}

/** An address one longer than `to` holds, or the shortest judged where that is longer already. */
function addressLongerThan(to: FieldTypeOnDialect): string {
  return longerThan(to).slice(EMAIL.length) + EMAIL;
}

/**
 * A value of each kind a field of `type` may hold, as the rules read stored values, and one longer
 * than `to`, the type it becomes, holds.
 */
function valuesOf(
  type: FieldTypeOnDialect,
  to: FieldTypeOnDialect
): OldValue[] {
  switch (type.family) {
    case "text":
      return [...TEXTS, longerThan(to)].map(textValue);
    case "email":
      return [...TEXTS, EMAIL, addressLongerThan(to)].map(textValue);
    case "choice":
      return [...(type.options ?? []), ...TEXTS, longerThan(to)].map(textValue);
    case "richText":
      return [...TEXTS, longerThan(to)].map(text => ({
        kind: "document" as const,
        value: documentOfText(text),
      }));
    case "number":
      return numberValues(type.number);
    case "checkbox":
      return [
        { kind: "boolean", value: true },
        { kind: "boolean", value: false },
      ];
    case "date":
      return dateValues();
    case "json":
      return JSON_VALUES.map(value => ({ kind: "json" as const, value }));
    case "list": {
      // A list of one item and of two, each item a value its item type holds (rule 5).
      const items = type.item ? valuesOf(type.item, to) : TEXTS.map(textValue);
      return items.flatMap(item => [
        { kind: "list" as const, items: [item] },
        { kind: "list" as const, items: [item, item] },
      ]);
    }
    case "relationship":
      // A link is its target's id; a list of links where it holds several.
      return [
        textValue("an-id"),
        { kind: "list", items: [textValue("an-id"), textValue("another-id")] },
      ];
    default:
      // A container, a password, an unloaded or unlisted type: its pair is blocked (`pairBlocked`).
      return [];
  }
}

/** The choice `type` is, or is a list of; undefined for any other type. */
function choiceOf(type: FieldTypeOnDialect): FieldTypeOnDialect | undefined {
  if (type.family === "choice") return type;
  return type.family === "list" && type.item !== undefined
    ? choiceOf(type.item)
    : undefined;
}

/**
 * Whether the values judged of `type` (`valuesOf`) are all it may hold: a checkbox's two, the
 * options of a choice that has some, or a list of such items, which the rules judge item by item.
 * Any other type holds more values than are judged here.
 */
function everyValueJudged(type: FieldTypeOnDialect): boolean {
  const choice = choiceOf(type);
  if (choice !== undefined) return (choice.options ?? []).length > 0;
  if (type.family === "list") {
    return type.item !== undefined && everyValueJudged(type.item);
  }
  return type.family === "checkbox";
}

/**
 * Whether a change to `to` may lose values the ones judged do not show, `to` being a choice or a
 * list of choices: one with no options yet takes them later, and its values are judged against those
 * then; one with options refuses every other value, which a type holding any value may hold.
 */
function choiceMayRefuse(
  from: FieldTypeOnDialect,
  to: FieldTypeOnDialect
): boolean {
  const choice = choiceOf(to);
  return (
    choice !== undefined &&
    ((choice.options ?? []).length === 0 || !everyValueJudged(from))
  );
}

/**
 * What a change from `from` to `to` can do to a field's values, or null where the pair is blocked
 * whatever the values hold (`pairBlocked` says why). A value the rules lose or block marks the pair
 * as one that may lose values; one they change, as one that converts.
 */
export function pairOutcome(
  from: FieldTypeOnDialect,
  to: FieldTypeOnDialect
): PairOutcome | null {
  if (pairBlocked(from, to) !== null) return null;
  if (choiceMayRefuse(from, to)) return "may-lose";
  let converts = false;
  // Only values a field of `from` can hold: those the rules keep for the type itself. None of them
  // held means no value here is judged, so nothing says every value is kept.
  const held = valuesOf(from, to).filter(
    value => judgeValue(from, from, value).outcome === "kept"
  );
  if (held.length === 0) return "may-lose";
  for (const value of held) {
    const { outcome } = judgeValue(from, to, value);
    if (outcome === "lost" || outcome === "blocked") return "may-lose";
    if (outcome === "changed") converts = true;
  }
  return converts ? "converts" : "keeps";
}
