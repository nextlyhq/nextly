/**
 * Which fields a form's conditions hide: decided in the order the conditions
 * depend on each other, with a fixed rule for conditions that read each other
 * in a loop, so the answer never depends on unrelated fields or field order.
 */
import { describe, expect, it } from "vitest";

import type { AnyFormField, ConditionalLogic } from "../types";

import { fieldsHiddenByCondition } from "./condition-visibility";

function text(
  name: string,
  action?: ConditionalLogic["action"],
  reads?: string
): AnyFormField {
  return {
    type: "text",
    name,
    label: name,
    ...(action && reads
      ? {
          conditionalLogic: {
            enabled: true,
            action,
            operator: "AND",
            conditions: [{ field: reads, comparison: "isNotEmpty" }],
          },
        }
      : {}),
  };
}

const hidden = (fields: AnyFormField[], answers: Record<string, unknown>) =>
  [...fieldsHiddenByCondition(fields, answers)].sort();

describe("fieldsHiddenByCondition", () => {
  it("hides a field whose condition is not met", () => {
    expect(hidden([text("a"), text("b", "show", "a")], {})).toEqual(["b"]);
    expect(hidden([text("a"), text("b", "show", "a")], { a: "x" })).toEqual([]);
  });

  it("ignores a hidden field's leftover answer, in any field order", () => {
    // c shows once b is answered, b once a is: with a blank, b's leftover
    // answer must not keep c on the page, wherever c sits on the form.
    const fields = [text("c", "show", "b"), text("b", "show", "a"), text("a")];
    expect(hidden(fields, { b: "left over", c: "x" })).toEqual(["b", "c"]);
  });

  it("brings back a field a hidden field's leftover answer would hide", () => {
    // b hides when c is answered, but c is itself hidden (a is blank), so
    // its leftover answer must not hide b.
    const fields = [text("b", "hide", "c"), text("c", "show", "a"), text("a")];
    expect(hidden(fields, { c: "left over" })).toEqual(["c"]);
  });

  it("decides a loop by the loop's own answers, as given", () => {
    // a hides when b is answered and b hides when a is: each reads the
    // other's answer as given, so both are hidden.
    const loop = [text("a", "hide", "b"), text("b", "hide", "a")];
    expect(hidden(loop, { a: "x", b: "y" })).toEqual(["a", "b"]);
    expect(hidden(loop, { a: "x" })).toEqual(["b"]);
  });

  it("gives the same answer for a loop whatever else is on the form", () => {
    const loop = [text("a", "hide", "b"), text("b", "hide", "a")];
    const answers = { a: "x", b: "y" };
    const alone = hidden(loop, answers);
    expect(hidden([...loop, text("unrelated")], answers)).toEqual(alone);
    expect(
      hidden([text("one"), ...loop, text("two"), text("three")], answers)
    ).toEqual(alone);
  });

  it("decides a field that reads a loop once the loop is decided", () => {
    const fields = [
      text("after", "show", "a"),
      text("a", "hide", "b"),
      text("b", "hide", "a"),
    ];
    // a is hidden by the loop, so its answer does not show `after`.
    expect(hidden(fields, { a: "x", b: "y" })).toEqual(["a", "after", "b"]);
  });

  it("never hides a field with no condition, or one whose condition is off", () => {
    const off: AnyFormField = {
      ...text("b", "show", "a"),
      conditionalLogic: {
        enabled: false,
        action: "show",
        operator: "AND",
        conditions: [{ field: "a", comparison: "isNotEmpty" }],
      },
    };
    expect(hidden([text("a"), off], {})).toEqual([]);
  });
});
