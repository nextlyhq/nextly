/**
 * A Filter setting's one condition, written as a widget query's `where` and
 * read back as the row that wrote it.
 */
import { describe, expect, it } from "vitest";

import {
  conditionToWhere,
  conditionTypeOf,
  filterOperatorsFor,
  whereToCondition,
} from "../content-filter";

const typeOf = (field: string) =>
  ({ publishedAt: "date", views: "number", featured: "boolean" })[field] ??
  "string";

describe("a Filter setting's condition", () => {
  it("writes the query's operator names, not the row's", () => {
    expect(
      conditionToWhere({ field: "title", operator: "notEquals", value: "x" })
    ).toEqual({ title: { not_equals: "x" } });
    expect(
      conditionToWhere({ field: "views", operator: "greaterThan", value: 3 })
    ).toEqual({ views: { greater_than: 3 } });
    expect(conditionToWhere({ field: "title", operator: "isEmpty" })).toEqual({
      title: { exists: false },
    });
    expect(
      conditionToWhere({
        field: "views",
        operator: "between",
        value: { min: 1, max: 9 },
      })
    ).toEqual({ views: { greater_than_equal: 1, less_than_equal: 9 } });
  });

  it("reads back every condition it writes as the same condition", () => {
    const conditions = [
      { field: "title", operator: "equals", value: "a" },
      { field: "title", operator: "notEquals", value: "a" },
      { field: "title", operator: "contains", value: "a" },
      { field: "title", operator: "isEmpty" },
      { field: "title", operator: "isNotEmpty" },
      { field: "views", operator: "lessThanOrEqual", value: 4 },
      { field: "views", operator: "between", value: { min: 1, max: 9 } },
      { field: "publishedAt", operator: "before", value: "2026-01-01" },
      { field: "publishedAt", operator: "after", value: "2026-01-01" },
      { field: "featured", operator: "isTrue" },
      { field: "featured", operator: "isNotTrue" },
    ] as const;
    for (const condition of conditions) {
      expect(
        whereToCondition(conditionToWhere(condition), typeOf),
        condition.operator
      ).toEqual(condition);
    }
  });

  it("writes nothing for a condition not yet complete", () => {
    expect(conditionToWhere(undefined)).toBeUndefined();
    expect(
      conditionToWhere({ field: "title", operator: "equals" })
    ).toBeUndefined();
    expect(
      conditionToWhere({ field: "", operator: "equals", value: "a" })
    ).toBeUndefined();
  });

  it("reads a stored filter of any other shape as no condition", () => {
    // Two fields, or an operator the row has no name for: an empty row, not
    // a row misstating what the card filters on.
    expect(
      whereToCondition({ a: { equals: 1 }, b: { equals: 2 } }, typeOf)
    ).toBeUndefined();
    expect(whereToCondition({ a: { in: [1, 2] } }, typeOf)).toBeUndefined();
    expect(whereToCondition("nonsense", typeOf)).toBeUndefined();
  });

  it("reads a source field's kind as the row's field type", () => {
    expect(conditionTypeOf({ type: "string" })).toBe("text");
    expect(conditionTypeOf({ type: "string", choices: [{ value: "a" }] })).toBe(
      "select"
    );
    expect(conditionTypeOf({ type: "date" })).toBe("date");
    expect(conditionTypeOf({ type: "boolean" })).toBe("boolean");
  });

  it("offers only operators a widget query can carry", () => {
    // The row offers these four beside the rest for text, so their absence
    // is the filter's doing and not a type the row does not know.
    const text = filterOperatorsFor(conditionTypeOf({ type: "string" }));
    expect(text).toContain("contains");
    expect(text).toContain("notEquals");
    expect(text).not.toContain("startsWith");
    expect(text).not.toContain("endsWith");
    expect(text).not.toContain("notContains");
  });
});
