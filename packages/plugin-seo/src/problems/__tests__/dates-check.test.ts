/**
 * The site check for sitemap dates set to "now": more than half of the
 * sitemap's addresses, and at least 20, dated the day of the check, on two
 * full checks made on different days.
 */
import { describe, expect, it } from "vitest";

import { KIND_SEVERITY, KIND_TEXT } from "../contract";
import { datesCheckOutcome, datesMatchDay } from "../dates-check";

const DAY = "2026-11-13";
const dated = (count: number, day: string) =>
  Array.from({ length: count }, (_, at) => `${day}T0${at % 10}:00:00.000Z`);

describe("sitemap dates that match the day they are checked", () => {
  it("match where more than half of the addresses, and at least 20, carry the day", () => {
    expect(
      datesMatchDay([...dated(21, DAY), ...dated(19, "2026-01-02")], DAY)
    ).toBe(true);
    // Half is not more than half.
    expect(
      datesMatchDay([...dated(20, DAY), ...dated(20, "2026-01-02")], DAY)
    ).toBe(false);
    // A small site whose every page changed today is not the pattern.
    expect(datesMatchDay(dated(19, DAY), DAY)).toBe(false);
    // An address with no date carries no day.
    expect(
      datesMatchDay([...dated(21, DAY), ...Array(30).fill(undefined)], DAY)
    ).toBe(false);
  });

  it("is a problem only on the second matching check, on another day", () => {
    expect(datesCheckOutcome(true, undefined, DAY)).toEqual({
      problem: false,
      matchedOn: DAY,
    });
    // Two checks on one day are one day's evidence.
    expect(datesCheckOutcome(true, DAY, DAY)).toEqual({
      problem: false,
      matchedOn: DAY,
    });
    expect(datesCheckOutcome(true, "2026-11-12", DAY)).toEqual({
      problem: true,
      matchedOn: DAY,
    });
    // A check that does not match starts the count again.
    expect(datesCheckOutcome(false, "2026-11-12", DAY)).toEqual({
      problem: false,
      matchedOn: undefined,
    });
  });

  it("passes a site whose content was all published on one earlier day", () => {
    const moved = dated(120, "2026-10-01");
    expect(datesMatchDay(moved, "2026-10-02")).toBe(false);
    expect(datesMatchDay(moved, DAY)).toBe(false);
  });

  it("is a site-wide warning, as the problem table gives it", () => {
    expect(KIND_SEVERITY.datesToday).toBe("warning");
    expect(KIND_TEXT.datesToday.siteWide).toBe(true);
  });
});
