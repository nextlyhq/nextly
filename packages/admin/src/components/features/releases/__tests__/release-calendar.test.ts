/**
 * Placing releases on a month grid, in a chosen zone.
 *
 * The interesting property is not that the grid has the right shape — it is
 * that a launch lands on the day a reader in that zone would call it. Those two
 * differ for every release near midnight, which on a schedule made of "publish
 * at 9am" and "take down at midnight" is not an edge case.
 *
 * @module components/features/releases/__tests__/release-calendar.test
 */
import { describe, expect, it } from "vitest";

import {
  bucketByDay,
  monthGrid,
  monthOf,
  monthWindow,
  shiftMonth,
  startOfDayInstant,
} from "../release-calendar";

import type { Release } from "@admin/types/releases";

const release = (id: string, scheduledAt: string | null): Release =>
  ({
    id,
    title: id,
    description: null,
    scheduledAt,
    timezone: "UTC",
    state: "scheduled",
    publishedAt: null,
  }) as unknown as Release;

describe("which day a release lands on", () => {
  it("files a late-evening launch under the reader's day, not UTC's", async () => {
    // THE case the whole module exists for. 23:00 in Berlin on the 1st is
    // 21:00Z on the 1st — same day. But 23:00 in New York on the 1st is 03:00Z
    // on the SECOND, so a grid drawn from the UTC rendering shows it a day
    // late, on a date the person who scheduled it never chose.
    const late = release("late", "2026-09-02T03:00:00.000Z");

    expect([...bucketByDay([late], "America/New_York").keys()]).toEqual([
      "2026-09-01",
    ]);
    // The control: the same instant genuinely IS the 2nd in UTC, so a bucketing
    // that ignored the zone would be right here and wrong above.
    expect([...bucketByDay([late], "UTC").keys()]).toEqual(["2026-09-02"]);
  });

  it("files an early-morning launch under the previous day east of Greenwich", async () => {
    // The mirror image, so the fix cannot be a constant shift in one direction.
    // 22:30Z on the 1st is already 00:30 on the 2nd in Berlin.
    const early = release("early", "2026-09-01T22:30:00.000Z");
    expect([...bucketByDay([early], "Europe/Berlin").keys()]).toEqual([
      "2026-09-02",
    ]);
    expect([...bucketByDay([early], "UTC").keys()]).toEqual(["2026-09-01"]);
  });

  it("leaves a CANCELLED release off the grid, instant or not", async () => {
    // Cancelling keeps `scheduledAt`, so a cancelled launch still has a date —
    // and counting it would show the day as occupied on a grid whose whole job
    // is showing collisions, asserting a clash that cannot happen.
    const cancelled = {
      ...release("called-off", "2026-09-01T09:00:00.000Z"),
      state: "cancelled",
    } as unknown as Release;
    expect(bucketByDay([cancelled], "UTC").size).toBe(0);

    // The control: the same release, not cancelled, IS counted — so this is a
    // state filter rather than the bucketing having stopped working.
    expect(
      bucketByDay([release("still-on", "2026-09-01T09:00:00.000Z")], "UTC").size
    ).toBe(1);
  });

  it("leaves a release with no instant off the grid entirely", async () => {
    // A draft has not been given a moment. Filing it under today would assert a
    // launch nobody scheduled, on a screen whose entire subject is when things
    // happen.
    expect(bucketByDay([release("draft", null)], "UTC").size).toBe(0);
  });

  it("orders a day's releases by instant", async () => {
    // A day cell is read downwards as the order the day will happen in.
    const day = bucketByDay(
      [
        release("evening", "2026-09-01T18:00:00.000Z"),
        release("morning", "2026-09-01T09:00:00.000Z"),
      ],
      "UTC"
    );
    expect(day.get("2026-09-01")?.map(r => r.id)).toEqual([
      "morning",
      "evening",
    ]);
  });
});

describe("the grid itself", () => {
  it("is always six rows, so paging does not move the page", async () => {
    // A month spans four to six weeks. A grid that changes height shifts
    // everything below it as the reader pages, which is the one thing a
    // calendar must not do to somebody scanning for a date.
    for (const month of ["2026-02", "2026-08", "2026-09", "2027-01"]) {
      const grid = monthGrid(month);
      expect(grid.weeks).toHaveLength(6);
      expect(grid.weeks.every(week => week.length === 7)).toBe(true);
    }
  });

  it("starts each row on a Monday", async () => {
    const grid = monthGrid("2026-09");
    for (const week of grid.weeks) {
      expect(new Date(`${week[0]}T00:00:00.000Z`).getUTCDay()).toBe(1);
    }
  });

  it("leads with the days needed to reach the first of the month", async () => {
    // 2026-09-01 is a Tuesday, so the row opens on Monday the 31st of August.
    expect(monthGrid("2026-09").weeks[0]?.[0]).toBe("2026-08-31");
    expect(monthGrid("2026-09").weeks[0]?.[1]).toBe("2026-09-01");
  });

  it("opens on the first itself when the month begins on a Monday", async () => {
    // The control for the lead-in: a month that needs no padding must get none,
    // or a grid that always reached back a week would satisfy the case above.
    expect(monthGrid("2026-06").weeks[0]?.[0]).toBe("2026-06-01");
  });
});

describe("the window the month is fetched with", () => {
  it("covers the whole grid, including the days either side", async () => {
    // Bounded by the grid rather than the month, so a release on a leading or
    // trailing day is fetched — otherwise it appears only once the reader pages
    // to the month it belongs to, which is exactly when they stop looking.
    const window = monthWindow("2026-09", "UTC");
    expect(window.after).toBe("2026-08-31T00:00:00.000Z");
    // Exclusive upper bound: the start of the day AFTER the last grid day.
    expect(window.before).toBe("2026-10-12T00:00:00.000Z");
  });

  it("opens the window at midnight IN THE CHOSEN ZONE", async () => {
    // The zone decides the instant, not just the label. Midnight on the 31st in
    // Berlin is 22:00Z on the 30th — an hour of releases a UTC-bounded window
    // would miss at the start of every month.
    const berlin = monthWindow("2026-09", "Europe/Berlin");
    expect(berlin.after).toBe("2026-08-30T22:00:00.000Z");
    expect(new Date(berlin.after).getTime()).toBeLessThan(
      new Date(monthWindow("2026-09", "UTC").after).getTime()
    );
  });

  it("opens on a Monday, which is why the skipped-midnight walk is defensive here", async () => {
    // Worth pinning, because it is the reason the case below tests
    // `startOfDayInstant` directly instead of through this function. A grid
    // always opens on a Monday and its exclusive bound is a Monday too, while
    // every zone that moves its clock at midnight does so on a Sunday — so no
    // real zone reaches the walk by this route.
    for (const month of ["2026-09", "2026-10", "2026-11", "2027-01"]) {
      const opens = new Date(monthWindow(month, "UTC").after);
      expect(opens.getUTCDay()).toBe(1);
    }
  });
});

describe("a day whose midnight does not exist", () => {
  it("opens at the first wall time the zone actually has", async () => {
    // Chile moves its clock AT midnight: on 2026-09-06 Santiago goes straight
    // from 23:59 on the 5th to 01:00 on the 6th, so `2026-09-06T00:00` is not a
    // moment. Measured — 03:30Z reads as 23:30 on the 5th there, and 04:00Z as
    // 01:00 on the 6th.
    //
    // The EXACT instant is asserted, because that is the only thing separating
    // a walk forward from the UTC fallback: both produce a parseable date and
    // both order correctly, so a test that checked either would stay green on
    // the broken implementation. An earlier version of this test did exactly
    // that, on a month whose grid did not even contain the transition.
    expect(startOfDayInstant("2026-09-06", "America/Santiago")).toBe(
      "2026-09-06T04:00:00.000Z"
    );
    // The control: the same zone on an ordinary day has a real midnight, and
    // must NOT be walked forward.
    expect(startOfDayInstant("2026-09-20", "America/Santiago")).toBe(
      "2026-09-20T03:00:00.000Z"
    );
  });

  it("returns the plain midnight instant for a zone with no transition", async () => {
    // The other control: without it, a function that always walked forward
    // would satisfy the skipped case above.
    expect(startOfDayInstant("2026-09-06", "UTC")).toBe(
      "2026-09-06T00:00:00.000Z"
    );
  });
});

describe("moving between months", () => {
  it("rolls the year in both directions", async () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("names the month an instant falls in, in the reader's zone", async () => {
    // The same instant is two different MONTHS depending on the zone, which is
    // what decides the grid the reader opens on.
    expect(monthOf(new Date("2026-09-01T02:00:00.000Z"), "UTC")).toBe(
      "2026-09"
    );
    expect(
      monthOf(new Date("2026-09-01T02:00:00.000Z"), "America/Los_Angeles")
    ).toBe("2026-08");
  });
});
