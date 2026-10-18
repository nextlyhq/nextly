/**
 * Days in a named zone as spans of instants, and a window tallied by day.
 *
 * The property that separates a correct day from a plausible one is its LENGTH
 * on a daylight-saving date and its START where a zone moves its clocks at
 * midnight: "midnight plus 24 hours" and "midnight at today's offset" both
 * give the right answer on every ordinary day and the wrong one on exactly
 * those. So each case below is one of those dates, in a zone that has one.
 *
 * @module domains/releases/__tests__/release-calendar.test
 */
import { describe, expect, it } from "vitest";

import {
  RELEASE_CALENDAR_MAX_DAYS,
  tallyByDay,
  zonedDay,
  zonedDays,
  type PlacedRelease,
} from "../release-calendar";

const HOUR = 60 * 60 * 1000;

/** A day's span as ISO strings, which read clearly in a failure. */
function span(date: string, timezone: string) {
  const day = zonedDay({ date, timezone });
  return {
    start: day.start.toISOString(),
    end: day.end.toISOString(),
    hours: (day.end.getTime() - day.start.getTime()) / HOUR,
  };
}

function placed(
  id: string,
  at: string,
  state: PlacedRelease["state"] = "scheduled"
): PlacedRelease {
  return { id, state, scheduledAt: new Date(at) };
}

describe("a day in a zone", () => {
  it("is 23 hours on the day the clocks go forward, and 25 on the day they go back", () => {
    // Berlin moves from +01:00 to +02:00 at 02:00 on 2026-03-29, and back at
    // 03:00 on 2026-10-25. Midnight-plus-24-hours ends both days an hour wrong.
    expect(span("2026-03-29", "Europe/Berlin")).toEqual({
      start: "2026-03-28T23:00:00.000Z",
      end: "2026-03-29T22:00:00.000Z",
      hours: 23,
    });
    expect(span("2026-10-25", "Europe/Berlin")).toEqual({
      start: "2026-10-24T22:00:00.000Z",
      end: "2026-10-25T23:00:00.000Z",
      hours: 25,
    });
    // The same in a zone west of Greenwich, with its own dates.
    expect(span("2026-03-08", "America/New_York").hours).toBe(23);
    expect(span("2026-11-01", "America/New_York").hours).toBe(25);
  });

  it("starts when the clock first shows the date, where a zone skips midnight", () => {
    // Havana goes forward at 00:00 on 2026-03-08: the clock reads 23:59:59 on
    // the 7th and then 01:00:00 on the 8th, at 05:00 UTC. Midnight at the
    // offset in force once the day has begun is 04:00 UTC, still 23:00 on the
    // 7th, which would put the last hour of the 7th on the 8th.
    expect(span("2026-03-08", "America/Havana")).toEqual({
      start: "2026-03-08T05:00:00.000Z",
      end: "2026-03-09T04:00:00.000Z",
      hours: 23,
    });
    expect(span("2026-03-07", "America/Havana").end).toBe(
      "2026-03-08T05:00:00.000Z"
    );
  });

  it("starts at the first of two midnights, where a zone repeats midnight", () => {
    // Havana goes back at 01:00 on 2026-11-01 to 00:00, so the clock shows
    // 00:00 on the 1st twice: at 04:00 and at 05:00 UTC. The day begins at the
    // first, and the hour between belongs to it, not to 31 October.
    expect(span("2026-11-01", "America/Havana")).toEqual({
      start: "2026-11-01T04:00:00.000Z",
      end: "2026-11-02T05:00:00.000Z",
      hours: 25,
    });
  });

  it("has no instants at all on a date the zone skipped", () => {
    // Samoa crossed the date line at the end of 2011-12-29 and never had a
    // 30 December; its 29th runs straight into the 31st.
    const skipped = span("2011-12-30", "Pacific/Apia");
    expect(skipped.hours).toBe(0);
    expect(span("2011-12-29", "Pacific/Apia").end).toBe(skipped.start);
  });

  it("leaves no gap and no overlap between the days of a window crossing a change", () => {
    const days = zonedDays({
      from: "2026-03-27",
      to: "2026-03-31",
      timezone: "Europe/Berlin",
    });
    expect(days.map(day => day.date)).toEqual([
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
      "2026-03-31",
    ]);
    for (let i = 1; i < days.length; i += 1) {
      expect(days[i].start.getTime()).toBe(days[i - 1].end.getTime());
    }
  });
});

describe("placing a release on its day", () => {
  it("puts 23:30 in New York on that day there, and on the next day in London", () => {
    // 23:30 on 14 July in New York (-04:00) is 03:30 UTC on the 15th, and
    // 04:30 in London (+01:00).
    const late = [placed("late", "2026-07-15T03:30:00Z")];
    const window = { from: "2026-07-14", to: "2026-07-15" };

    const inNewYork = tallyByDay(
      zonedDays({ ...window, timezone: "America/New_York" }),
      late,
      3
    );
    const inLondon = tallyByDay(
      zonedDays({ ...window, timezone: "Europe/London" }),
      late,
      3
    );

    expect(inNewYork.map(day => [day.date, day.firstIds])).toEqual([
      ["2026-07-14", ["late"]],
      ["2026-07-15", []],
    ]);
    expect(inLondon.map(day => [day.date, day.firstIds])).toEqual([
      ["2026-07-14", []],
      ["2026-07-15", ["late"]],
    ]);
  });

  it("puts a release at the instant one day ends on the next day only", () => {
    const days = zonedDays({
      from: "2026-03-28",
      to: "2026-03-29",
      timezone: "Europe/Berlin",
    });
    const atMidnight = placed("midnight", days[1].start.toISOString());
    const tallies = tallyByDay(days, [atMidnight], 3);
    expect(tallies.map(day => day.total)).toEqual([0, 1]);
  });

  it("counts every release on a busy day by state, and keeps the first three", () => {
    const days = zonedDays({
      from: "2026-05-04",
      to: "2026-05-05",
      timezone: "UTC",
    });
    // In the order the day's list shows them, as the read hands them over.
    const busy = [
      placed("a", "2026-05-04T08:00:00Z", "published"),
      placed("b", "2026-05-04T09:00:00Z", "blocked"),
      placed("c", "2026-05-04T10:00:00Z", "scheduled"),
      placed("d", "2026-05-04T11:00:00Z", "scheduled"),
      placed("e", "2026-05-04T12:00:00Z", "cancelled"),
      placed("next", "2026-05-05T00:00:00Z", "scheduled"),
    ];

    const [first, second] = tallyByDay(days, busy, 3);

    expect(first).toEqual({
      date: "2026-05-04",
      total: 5,
      counts: {
        draft: 0,
        scheduled: 2,
        published: 1,
        cancelled: 1,
        blocked: 1,
      },
      firstIds: ["a", "b", "c"],
    });
    expect(second.total).toBe(1);
    expect(second.firstIds).toEqual(["next"]);
  });

  it("refuses to drop a release that lies on none of the days", () => {
    const days = zonedDays({
      from: "2026-05-04",
      to: "2026-05-04",
      timezone: "UTC",
    });
    expect(() =>
      tallyByDay(days, [placed("outside", "2026-05-06T00:00:00Z")], 3)
    ).toThrow(expect.objectContaining({ code: "INTERNAL_ERROR" }));
  });
});

describe("the last day a date can be written", () => {
  // The day after 9999-12-31 is 10000-01-01, which sorts BEFORE every
  // four-digit year as text. A comparison of dates as strings then reads every
  // instant of the last day as already past the next, and ends that day where
  // it began.
  const END_OF_9999 = new Date(0);
  END_OF_9999.setUTCFullYear(10000, 0, 1);

  it("ends a window on 9999-12-31 at the start of the year 10000", () => {
    const days = zonedDays({
      from: "9999-12-30",
      to: "9999-12-31",
      timezone: "UTC",
    });
    expect(days.map(day => day.date)).toEqual(["9999-12-30", "9999-12-31"]);
    expect(days[1].end.getTime()).toBe(END_OF_9999.getTime());
    expect(days[1].end.getTime() - days[1].start.getTime()).toBe(24 * HOUR);
  });

  it("gives the day filter's 9999-12-31 its whole 24 hours, in a zone too", () => {
    const day = zonedDay({ date: "9999-12-31", timezone: "Europe/Berlin" });
    expect(day.end.getTime() - day.start.getTime()).toBe(24 * HOUR);
    expect(day.end.getTime()).toBe(END_OF_9999.getTime() - HOUR);
  });
});

describe("a calendar window", () => {
  const zone = { timezone: "Europe/Berlin" };

  it("is at most six weeks", () => {
    expect(RELEASE_CALENDAR_MAX_DAYS).toBe(42);
    expect(
      zonedDays({ ...zone, from: "2026-03-01", to: "2026-04-11" })
    ).toHaveLength(42);
    expect(() =>
      zonedDays({ ...zone, from: "2026-03-01", to: "2026-04-12" })
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_INPUT",
        publicMessage: expect.stringContaining("at most 42 days"),
      })
    );
  });

  it("refuses an end before its start", () => {
    expect(() =>
      zonedDays({ ...zone, from: "2026-03-02", to: "2026-03-01" })
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_INPUT",
        publicMessage: expect.stringContaining("`to`"),
      })
    );
  });

  it("refuses a zone the platform does not know, a malformed date and one that does not exist", () => {
    for (const window of [
      { from: "2026-03-01", to: "2026-03-02", timezone: "Europe/Berln" },
      { from: "2026-3-1", to: "2026-03-02", timezone: "UTC" },
      { from: "2026-02-28", to: "2026-02-30", timezone: "UTC" },
      { from: 20260301, to: "2026-03-02", timezone: "UTC" },
    ]) {
      expect(() => zonedDays(window)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" })
      );
    }
  });
});
