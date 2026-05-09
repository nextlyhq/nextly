// Why: pure-function evaluator for FieldCondition. Lock semantics for
// every operator so future changes to the visual builder can't silently
// drift from what the runtime evaluator does. Backwards-compat path
// (legacy { field, equals } shape) is also covered.
import { describe, expect, it } from "vitest";

import type { FieldCondition } from "@admin/components/features/schema-builder/types";

import { evaluateCondition } from "../condition-evaluator";

describe("evaluateCondition -- backwards compat (legacy { field, equals })", () => {
  it("treats { equals } as { operator: 'equals', value }", () => {
    const cond: FieldCondition = { field: "status", equals: "draft" };
    expect(evaluateCondition(cond, "draft")).toBe(true);
    expect(evaluateCondition(cond, "published")).toBe(false);
  });

  it("compares as strings (matches legacy FieldRenderer behavior)", () => {
    const cond: FieldCondition = { field: "n", equals: "5" };
    expect(evaluateCondition(cond, 5)).toBe(true); // 5 -> "5"
  });
});

describe("evaluateCondition -- equals / notEquals", () => {
  it("equals returns true on string equality", () => {
    const cond: FieldCondition = {
      field: "x",
      operator: "equals",
      value: "draft",
    };
    expect(evaluateCondition(cond, "draft")).toBe(true);
    expect(evaluateCondition(cond, "published")).toBe(false);
  });

  it("notEquals is the inverse", () => {
    const cond: FieldCondition = {
      field: "x",
      operator: "notEquals",
      value: "draft",
    };
    expect(evaluateCondition(cond, "draft")).toBe(false);
    expect(evaluateCondition(cond, "published")).toBe(true);
  });
});

describe("evaluateCondition -- text operators", () => {
  it("contains / notContains", () => {
    const cond: FieldCondition = {
      field: "x",
      operator: "contains",
      value: "fee",
    };
    expect(evaluateCondition(cond, "coffee")).toBe(true);
    expect(evaluateCondition(cond, "tea")).toBe(false);

    const inv: FieldCondition = { ...cond, operator: "notContains" };
    expect(evaluateCondition(inv, "coffee")).toBe(false);
    expect(evaluateCondition(inv, "tea")).toBe(true);
  });

  it("startsWith / endsWith", () => {
    const start: FieldCondition = {
      field: "x",
      operator: "startsWith",
      value: "draft-",
    };
    expect(evaluateCondition(start, "draft-1")).toBe(true);
    expect(evaluateCondition(start, "x-draft")).toBe(false);

    const end: FieldCondition = {
      field: "x",
      operator: "endsWith",
      value: ".md",
    };
    expect(evaluateCondition(end, "post.md")).toBe(true);
    expect(evaluateCondition(end, "post.txt")).toBe(false);
  });

  it("isEmpty / isNotEmpty (no value)", () => {
    const empty: FieldCondition = { field: "x", operator: "isEmpty" };
    expect(evaluateCondition(empty, "")).toBe(true);
    expect(evaluateCondition(empty, undefined)).toBe(true);
    expect(evaluateCondition(empty, null)).toBe(true);
    expect(evaluateCondition(empty, "anything")).toBe(false);

    const notEmpty: FieldCondition = { field: "x", operator: "isNotEmpty" };
    expect(evaluateCondition(notEmpty, "anything")).toBe(true);
    expect(evaluateCondition(notEmpty, "")).toBe(false);
  });
});

describe("evaluateCondition -- number / date operators", () => {
  it("greaterThan / lessThan / greaterThanOrEqual / lessThanOrEqual", () => {
    expect(
      evaluateCondition({ field: "x", operator: "greaterThan", value: 10 }, 15)
    ).toBe(true);
    expect(
      evaluateCondition({ field: "x", operator: "lessThan", value: 10 }, 5)
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "x", operator: "greaterThanOrEqual", value: 10 },
        10
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "x", operator: "lessThanOrEqual", value: 10 },
        10
      )
    ).toBe(true);
  });

  it("between (inclusive range)", () => {
    const cond: FieldCondition = {
      field: "x",
      operator: "between",
      value: { min: 5, max: 10 },
    };
    expect(evaluateCondition(cond, 5)).toBe(true);
    expect(evaluateCondition(cond, 7)).toBe(true);
    expect(evaluateCondition(cond, 10)).toBe(true);
    expect(evaluateCondition(cond, 4)).toBe(false);
    expect(evaluateCondition(cond, 11)).toBe(false);
  });

  it("before / after for ISO date strings", () => {
    const before: FieldCondition = {
      field: "x",
      operator: "before",
      value: "2026-06-01",
    };
    expect(evaluateCondition(before, "2026-05-15")).toBe(true);
    expect(evaluateCondition(before, "2026-06-15")).toBe(false);

    const after: FieldCondition = {
      field: "x",
      operator: "after",
      value: "2026-06-01",
    };
    expect(evaluateCondition(after, "2026-06-15")).toBe(true);
  });
});

describe("evaluateCondition -- boolean operators", () => {
  it("isTrue / isNotTrue", () => {
    expect(evaluateCondition({ field: "x", operator: "isTrue" }, true)).toBe(
      true
    );
    expect(evaluateCondition({ field: "x", operator: "isTrue" }, false)).toBe(
      false
    );
    expect(
      evaluateCondition({ field: "x", operator: "isNotTrue" }, false)
    ).toBe(true);
    expect(evaluateCondition({ field: "x", operator: "isNotTrue" }, null)).toBe(
      true
    );
  });
});

describe("evaluateCondition -- safety", () => {
  it("returns true (visible) when condition is undefined", () => {
    expect(evaluateCondition(undefined, "anything")).toBe(true);
  });

  it("returns true (visible) when operator is unknown", () => {
    // Defensive: future operators added to the union but not handled
    // by the evaluator default to visible (fail-open) so existing
    // fields don't disappear when this code is older than the data.
    const cond = {
      field: "x",
      operator: "futureOp",
    } as unknown as FieldCondition;
    expect(evaluateCondition(cond, "x")).toBe(true);
  });
});
