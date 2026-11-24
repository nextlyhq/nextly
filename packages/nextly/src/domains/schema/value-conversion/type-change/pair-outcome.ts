/**
 * What a change from one field type to another can do to the values a field of the first type may
 * hold, as a picker marks each type before anything is saved: keeps every value, converts some, or
 * may lose some. Judged by the rules themselves (`judgeValue`), over a value of each kind the old
 * type holds, so the mark never says more than the rules would of a stored value: a stored value
 * the rules would cut or round, or two values a unique field would read as one, are found only by
 * judging the stored values, which the save does.
 *
 * @module domains/schema/value-conversion/type-change/pair-outcome
 */
import { documentOfText } from "./document";
import type { FieldTypeOnDialect } from "./field-type";
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

/** A JSON value of each kind the rules judge (rule 8). */
const JSON_VALUES: readonly unknown[] = [{ a: 1 }, [1, 2], "words", 1.5, true];

function textValue(text: string): OldValue {
  return { kind: "text", text };
}

function numberValues(): OldValue[] {
  return NUMBERS.flatMap(writing => {
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

/** A value of each kind a field of `type` may hold, as the rules read stored values. */
function valuesOf(type: FieldTypeOnDialect): OldValue[] {
  switch (type.family) {
    case "text":
      return TEXTS.map(textValue);
    case "email":
      return [...TEXTS, EMAIL].map(textValue);
    case "choice":
      return [...(type.options ?? []), ...TEXTS].map(textValue);
    case "richText":
      return TEXTS.map(text => ({
        kind: "document" as const,
        value: documentOfText(text),
      }));
    case "number":
      return numberValues();
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
      const items = type.item ? valuesOf(type.item) : TEXTS.map(textValue);
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

/** Whether `type` is a choice, or a list of choices, with no options to judge its values against yet. */
function choiceWithNoOptions(type: FieldTypeOnDialect): boolean {
  if (type.family === "choice") return (type.options ?? []).length === 0;
  return (
    type.family === "list" &&
    type.item !== undefined &&
    choiceWithNoOptions(type.item)
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
  // A choice given no options yet takes them later, and every value is judged against those then.
  if (choiceWithNoOptions(to)) return "may-lose";
  let converts = false;
  // Only values a field of `from` can hold: those the rules keep for the type itself. None of them
  // held means no value here is judged, so nothing says every value is kept.
  const held = valuesOf(from).filter(
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
