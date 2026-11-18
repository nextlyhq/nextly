/**
 * What a type pair can do to its values, asked without reading any: whether some value the old
 * type holds is cleared. Derived from the per-value judgement, so it is checked against it: any
 * value the judgement clears, among a wider set than the pair is asked about, must make the pair
 * one that can lose.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../../schemas/dynamic-collections";
import type { SupportedDialect } from "../../../services/field-column-descriptor";
import { fieldTypeOnDialect, type FieldTypeOnDialect } from "../field-type";
import { judgeValue, type OldValue } from "../judge";
import { readNumber } from "../numbers";
import { pairCanLose, valuesOf } from "../pair-outcomes";

const DIALECTS: SupportedDialect[] = ["sqlite", "postgresql", "mysql"];

const typeOf = (dialect: SupportedDialect, type: string, extra: object = {}) =>
  fieldTypeOnDialect(
    { name: "f", type, ...extra } as FieldDefinition,
    dialect,
    "collection"
  );

/** The field types the agreement is asked over: one of each family, and a few of their forms. */
const TYPES: [string, object][] = [
  ["text", {}],
  ["textarea", {}],
  ["email", {}],
  ["select", { options: [{ label: "A", value: "a" }] }],
  ["number", {}],
  ["number", { options: { format: "float" } }],
  ["checkbox", {}],
  ["date", {}],
  ["json", {}],
  ["richText", {}],
  ["text", { hasMany: true }],
  ["number", { hasMany: true }],
];

/** More values of each family than the pair is asked about, to catch a kind its set misses. */
function moreValuesOf(from: FieldTypeOnDialect): OldValue[] {
  const texts = ["  ", "A", "a ", "12abc", "0x10", "-0", "1,5", "yes", "2024-13-40", "é".repeat(70_000)];
  const numbers = ["2.5", "1e-30", "99999999999999999999", "-1.5"];
  switch (from.family) {
    case "number":
      return numbers.map(n => {
        const read = readNumber(n);
        return read === null
          ? { kind: "text", text: n }
          : { kind: "number", number: read };
      });
    case "json":
      return [{ kind: "json", value: { b: [1] } }, { kind: "json", value: -0.5 }];
    case "list":
      return [{ kind: "list", items: texts.map(t => ({ kind: "text", text: t })) }];
    case "checkbox":
    case "date":
    case "richText":
      return [];
    default:
      return texts.map(t => ({ kind: "text", text: t }));
  }
}

describe("whether a type pair can clear a value", () => {
  it("says so where some value the old type holds is cleared, and not where none is", () => {
    for (const dialect of DIALECTS) {
      const text = typeOf(dialect, "text");
      expect(pairCanLose(text, typeOf(dialect, "number"))).toBe(true);
      expect(
        pairCanLose(
          text,
          typeOf(dialect, "select", { options: [{ label: "A", value: "a" }] })
        )
      ).toBe(true);
      expect(pairCanLose(text, typeOf(dialect, "textarea"))).toBe(false);
      expect(pairCanLose(typeOf(dialect, "date"), text)).toBe(false);
    }
  });

  it("leaves a pair blocked whatever its values hold to the refusal, not the clearing", () => {
    for (const dialect of DIALECTS) {
      expect(
        pairCanLose(typeOf(dialect, "password"), typeOf(dialect, "text"))
      ).toBe(false);
    }
  });

  it("agrees with the judgement of each value: a pair whose values it clears can lose", () => {
    for (const dialect of DIALECTS) {
      for (const [fromType, fromExtra] of TYPES) {
        const from = typeOf(dialect, fromType, fromExtra);
        for (const [toType, toExtra] of TYPES) {
          const to = typeOf(dialect, toType, toExtra);
          const cleared = [...valuesOf(from), ...moreValuesOf(from)].some(
            value => judgeValue(from, to, value).outcome === "lost"
          );
          if (cleared) {
            expect(
              [dialect, fromType, fromExtra, toType, toExtra, pairCanLose(from, to)]
            ).toEqual([dialect, fromType, fromExtra, toType, toExtra, true]);
          }
        }
      }
    }
  });
});
