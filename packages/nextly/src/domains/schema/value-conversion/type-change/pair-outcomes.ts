/**
 * What a field's type change can do to its values, asked of the type pair alone: for a road that
 * reads no stored value (`migrate:create`), which must still say whether a change may clear one.
 * Derived from the per-value judgement (`judgeValue`), never restated beside it: the pair can lose
 * a value where some value the old type can hold is judged lost.
 *
 * @module domains/schema/value-conversion/type-change/pair-outcomes
 */
import type { FieldTypeOnDialect } from "./field-type";
import { judgeValue, type OldValue } from "./judge";
import { readNumber } from "./numbers";

/**
 * Texts that stand for the kinds of value a text, email, option or relationship id can hold: blank,
 * a word, numbers in their forms, a boolean's words, dates with and without a time, an email, JSON,
 * and a value longer than a bounded column holds.
 */
const TEXTS = [
  "",
  "a",
  "abc",
  "5",
  "01",
  "1.5",
  "-7",
  "1e400",
  "NaN",
  "Infinity",
  "true",
  "false",
  "1",
  "0",
  "2024-01-02",
  "2024-01-02T03:04:05Z",
  "2024-01-02T03:04:05",
  "a@b.io",
  '{"a":1}',
  "[1,2]",
  "x".repeat(70_000),
];

const NUMBERS = ["0", "5", "-7", "1.5", "0.1", "1e30", "NaN", "Infinity", "-Infinity"];

const text = (t: string): OldValue => ({ kind: "text", text: t });

function number(writing: string): OldValue {
  const read = readNumber(writing);
  return read === null ? text(writing) : { kind: "number", number: read };
}

const DATES: OldValue[] = [
  { kind: "date", date: { seconds: 0, fraction: "" } },
  { kind: "date", date: { seconds: 1_704_164_645, fraction: "123" } },
];

const JSONS: unknown[] = [
  "a",
  "5",
  5,
  1.5,
  true,
  null,
  [],
  ["a"],
  [1, 2],
  { a: 1 },
  { type: "doc", content: [] },
];

/** The values a field of `from`'s type can hold, one of each kind its stored form allows. */
export function valuesOf(from: FieldTypeOnDialect): OldValue[] {
  switch (from.family) {
    case "number":
      return NUMBERS.map(number);
    case "checkbox":
      return [
        { kind: "boolean", value: true },
        { kind: "boolean", value: false },
      ];
    case "date":
      return DATES;
    case "json":
      return JSONS.map(value => ({ kind: "json", value }));
    case "richText":
      return [
        { kind: "document", value: { type: "doc", content: [] } },
        { kind: "document", value: { root: { children: [] } } },
      ];
    case "list": {
      const items = from.item === undefined ? TEXTS.map(text) : valuesOf(from.item);
      return [
        { kind: "list", items: items.slice(0, 1) },
        ...items.map(item => ({ kind: "list" as const, items: [item] })),
        { kind: "list", items },
      ];
    }
    default:
      return TEXTS.map(text);
  }
}

/**
 * Whether a change from `from` to `to` can clear a stored value: some value the old type holds is
 * judged lost. False for a pair blocked whatever its values hold, which is refused, not cleared.
 */
export function pairCanLose(
  from: FieldTypeOnDialect,
  to: FieldTypeOnDialect
): boolean {
  return valuesOf(from).some(
    value => judgeValue(from, to, value).outcome === "lost"
  );
}
