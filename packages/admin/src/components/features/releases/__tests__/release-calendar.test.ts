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

  it("survives a zone whose midnight does not exist", async () => {
    // A zone that springs forward at 00:00 has no midnight that day. The window
    // must still open — walking forward to the first wall time that exists —
    // rather than returning something unparseable and emptying the month.
    const window = monthWindow("2026-10", "America/Santiago");
    expect(Number.isNaN(new Date(window.after).getTime())).toBe(false);
    expect(new Date(window.after).getTime()).toBeLessThan(
      new Date(window.before).getTime()
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
