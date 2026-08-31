/**
 * Placing releases on a month grid, in a zone the reader chooses.
 *
 * Pure, and separate from the view for one reason: every hard question here is
 * about calendars rather than about React. Which instants a month covers, and
 * which day a launch lands on, both change with the zone the grid is drawn in —
 * a release at 23:00 in Berlin is the NEXT day in UTC — so a grid that assumes
 * a zone silently files launches under the wrong date, and no amount of looking
 * at the screen reveals it.
 *
 * @module components/features/releases/release-calendar
 */
import type { Release } from "@admin/types/releases";

import { dayKeyIn, instantFor } from "./release-timezone";

/** A `YYYY-MM-DD` calendar day, as read in the grid's zone. */
export type DayKey = string;

export interface CalendarMonth {
  /** The first of the month, `YYYY-MM`. */
  month: string;
  /** Six rows of seven day keys, so the grid never changes height. */
  weeks: DayKey[][];
}

/** `YYYY-MM` for the month `offset` months from `month`. */
export function shiftMonth(month: string, offset: number): string {
  const [year, index] = month.split("-").map(Number);
  if (!year || !index) return month;
  // `Date.UTC` normalises an out-of-range month, so December + 1 rolls the year
  // without a special case here.
  const shifted = new Date(Date.UTC(year, index - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The month `instant` falls in, read in `timeZone`. */
export function monthOf(instant: Date, timeZone: string): string {
  return dayKeyIn(instant, timeZone).slice(0, 7);
}

/**
 * The grid for `month`, padded to whole weeks starting Monday.
 *
 * Always six rows. A month spans four to six depending on its length and which
 * weekday it opens on, and a grid that changes height moves everything under it
 * as the reader pages through — which is the one thing a calendar must not do
 * to somebody scanning for a date.
 *
 * The days themselves are counted in UTC deliberately: these are LABELS, not
 * instants. A day key is produced by naming the date, and asking a zone to
 * convert a label it did not come from is how a grid loses or repeats a day
 * across a daylight boundary.
 */
export function monthGrid(month: string): CalendarMonth {
  const [year, index] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, index - 1, 1));
  // Monday-first: `getUTCDay` is 0 for Sunday, so Sunday must reach back six
  // days rather than none.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - lead * 86_400_000);

  const weeks: DayKey[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: DayKey[] = [];
    for (let day = 0; day < 7; day += 1) {
      const at = new Date(start.getTime() + (week * 7 + day) * 86_400_000);
      row.push(at.toISOString().slice(0, 10));
    }
    weeks.push(row);
  }
  return { month, weeks };
}

/**
 * The instants a month's grid covers, for the list query's window.
 *
 * Bounded by the grid rather than by the month, so a release on a leading or
 * trailing day is fetched and shown rather than appearing only once the reader
 * pages to the month it belongs to.
 *
 * Resolved through `instantFor`, which is the same solver the schedule input
 * uses. A month boundary is a wall time like any other and can land on a
 * daylight transition — Brazil has abolished DST at midnight, so `00:00` on the
 * first has genuinely not existed there — and the fallback walks forward rather
 * than guessing an offset, so the window can never open after the day it means.
 */
export function monthWindow(
  month: string,
  timeZone: string
): { after: string; before: string } {
  const { weeks } = monthGrid(month);
  const firstDay = weeks[0]?.[0] ?? `${month}-01`;
  const lastDay = weeks[5]?.[6] ?? `${month}-28`;
  return {
    after: startOfDayInstant(firstDay, timeZone),
    before: startOfDayInstant(nextDay(lastDay), timeZone),
  };
}

/**
 * The instant a day begins in `timeZone`, as an ISO string.
 *
 * Exported for its own test. Through {@link monthWindow} the walk below is
 * DEFENSIVE rather than live: a grid always opens on a Monday and its exclusive
 * upper bound is a Monday too, while every zone that moves its clock at
 * midnight does so on a Sunday — so no real zone reaches the fallback by that
 * route. It is still the right shape, because "midnight" is an assumption this
 * function would otherwise be making silently, and a caller with a different
 * boundary would inherit it.
 */
export function startOfDayInstant(day: DayKey, timeZone: string): string {
  // Midnight can be SKIPPED — a zone that springs forward at 00:00 has no
  // 00:00 that day — so the first wall time that exists is taken instead of
  // assuming one. Bounded at three hours, which is wider than any transition.
  for (let minutes = 0; minutes <= 180; minutes += 30) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    const iso = instantFor(`${day}T${hh}:${mm}`, timeZone);
    if (iso !== null) return iso;
  }
  // Every candidate refused, which no real zone produces. UTC midnight is the
  // widest honest answer: a window that is slightly too large shows a release
  // that belongs to a neighbouring day, where one that is too small hides one.
  return `${day}T00:00:00.000Z`;
}

/** The day after `day`, as a key. */
function nextDay(day: DayKey): DayKey {
  const at = new Date(`${day}T00:00:00.000Z`);
  return new Date(at.getTime() + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Every release with an instant, filed under the day it happens in `timeZone`.
 *
 * A release with no `scheduledAt` is absent rather than filed somewhere
 * arbitrary: a draft has not been given a moment, and putting it on today would
 * assert a launch nobody scheduled.
 *
 * Each day's releases are ordered by instant, so a day cell reads down the way
 * the day will actually happen.
 */
export function bucketByDay(
  releases: readonly Release[],
  timeZone: string
): Map<DayKey, Release[]> {
  const byDay = new Map<DayKey, Release[]>();
  for (const release of releases) {
    if (!release.scheduledAt) continue;
    // A CANCELLED release keeps its instant, and nothing happens at it. Counting
    // it would show a day as occupied — and, on a grid whose whole job is
    // showing collisions, assert a collision that cannot occur. Dropped rather
    // than styled differently: the calendar answers what will happen, and a
    // called-off launch is not an answer to that.
    if (release.state === "cancelled") continue;
    const at = new Date(release.scheduledAt);
    if (Number.isNaN(at.getTime())) continue;
    const key = dayKeyIn(at, timeZone);
    const list = byDay.get(key) ?? [];
    list.push(release);
    byDay.set(key, list);
  }
  for (const list of byDay.values()) {
    list.sort(
      (a, b) =>
        new Date(a.scheduledAt ?? 0).getTime() -
        new Date(b.scheduledAt ?? 0).getTime()
    );
  }
  return byDay;
}
