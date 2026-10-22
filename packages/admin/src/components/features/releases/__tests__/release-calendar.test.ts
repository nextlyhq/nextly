/**
 * The month grid's arithmetic, and what each day of the server's calendar
 * read is drawn as.
 *
 * Which day a release lands on is no longer worked out here: the server's
 * calendar read places every release on its day in the chosen zone, and its
 * own tests hold that rule (`release-calendar.test.ts` in the core package).
 * The bucketing, window and midnight-walk cases that used to live in this file
 * went with the code that did that work in the browser. What stays is what the
 * browser still decides: the grid, the window it asks for, how a day is moved
 * through by keyboard, how many chips a day draws and what "+N more" says.
 *
 * @module components/features/releases/__tests__/release-calendar.test
 */
import { describe, expect, it } from "vitest";

import type { Release, ReleaseCalendarDay } from "@admin/types/releases";

import {
  CALENDAR_CHIP_LIMIT,
  calendarDayLabel,
  calendarWindow,
  compareByPlacement,
  dayChips,
  monthGrid,
  monthOf,
  moveInCalendar,
  releaseCalendarInstant,
  releaseCalendarStatus,
  shiftDay,
  shiftDayByMonths,
  shiftMonth,
} from "../release-calendar";

const release = (id: string, over: Partial<Release> = {}): Release => ({
  id,
  title: id,
  description: null,
  scheduledAt: "2026-10-21T09:00:00.000Z",
  timezone: "UTC",
  state: "scheduled",
  publishedAt: null,
  createdBy: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
  ...over,
});

const day = (
  total: number,
  releases: Release[],
  date = "2026-10-21"
): ReleaseCalendarDay => ({
  date,
  total,
  counts: {
    draft: 0,
    scheduled: total,
    published: 0,
    cancelled: 0,
    blocked: 0,
  },
  releases,
});

describe("the grid itself", () => {
  it("is always six rows, so paging does not move the page", () => {
    // A month spans four to six weeks. A grid that changes height shifts
    // everything below it as the reader pages, which is the one thing a
    // calendar must not do to somebody scanning for a date.
    for (const month of ["2026-02", "2026-08", "2026-09", "2027-01"]) {
      const grid = monthGrid(month);
      expect(grid.weeks).toHaveLength(6);
      expect(grid.weeks.every(week => week.length === 7)).toBe(true);
    }
  });

  it("starts each row on a Monday", () => {
    const grid = monthGrid("2026-09");
    for (const week of grid.weeks) {
      expect(new Date(`${week[0]}T00:00:00.000Z`).getUTCDay()).toBe(1);
    }
  });

  it("leads with the days needed to reach the first of the month", () => {
    // 2026-09-01 is a Tuesday, so the row opens on Monday the 31st of August.
    expect(monthGrid("2026-09").weeks[0]?.[0]).toBe("2026-08-31");
    expect(monthGrid("2026-09").weeks[0]?.[1]).toBe("2026-09-01");
  });

  it("opens on the first itself when the month begins on a Monday", () => {
    // The control for the lead-in: a month that needs no padding must get none,
    // or a grid that always reached back a week would satisfy the case above.
    expect(monthGrid("2026-06").weeks[0]?.[0]).toBe("2026-06-01");
  });
});

describe("the window the calendar asks the server for", () => {
  it("is the grid's first and last day, so the leading and trailing days are filled too", () => {
    // Bounded by the grid rather than by the month: a release on 31 August
    // is drawn in September's first row, and asking for September alone would
    // leave that cell empty although it is on screen.
    expect(calendarWindow("2026-09")).toEqual({
      from: "2026-08-31",
      to: "2026-10-11",
    });
    expect(calendarWindow("2026-06")).toEqual({
      from: "2026-06-01",
      to: "2026-07-12",
    });
  });

  it("is exactly six weeks, the most the server's read covers", () => {
    // The server refuses a window longer than 42 days, so one day more here
    // would turn every month into an error.
    const { from, to } = calendarWindow("2027-02");
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    expect(days).toBe(42);
  });
});

describe("moving between days", () => {
  it("steps a day across month and year ends", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-10-21", 7)).toBe("2026-10-28");
  });

  it("keeps the date when it moves by a month, and stops at a shorter month's end", () => {
    expect(shiftDayByMonths("2026-03-15", -1)).toBe("2026-02-15");
    // 31 January plus a month is the last of February, not 3 March: a
    // reader paging forward from the 31st should land in the next month.
    expect(shiftDayByMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftDayByMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(shiftDayByMonths("2026-12-10", 1)).toBe("2027-01-10");
    expect(shiftDayByMonths("2026-10-21", 12)).toBe("2027-10-21");
  });

  it("maps the calendar keys to the day they move to", () => {
    // 21 October 2026 is a Wednesday.
    const from = "2026-10-21";
    expect(moveInCalendar(from, { key: "ArrowRight" })).toBe("2026-10-22");
    expect(moveInCalendar(from, { key: "ArrowLeft" })).toBe("2026-10-20");
    expect(moveInCalendar(from, { key: "ArrowDown" })).toBe("2026-10-28");
    expect(moveInCalendar(from, { key: "ArrowUp" })).toBe("2026-10-14");
    // The week runs Monday to Sunday, as the grid's columns do.
    expect(moveInCalendar(from, { key: "Home" })).toBe("2026-10-19");
    expect(moveInCalendar(from, { key: "End" })).toBe("2026-10-25");
    expect(moveInCalendar(from, { key: "PageDown" })).toBe("2026-11-21");
    expect(moveInCalendar(from, { key: "PageUp" })).toBe("2026-09-21");
    expect(moveInCalendar(from, { key: "PageDown", shiftKey: true })).toBe(
      "2027-10-21"
    );
    expect(moveInCalendar(from, { key: "PageUp", shiftKey: true })).toBe(
      "2025-10-21"
    );
  });

  it("leaves every other key alone", () => {
    // Enter, Space and Tab belong to the day and the browser; claiming them
    // here would stop a day from opening or the reader from leaving the grid.
    for (const key of ["Enter", " ", "Tab", "a", "Escape"]) {
      expect(moveInCalendar("2026-10-21", { key })).toBeNull();
    }
  });
});

describe("the chips a day draws", () => {
  it("draws every release when they all fit", () => {
    const releases = [release("a"), release("b"), release("c")];
    expect(dayChips(day(3, releases))).toEqual({ shown: releases, more: 0 });
  });

  it("counts '+N more' from the day's complete total, not from the releases sent", () => {
    // The server sends at most three releases a day and the day's total
    // beside them. Counting what was sent would say "+1 more" for a day of
    // forty, which is the incomplete answer the server's read exists to stop.
    const releases = [release("a"), release("b"), release("c")];
    const chips = dayChips(day(40, releases));
    expect(chips.shown).toEqual(releases.slice(0, CALENDAR_CHIP_LIMIT - 1));
    expect(chips.more).toBe(38);
  });

  it("gives up one chip to the '+N more' line, so a full day is no taller than a day of three", () => {
    const releases = [release("a"), release("b"), release("c")];
    const chips = dayChips(day(4, releases));
    expect(chips.shown).toHaveLength(2);
    expect(chips.more).toBe(2);
  });
});

describe("the order a day's releases are drawn in", () => {
  // The server sends a day's releases by scheduled time. A release scheduled
  // for 09:00 and published at 11:00 is drawn at 11:00, so by scheduled time
  // it would come before one that went out on time at 10:00.
  const late = release("late", {
    state: "published",
    scheduledAt: "2026-10-21T09:00:00.000Z",
    publishedAt: "2026-10-21T11:00:00.000Z",
  });
  const onTime = release("on-time", {
    state: "published",
    scheduledAt: "2026-10-21T10:00:00.000Z",
    publishedAt: "2026-10-21T10:00:00.000Z",
  });

  it("orders by the time each release is drawn at", () => {
    expect([late, onTime].sort(compareByPlacement).map(r => r.id)).toEqual([
      "on-time",
      "late",
    ]);
  });

  it("draws a day's chips in that order", () => {
    expect(dayChips(day(2, [late, onTime])).shown.map(r => r.id)).toEqual([
      "on-time",
      "late",
    ]);
  });
});

describe("what each release on the calendar says", () => {
  it("is drawn at the moment a published release went out, not the one it was scheduled for", () => {
    // The server puts a late-published release on its publish day, so its
    // chip must say the time it went out, or a chip on Thursday would read
    // a Tuesday time.
    const late = release("late", {
      state: "published",
      scheduledAt: "2026-10-20T09:00:00.000Z",
      publishedAt: "2026-10-22T14:30:00.000Z",
    });
    expect(releaseCalendarInstant(late)).toBe("2026-10-22T14:30:00.000Z");
    // The control: any other state is drawn at its scheduled instant.
    expect(releaseCalendarInstant(release("due"))).toBe(
      "2026-10-21T09:00:00.000Z"
    );
  });

  it("claims no state for a scheduled release while overdue is not known", () => {
    // Pending or failed: "Scheduled" would be a guess, and wrong for every
    // release the server calls overdue.
    expect(releaseCalendarStatus(release("due"), null)).toBeNull();
    // The control: a state that does not depend on overdue is still said.
    expect(
      releaseCalendarStatus(release("x", { state: "blocked" }), null)
    ).toBe("stopped");
    expect(
      releaseCalendarStatus(release("x", { state: "published" }), null)
    ).toBe("published");
  });

  it("takes its state word from the list's vocabulary, overdue from the server's own answer", () => {
    const overdue = new Set(["late"]);
    expect(releaseCalendarStatus(release("late"), overdue)).toBe("overdue");
    // The control: the same state, not in the server's overdue answer, is
    // scheduled, so this is the answer deciding and not the state.
    expect(releaseCalendarStatus(release("soon"), overdue)).toBe("scheduled");
    expect(
      releaseCalendarStatus(release("x", { state: "blocked" }), overdue)
    ).toBe("stopped");
    expect(
      releaseCalendarStatus(release("x", { state: "published" }), overdue)
    ).toBe("published");
    expect(
      releaseCalendarStatus(release("x", { state: "cancelled" }), overdue)
    ).toBe("cancelled");
  });
});

describe("what a day says out loud", () => {
  it("names today as today", () => {
    expect(calendarDayLabel(day(0, []), { isToday: true })).toBe(
      "Wednesday, October 21, 2026, today, no releases"
    );
    // The control: the same day, not today, does not say so.
    expect(calendarDayLabel(day(0, []), { isToday: false })).toBe(
      "Wednesday, October 21, 2026, no releases"
    );
  });

  it("gives the day's complete count, and how many of them stopped", () => {
    const busy: ReleaseCalendarDay = {
      ...day(12, [release("a"), release("b"), release("c")]),
      counts: {
        draft: 0,
        scheduled: 10,
        published: 0,
        cancelled: 0,
        blocked: 2,
      },
    };
    expect(calendarDayLabel(busy, { isToday: false })).toBe(
      "Wednesday, October 21, 2026, 12 releases, 2 stopped"
    );
    expect(calendarDayLabel(day(1, [release("a")]), { isToday: false })).toBe(
      "Wednesday, October 21, 2026, 1 release"
    );
  });
});

describe("moving between months", () => {
  it("rolls the year in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("names the month an instant falls in, in the chosen zone", () => {
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
