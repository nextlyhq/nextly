/**
 * The settings sheet's reading of a textarea's bound: counted in characters,
 * as the layout write counts it, and kept off the textarea's native attribute.
 */
import type { AnyWidgetSetting, WidgetSetting } from "nextly/config";
import { describe, expect, it } from "vitest";

import { drawnSetting, overlongSetting } from "../setting-length";

const note: WidgetSetting = {
  name: "text",
  type: "textarea",
  label: "Note",
  maxLength: 5,
};

describe("a textarea's bound in the sheet", () => {
  it("names the first setting over its bound, counted in characters", () => {
    expect(overlongSetting([note], { text: "hello!" })).toEqual({
      name: "text",
      maxLength: 5,
    });
    expect(overlongSetting([note], { text: "hello" })).toBeUndefined();
    expect(overlongSetting([note], { text: "😀😀😀😀😀" })).toBeUndefined();
  });

  it("judges only a textarea that declares a bound, and only text", () => {
    const unbounded: AnyWidgetSetting = { name: "text", type: "textarea" };
    expect(
      overlongSetting([unbounded], { text: "x".repeat(99) })
    ).toBeUndefined();
    expect(overlongSetting([note], { text: 123456 })).toBeUndefined();
  });

  it("hands the textarea no maxLength, and every other setting as it is", () => {
    expect(drawnSetting(note)).not.toHaveProperty("maxLength");
    expect(drawnSetting(note)).toMatchObject({
      name: "text",
      type: "textarea",
    });
    const items: WidgetSetting = { name: "items", type: "number", max: 9 };
    expect(drawnSetting(items)).toBe(items);
  });
});
