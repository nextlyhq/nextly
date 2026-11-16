/**
 * A Filter setting's conditions, each a chip, written as a widget query's
 * `where` and read back as the chips that wrote it.
 */
import { describe, expect, it } from "vitest";

import {
  chipText,
  conditionsToWhere,
  conditionToWhere,
  conditionTypeOf,
  filterFieldNames,
  filterOperatorsFor,
  whereToCondition,
  whereToConditions,
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

  it("reads a boolean comparison the row has no operator for as no condition", () => {
    // The boolean row offers is true and is not true. Read as a comparison,
    // these would draw as the row's first operator while the card filtered
    // for false.
    expect(
      whereToCondition({ featured: { equals: false } }, typeOf)
    ).toBeUndefined();
    expect(
      whereToCondition({ featured: { not_equals: false } }, typeOf)
    ).toBeUndefined();
    // The control: the same comparison on a text field is one the row shows.
    expect(whereToCondition({ title: { equals: "x" } }, typeOf)).toEqual({
      field: "title",
      operator: "equals",
      value: "x",
    });
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

describe("a Filter setting's chips", () => {
  const draft = {
    field: "status",
    operator: "equals",
    value: "draft",
  } as const;
  const mine = { field: "author", operator: "equals", value: "me" } as const;

  it("writes one chip as the one condition a Filter always held", () => {
    expect(conditionsToWhere([draft])).toEqual({ status: { equals: "draft" } });
  });

  it("joins two chips or more with AND, and reads them back as the same chips", () => {
    const where = conditionsToWhere([draft, mine]);
    expect(where).toEqual({
      and: [{ status: { equals: "draft" } }, { author: { equals: "me" } }],
    });
    expect(whereToConditions(where, typeOf)).toEqual([draft, mine]);
  });

  it("keeps two chips on one field apart, which one object of fields could not hold", () => {
    const later = {
      field: "views",
      operator: "greaterThan",
      value: 5,
    } as const;
    const fewer = { field: "views", operator: "lessThan", value: 50 } as const;
    expect(
      whereToConditions(conditionsToWhere([later, fewer]), typeOf)
    ).toEqual([later, fewer]);
  });

  it("writes nothing for a chip still being built", () => {
    expect(conditionsToWhere([undefined])).toBeUndefined();
    expect(
      conditionsToWhere([{ field: "status", operator: "equals" }, mine])
    ).toEqual({ author: { equals: "me" } });
  });

  it("reads none as no chips, and an `or` as a filter the chips cannot show", () => {
    expect(whereToConditions("", typeOf)).toEqual([]);
    expect(whereToConditions({}, typeOf)).toEqual([]);
    expect(
      whereToConditions(
        { or: [{ status: { equals: "a" } }, { status: { equals: "b" } }] },
        typeOf
      )
    ).toBeUndefined();
  });

  it("names every field of every chip, so a stale one is found whichever it is", () => {
    expect(
      filterFieldNames({
        and: [{ status: { equals: "a" } }, { salary: { greater_than: 1 } }],
      })
    ).toEqual(["status", "salary"]);
  });

  it("says a chip in the reader's words", () => {
    expect(
      chipText(
        draft,
        () => "Status",
        (_field, value) => (value === "draft" ? "Draft" : value)
      )
    ).toBe("Status is Draft");
  });
});
