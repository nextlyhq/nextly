/**
 * A chart's range read at one instant: the interval it draws in, the instant it
 * starts, and how many intervals it overlaps, the first and the current one
 * partial. Each range is read at midnight UTC and later in the day, on every
 * day of the week, and on the first, a middle and the last day of a month.
 */
import { describe, expect, it } from "vitest";

import { bucketStartUtc } from "../../collections/query/timeseries-interval";
import { rangeWindow, TIMESERIES_RANGES, type TimeseriesRange } from "../query";

const HOUR = 3_600_000;

/**
 * The intervals `[start, now)` overlaps, counted by walking it an hour at a
 * time: a reading that shares only the calendar with `rangeWindow`, not its
 * stepping.
 */
function overlapped(range: TimeseriesRange, now: Date): number {
  const { interval, start } = rangeWindow(range, now);
  const starts = new Set<number>();
  for (let at = start.getTime(); at < now.getTime(); at += HOUR) {
    starts.add(bucketStartUtc(new Date(at), interval).getTime());
  }
  starts.add(bucketStartUtc(new Date(now.getTime() - 1), interval).getTime());
  return starts.size;
}

/** The two counts a range may draw: at an interval's exact start, and after it. */
const POINTS: Record<TimeseriesRange, readonly [number, number]> = {
  "7d": [7, 8],
  "30d": [30, 31],
  "90d": [13, 14],
  "12m": [12, 13],
};

describe("a chart's range", () => {
  it("draws days for 7 and 30 days, ISO weeks for 90, months for 12", () => {
    const now = new Date("2026-03-04T10:20:00.000Z");
    expect(
      TIMESERIES_RANGES.map(range => rangeWindow(range, now).interval)
    ).toEqual(["day", "day", "week", "month"]);
  });

  it("starts at the exact instant that far back, and places its last point a millisecond before now", () => {
    const now = new Date("2026-03-04T10:20:30.400Z");
    expect(rangeWindow("7d", now).start.toISOString()).toBe(
      "2026-02-25T10:20:30.400Z"
    );
    expect(rangeWindow("90d", now).start.toISOString()).toBe(
      "2025-12-04T10:20:30.400Z"
    );
    expect(rangeWindow("12m", now).start.toISOString()).toBe(
      "2025-03-04T10:20:30.400Z"
    );
    expect(rangeWindow("30d", now).anchor.toISOString()).toBe(
      "2026-03-04T10:20:30.399Z"
    );
  });

  it.each([
    // 🔴 At an interval's exact start, the interval opening then holds nothing
    // yet: counted, it would be an empty extra point.
    ["7d", "2026-03-04T00:00:00.000Z", 7],
    ["7d", "2026-03-04T10:20:00.000Z", 8],
    ["30d", "2026-03-04T00:00:00.000Z", 30],
    ["30d", "2026-03-04T23:59:59.999Z", 31],
    // A Monday at midnight: the range starts on a Tuesday, in the week of
    // 1 December, and ends in the week of 23 February.
    ["90d", "2026-03-02T00:00:00.000Z", 13],
    ["90d", "2026-03-02T10:00:00.000Z", 14],
    ["12m", "2026-03-01T00:00:00.000Z", 12],
    ["12m", "2026-03-15T12:00:00.000Z", 13],
    ["12m", "2026-03-31T12:00:00.000Z", 13],
  ] as const)("draws %s at %s as %i points", (range, at, points) => {
    expect(rangeWindow(range, new Date(at)).intervals).toBe(points);
  });

  // Every day of a week (Monday 2 March 2026 to Sunday 8 March), and the first,
  // a middle and the last day of months of 28, 30 and 31 days.
  const days = [
    "2026-03-02",
    "2026-03-03",
    "2026-03-04",
    "2026-03-05",
    "2026-03-06",
    "2026-03-07",
    "2026-03-08",
    "2026-02-01",
    "2026-02-14",
    "2026-02-28",
    "2026-04-01",
    "2026-04-15",
    "2026-04-30",
    "2026-12-31",
  ];
  const times = [
    "00:00:00.000",
    "00:00:00.001",
    "11:30:00.000",
    "23:59:59.999",
  ];

  it.each(TIMESERIES_RANGES)(
    "draws every interval %s overlaps, on every instant read",
    range => {
      for (const day of days) {
        for (const time of times) {
          const now = new Date(`${day}T${time}Z`);
          const { intervals } = rangeWindow(range, now);
          expect(intervals, `${range} at ${now.toISOString()}`).toBe(
            overlapped(range, now)
          );
          expect(POINTS[range], `${range} at ${now.toISOString()}`).toContain(
            intervals
          );
        }
      }
    }
  );
});
