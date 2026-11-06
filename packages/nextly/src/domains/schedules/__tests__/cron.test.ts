/**
 * Cron expressions, read in a time zone: lists, ranges, steps, names and the
 * `@` aliases, against known fire times; and both daylight-saving
 * transitions in two time zones, where a local time that does not exist is
 * skipped and one that happens twice fires once.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import {
  isTimeZone,
  latestFireAtOrBefore,
  nextFireAfter,
  parseCron,
} from "../cron";

/** The first fire after `after` (an ISO instant), as an ISO instant. */
function next(source: string, after: string, timeZone?: string) {
  return nextFireAfter(
    parseCron(source),
    new Date(after),
    timeZone
  )?.toISOString();
}

/** The latest fire at or before `at`, as an ISO instant. */
function latest(source: string, at: string, timeZone?: string) {
  return latestFireAtOrBefore(
    parseCron(source),
    new Date(at),
    timeZone
  )?.toISOString();
}

describe("reading a cron expression", () => {
  it.each([
    // Steps, from the start of the field and from a range.
    ["*/15 * * * *", "2026-01-01T00:07:00.000Z", "2026-01-01T00:15:00.000Z"],
    ["5-10/2 * * * *", "2026-01-01T00:07:00.000Z", "2026-01-01T00:09:00.000Z"],
    ["5-10/2 * * * *", "2026-01-01T00:09:00.000Z", "2026-01-01T01:05:00.000Z"],
    // A list, and day names in a range: Friday 2 January to Monday 5 January.
    ["30 2 1,15 * *", "2026-01-01T03:00:00.000Z", "2026-01-15T02:30:00.000Z"],
    ["0 9 * * MON-FRI", "2026-01-02T10:00:00.000Z", "2026-01-05T09:00:00.000Z"],
    // Sunday is 0 and 7, and names are read in any case.
    ["0 12 * * 7", "2026-01-01T00:00:00.000Z", "2026-01-04T12:00:00.000Z"],
    ["0 12 * * sun", "2026-01-01T00:00:00.000Z", "2026-01-04T12:00:00.000Z"],
    ["0 0 1 jan *", "2026-11-05T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
    // With both day fields restricted, either one matching fires (Friday the
    // 2nd comes before the 13th).
    ["0 0 13 * FRI", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"],
    // ... and the date alone fires too: Friday 13 March before Monday the 16th.
    ["0 0 13 * MON", "2026-03-10T00:00:00.000Z", "2026-03-13T00:00:00.000Z"],
    // A day field stepped from `*` still names its days, and a day must then
    // match both fields: odd dates, every other weekday, odd-dated Mondays.
    ["0 0 */2 * *", "2026-01-01T12:00:00.000Z", "2026-01-03T00:00:00.000Z"],
    ["0 0 * * */2", "2026-01-06T12:00:00.000Z", "2026-01-08T00:00:00.000Z"],
    ["0 0 */2 * 1", "2026-01-06T00:00:00.000Z", "2026-01-19T00:00:00.000Z"],
    // The 29th of February, three years on.
    ["0 0 29 2 *", "2026-03-01T00:00:00.000Z", "2028-02-29T00:00:00.000Z"],
    // The aliases.
    ["@yearly", "2026-11-05T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
    ["@annually", "2026-11-05T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
    ["@monthly", "2026-11-05T00:00:00.000Z", "2026-12-01T00:00:00.000Z"],
    ["@weekly", "2026-11-05T00:00:00.000Z", "2026-11-08T00:00:00.000Z"],
    ["@daily", "2026-11-05T10:00:00.000Z", "2026-11-06T00:00:00.000Z"],
    ["@midnight", "2026-11-05T10:00:00.000Z", "2026-11-06T00:00:00.000Z"],
    ["@hourly", "2026-11-05T10:30:00.000Z", "2026-11-05T11:00:00.000Z"],
  ])("%s, after %s, fires next at %s", (source, after, expected) => {
    expect(next(source, after)).toBe(expected);
  });

  it("fires strictly after the moment given, never at it", () => {
    expect(next("0 * * * *", "2026-01-01T10:00:00.000Z")).toBe(
      "2026-01-01T11:00:00.000Z"
    );
  });

  it("finds the latest fire at or before a moment, the moment itself included", () => {
    expect(latest("0 0 1 * *", "2026-11-05T12:00:00.000Z")).toBe(
      "2026-11-01T00:00:00.000Z"
    );
    expect(latest("0 * * * *", "2026-11-05T12:00:00.000Z")).toBe(
      "2026-11-05T12:00:00.000Z"
    );
    expect(latest("@yearly", "2026-11-05T12:00:00.000Z")).toBe(
      "2026-01-01T00:00:00.000Z"
    );
  });

  it("finds a fire as rare as a Sunday 29 February, decades away either side", () => {
    // `*/7` is Sunday alone, and written from `*` it must match with the date:
    // 2032 is the next; looking back from 2059 reaches past eight years to it.
    expect(next("0 0 29 2 */7", "2026-01-01T00:00:00.000Z")).toBe(
      "2032-02-29T00:00:00.000Z"
    );
    expect(latest("0 0 29 2 */7", "2059-12-31T00:00:00.000Z")).toBe(
      "2032-02-29T00:00:00.000Z"
    );
  });

  it("answers no time for a moment that is not one, in any zone", () => {
    const cron = parseCron("@hourly");
    for (const zone of ["UTC", "Europe/Berlin"]) {
      expect(nextFireAfter(cron, new Date(Number.NaN), zone)).toBeNull();
      expect(latestFireAtOrBefore(cron, new Date(Number.NaN), zone)).toBeNull();
    }
  });

  it.each([
    [""],
    ["* * * *"],
    ["* * * * * *"],
    ["60 * * * *"],
    ["* 24 * * *"],
    ["* * 0 * *"],
    ["* * 32 * *"],
    ["* * * 13 *"],
    ["* * * * 8"],
    ["*/0 * * * *"],
    ["5-1 * * * *"],
    ["1,,2 * * * *"],
    ["FOO * * * *"],
    ["* * * * MON-FOO"],
    ["@reboot"],
    // A date no month has: it would never fire.
    ["0 0 30 2 *"],
    ["0 0 31 4,6,9,11 *"],
    // A step too large to be a number.
    ["*/9999999999999999999999 * * * *"],
    ["@every 5m"],
  ])("refuses %j", source => {
    let thrown: unknown;
    try {
      parseCron(source);
    } catch (error) {
      thrown = error;
    }
    expect(NextlyError.is(thrown)).toBe(true);
    expect((thrown as NextlyError).code).toBe("VALIDATION_ERROR");
  });

  it("reads UTC when no time zone is given", () => {
    expect(next("0 9 * * *", "2026-06-01T00:00:00.000Z")).toBe(
      "2026-06-01T09:00:00.000Z"
    );
  });

  it("reads the time in the schedule's time zone", () => {
    // 09:00 in Berlin in summer (CEST, UTC+2) is 07:00 UTC.
    expect(next("0 9 * * *", "2026-06-01T00:00:00.000Z", "Europe/Berlin")).toBe(
      "2026-06-01T07:00:00.000Z"
    );
  });

  it("knows a time zone from a name it doesn't", () => {
    expect(isTimeZone("Europe/Berlin")).toBe(true);
    expect(isTimeZone("America/New_York")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});

describe("daylight saving", () => {
  it("fires a time repeated by a half-hour change once (Australia/Lord_Howe)", () => {
    // 5 April 2026: 02:00 LHDT (UTC+11) falls back to 01:30 LHST (UTC+10:30),
    // so 01:45 happens at 14:45 UTC and again at 15:15 UTC on the 4th.
    const zone = "Australia/Lord_Howe";
    expect(next("45 1 * * *", "2026-04-04T14:00:00.000Z", zone)).toBe(
      "2026-04-04T14:45:00.000Z"
    );
    expect(next("45 1 * * *", "2026-04-04T14:45:00.000Z", zone)).toBe(
      "2026-04-05T15:15:00.000Z"
    );
  });

  describe("Europe/Berlin", () => {
    const zone = "Europe/Berlin";

    it("skips a local time that does not exist", () => {
      // 29 March 2026: 02:00 CET jumps to 03:00 CEST, so 02:30 never happens
      // that day. From 02:30 CET on the 28th (01:30 UTC), the next is 02:30
      // CEST on the 30th (00:30 UTC).
      expect(next("30 2 * * *", "2026-03-28T01:30:00.000Z", zone)).toBe(
        "2026-03-30T00:30:00.000Z"
      );
      // Hourly that morning: 01:00 CET (00:00 UTC), then 03:00 CEST (01:00 UTC).
      expect(next("0 * * * *", "2026-03-29T00:00:00.000Z", zone)).toBe(
        "2026-03-29T01:00:00.000Z"
      );
      // Looking back from later that day, the latest 02:30 is the 28th's.
      expect(latest("30 2 * * *", "2026-03-29T05:00:00.000Z", zone)).toBe(
        "2026-03-28T01:30:00.000Z"
      );
    });

    it("fires a repeated local time once", () => {
      // 25 October 2026: 03:00 CEST falls back to 02:00 CET, so 02:30 happens
      // at 00:30 UTC and again at 01:30 UTC. It fires at the first only.
      expect(next("30 2 * * *", "2026-10-25T00:00:00.000Z", zone)).toBe(
        "2026-10-25T00:30:00.000Z"
      );
      expect(next("30 2 * * *", "2026-10-25T00:30:00.000Z", zone)).toBe(
        "2026-10-26T01:30:00.000Z"
      );
    });
  });

  describe("America/New_York", () => {
    const zone = "America/New_York";

    it("skips a local time that does not exist", () => {
      // 8 March 2026: 02:00 EST jumps to 03:00 EDT. From 02:30 EST on the 7th
      // (07:30 UTC), the next is 02:30 EDT on the 9th (06:30 UTC).
      expect(next("30 2 * * *", "2026-03-07T07:30:00.000Z", zone)).toBe(
        "2026-03-09T06:30:00.000Z"
      );
    });

    it("fires a repeated local time once", () => {
      // 1 November 2026: 02:00 EDT falls back to 01:00 EST, so 01:30 happens
      // at 05:30 UTC and again at 06:30 UTC. It fires at the first only.
      expect(next("30 1 * * *", "2026-11-01T05:00:00.000Z", zone)).toBe(
        "2026-11-01T05:30:00.000Z"
      );
      expect(next("30 1 * * *", "2026-11-01T05:30:00.000Z", zone)).toBe(
        "2026-11-02T06:30:00.000Z"
      );
    });

    it("finds the latest fire during the repeated hour, which is in its first pass", () => {
      // Every ten minutes fires 01:00 to 01:50 EDT (05:00 to 05:50 UTC) and
      // not again in the repeated hour, so at 01:15 EST (06:15 UTC) the
      // latest fire is 01:50 EDT.
      expect(latest("*/10 * * * *", "2026-11-01T06:15:00.000Z", zone)).toBe(
        "2026-11-01T05:50:00.000Z"
      );
    });
  });
});
