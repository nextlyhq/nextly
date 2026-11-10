/**
 * A calendar day as a list stores one: every day that exists, the years
 * before 100 included, and nothing else.
 */
import { describe, expect, it } from "vitest";

import { isCalendarDay } from "./calendar-day";

describe("isCalendarDay", () => {
  it("takes a day in a year before 100, which Date.UTC would read as 19xx", () => {
    expect(isCalendarDay("0099-12-31")).toBe(true);
    expect(isCalendarDay("0004-02-29")).toBe(true);
  });

  it("refuses a day that does not exist, and anything not written YYYY-MM-DD", () => {
    expect(isCalendarDay("0099-02-29")).toBe(false);
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay("2026-2-3")).toBe(false);
    expect(isCalendarDay(20260203)).toBe(false);
  });

  it("takes an ordinary day", () => {
    expect(isCalendarDay("2026-11-07")).toBe(true);
  });
});
