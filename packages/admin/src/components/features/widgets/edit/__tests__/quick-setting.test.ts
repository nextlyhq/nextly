/**
 * Which setting a card draws in its header, and how its value is said.
 */
import type { AnyWidgetSetting } from "nextly/config";
import { describe, expect, it } from "vitest";

import { quickSettingOf, quickValueLabel } from "../quick-setting";

const range: AnyWidgetSetting = {
  name: "range",
  type: "select",
  label: "Date range",
  quick: true,
  options: [
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
  ],
};

describe("a card's quick setting", () => {
  it("is the one its widget marks quick, when the header can draw it", () => {
    const items: AnyWidgetSetting = { name: "items", type: "number" };
    expect(quickSettingOf([items, range])).toBe(range);
    // A quick number has no header control; it is changed in the drawer alone.
    expect(
      quickSettingOf([{ name: "n", type: "number", quick: true }])
    ).toBeUndefined();
    expect(quickSettingOf([items])).toBeUndefined();
    expect(quickSettingOf(undefined)).toBeUndefined();
  });

  it("says a choice by its label and a toggle as On or Off", () => {
    expect(quickValueLabel(range as never, "7d")).toBe("Last 7 days");
    const mine = { name: "mine", type: "checkbox", quick: true } as const;
    expect(quickValueLabel(mine, true)).toBe("On");
    expect(quickValueLabel(mine, false)).toBe("Off");
  });
});

describe("the header's quick setting, among several marked", () => {
  it("is the first marked one the header can draw, not the first marked", () => {
    // A quick number is marked first; the header cannot draw it, so the choice after it is drawn.
    const goal: AnyWidgetSetting = {
      name: "goal",
      type: "number",
      quick: true,
    };
    expect(quickSettingOf([goal, range])).toBe(range);
  });
});
