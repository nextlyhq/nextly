/**
 * A widget's own textarea setting: drawn as the field system's textarea, its
 * values held to `maxLength` characters counted in code points, a stored value
 * over it falling back to the default, and a declaration that cannot be read
 * refused at boot.
 */
import { describe, expect, it } from "vitest";

import {
  type AnyWidgetSetting,
  resolveWidgetSettings,
  widgetSettingsProblem,
} from "../settings";

const note: AnyWidgetSetting = {
  name: "text",
  label: "Note",
  type: "textarea",
  defaultValue: "",
  maxLength: 5,
};

describe("a textarea setting's values", () => {
  it("takes text up to its maxLength, counted in characters", () => {
    expect(resolveWidgetSettings([note], { text: "hello" })).toEqual({
      text: "hello",
    });
    // 🔴 Five characters, ten UTF-16 units: a bound counted by `length` would
    // refuse what the reader sees as five characters.
    expect(resolveWidgetSettings([note], { text: "😀😀😀😀😀" })).toEqual({
      text: "😀😀😀😀😀",
    });
  });

  it("falls back to its default for a stored value over its maxLength", () => {
    expect(resolveWidgetSettings([note], { text: "hello!" })).toEqual({
      text: "",
    });
    expect(resolveWidgetSettings([note], { text: 42 })).toEqual({ text: "" });
  });

  it("takes text of any length when it declares none", () => {
    const { maxLength: _bound, ...unbounded } = note as AnyWidgetSetting & {
      maxLength: number;
    };
    expect(
      resolveWidgetSettings([unbounded as AnyWidgetSetting], {
        text: "x".repeat(500),
      })
    ).toEqual({ text: "x".repeat(500) });
  });
});

describe("a textarea setting's declaration", () => {
  it("is admitted, with or without a maxLength", () => {
    expect(widgetSettingsProblem([note])).toBeUndefined();
    expect(
      widgetSettingsProblem([{ name: "text", type: "textarea" }])
    ).toBeUndefined();
  });

  it("is refused with a maxLength that is not a whole number above zero", () => {
    for (const maxLength of [0, -1, 2.5, "10", Number.NaN]) {
      expect(
        widgetSettingsProblem([
          { ...note, maxLength } as unknown as AnyWidgetSetting,
        ]),
        String(maxLength)
      ).toContain("maxLength");
    }
  });

  it("is refused with a default longer than its maxLength", () => {
    expect(
      widgetSettingsProblem([{ ...note, defaultValue: "too long" }])
    ).toContain("longer than its maxLength of 5 characters");
  });
});
