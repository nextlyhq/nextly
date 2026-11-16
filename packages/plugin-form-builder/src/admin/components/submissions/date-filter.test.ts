/**
 * The date filter's presets and ranges as the moments they cover. The test
 * runs in a timezone ahead of UTC, so a range computed from UTC days instead
 * of the reader's own would start five hours late and fail here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dateChoiceLabel, sentRange } from "./date-filter";

const ZONE = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Asia/Karachi";
});
afterAll(() => {
  process.env.TZ = ZONE;
});

/** 15:30 on 12 November 2026 in Karachi (UTC+5). */
const NOW = new Date("2026-11-12T10:30:00.000Z");

describe("sentRange", () => {
  it("leaves any date unbounded", () => {
    expect(sentRange({ kind: "any" }, NOW)).toEqual({});
  });

  it("starts Today at the reader's midnight, not UTC's", () => {
    expect(sentRange({ kind: "today" }, NOW)).toEqual({
      from: "2026-11-11T19:00:00.000Z",
    });
  });

  it("counts today as the last of the last 7 and 30 days", () => {
    expect(sentRange({ kind: "last7" }, NOW)).toEqual({
      from: "2026-11-05T19:00:00.000Z",
    });
    expect(sentRange({ kind: "last30" }, NOW)).toEqual({
      from: "2026-10-13T19:00:00.000Z",
    });
  });

  it("runs a range to the start of the day after its last", () => {
    expect(
      sentRange(
        { kind: "range", firstDay: "2026-11-01", lastDay: "2026-11-03" },
        NOW
      )
    ).toEqual({
      from: "2026-10-31T19:00:00.000Z",
      to: "2026-11-03T19:00:00.000Z",
    });
  });

  it("leaves out an end that is not given, or is not a day", () => {
    expect(
      sentRange({ kind: "range", firstDay: "2026-11-01", lastDay: "" }, NOW)
    ).toEqual({ from: "2026-10-31T19:00:00.000Z" });
    expect(
      sentRange({ kind: "range", firstDay: "soon", lastDay: "2026-11-01" }, NOW)
    ).toEqual({ to: "2026-11-01T19:00:00.000Z" });
  });
});

describe("dateChoiceLabel", () => {
  it("names a preset", () => {
    expect(dateChoiceLabel({ kind: "last7" })).toBe("Last 7 days");
  });

  it("names a range by its days, and a one-day range once", () => {
    const first = new Date(2026, 10, 1).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
    const last = new Date(2026, 10, 3).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
    expect(
      dateChoiceLabel({
        kind: "range",
        firstDay: "2026-11-01",
        lastDay: "2026-11-03",
      })
    ).toBe(`${first} – ${last}`);
    expect(
      dateChoiceLabel({
        kind: "range",
        firstDay: "2026-11-01",
        lastDay: "2026-11-01",
      })
    ).toBe(first);
    expect(dateChoiceLabel({ kind: "range", firstDay: "2026-11-01" })).toBe(
      `From ${first}`
    );
  });
});
