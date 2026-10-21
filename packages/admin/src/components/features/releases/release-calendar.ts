/**
 * The month grid's arithmetic, and what each day of the calendar says.
 *
 * Pure, and separate from the view, because every hard question here is
 * about calendars rather than about React: which days a month's grid holds,
 * where a key press moves to, and what "+N more" may truthfully say.
 *
 * Which day a release falls on is NOT answered here. The server's calendar
 * read places every release on its day in the chosen zone and counts each day
 * in full, so the browser never buckets a capped page of releases itself: a
 * busy month's counts are complete, and a release published late is on the
 * day it went out. Day keys here are LABELS (`YYYY-MM-DD`), counted in UTC
 * only so that naming the next day can never skip or repeat one across a
 * daylight-saving change.
 *
 * @module components/features/releases/release-calendar
 */
import type { Release, ReleaseCalendarDay } from "@admin/types/releases";

import { releaseRowStatus, type ReleaseRowStatus } from "./release-list";
import { dayKeyIn } from "./release-timezone";

/** A `YYYY-MM-DD` calendar day, as read in the grid's zone. */
export type DayKey = string;

export interface CalendarMonth {
  /** The month, `YYYY-MM`. */
  month: string;
  /** Six rows of seven day keys, so the grid never changes height. */
  weeks: DayKey[][];
}

const DAY_MS = 86_400_000;

/**
 * How many rows a day cell has for releases.
 *
 * Three, the most the server sends with a day. A day holding more gives its
 * last row to "+N more", so a full day is no taller than a day of three and
 * the grid keeps one height whatever the month holds.
 */
export const CALENDAR_CHIP_LIMIT = 3;

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

/** The day `offset` days from `day`. */
export function shiftDay(day: DayKey, offset: number): DayKey {
  const at = Date.parse(`${day}T00:00:00.000Z`);
  return new Date(at + offset * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The same date `offset` months from `day`, or the last day of that month
 * where it is shorter: 31 January plus a month is 28 February, never 3 March,
 * so paging forward always lands in the next month.
 */
export function shiftDayByMonths(day: DayKey, offset: number): DayKey {
  const target = shiftMonth(day.slice(0, 7), offset);
  const [year, index] = target.split("-").map(Number);
  // Day 0 of the following month is the last day of this one.
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const date = Math.min(Number(day.slice(8, 10)), last);
  return `${target}-${String(date).padStart(2, "0")}`;
}

/**
 * The grid for `month`, padded to whole weeks starting Monday.
 *
 * Always six rows. A month spans four to six depending on its length and which
 * weekday it opens on, and a grid that changes height moves everything under it
 * as the reader pages through — which is the one thing a calendar must not do
 * to somebody scanning for a date.
 */
export function monthGrid(month: string): CalendarMonth {
  const first = `${month}-01`;
  // Monday-first: `getUTCDay` is 0 for Sunday, so Sunday must reach back six
  // days rather than none.
  const lead = (new Date(`${first}T00:00:00.000Z`).getUTCDay() + 6) % 7;
  const start = shiftDay(first, -lead);

  const weeks: DayKey[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: DayKey[] = [];
    for (let day = 0; day < 7; day += 1) {
      row.push(shiftDay(start, week * 7 + day));
    }
    weeks.push(row);
  }
  return { month, weeks };
}

/**
 * The days the calendar asks the server for: the grid's first and last.
 *
 * The grid rather than the month, so a release on a leading or trailing day
 * is drawn where it is on screen. Six weeks exactly, which is also the longest
 * window the server's read covers.
 */
export function calendarWindow(month: string): { from: DayKey; to: DayKey } {
  const { weeks } = monthGrid(month);
  return { from: weeks[0][0], to: weeks[5][6] };
}

/** A key press, as the grid reads it. */
export interface CalendarKey {
  key: string;
  shiftKey?: boolean;
}

/**
 * The day a key moves to from `day`, or `null` for a key the grid leaves to
 * the browser.
 *
 * The keys of the date grid in the WAI-ARIA practices: arrows by a day or a
 * week, Home and End to the week's ends (Monday and Sunday, as the columns
 * run), Page Up and Page Down by a month, and with Shift by a year. Enter,
 * Space and Tab are not claimed: they open a day and leave the grid.
 */
export function moveInCalendar(
  day: DayKey,
  { key, shiftKey = false }: CalendarKey
): DayKey | null {
  const weekday = (new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7;
  switch (key) {
    case "ArrowLeft":
      return shiftDay(day, -1);
    case "ArrowRight":
      return shiftDay(day, 1);
    case "ArrowUp":
      return shiftDay(day, -7);
    case "ArrowDown":
      return shiftDay(day, 7);
    case "Home":
      return shiftDay(day, -weekday);
    case "End":
      return shiftDay(day, 6 - weekday);
    case "PageUp":
      return shiftDayByMonths(day, shiftKey ? -12 : -1);
    case "PageDown":
      return shiftDayByMonths(day, shiftKey ? 12 : 1);
    default:
      return null;
  }
}

/**
 * The releases a day draws as chips, and how many more it holds.
 *
 * "+N more" is the day's complete total less the chips drawn, from the
 * server's count of every release on the day, so it is true however many
 * the day holds. Counting the releases the server sent instead would say
 * "+1 more" for a day of forty.
 */
export function dayChips(day: Pick<ReleaseCalendarDay, "total" | "releases">): {
  shown: Release[];
  more: number;
} {
  if (day.total <= CALENDAR_CHIP_LIMIT) {
    return { shown: day.releases.slice(0, CALENDAR_CHIP_LIMIT), more: 0 };
  }
  const shown = day.releases.slice(0, CALENDAR_CHIP_LIMIT - 1);
  return { shown, more: day.total - shown.length };
}

/**
 * The instant a release's chip shows the time of.
 *
 * The moment it is placed at: a published release went out at `publishedAt`,
 * which is the day the server puts it on, so a release the runner reached
 * late reads the time it really went live. Every other state is drawn at its
 * scheduled instant, where the server places it too.
 */
export function releaseCalendarInstant(
  release: Pick<Release, "state" | "scheduledAt" | "publishedAt">
): string | null {
  if (release.state === "published" && release.publishedAt) {
    return release.publishedAt;
  }
  return release.scheduledAt;
}

/**
 * Where a release stands, in the list's words.
 *
 * Overdue is the server's answer, not a clock here: `overdue` holds the ids
 * the server's own Needs attention read calls overdue, so the calendar and
 * the list cannot disagree about a release near the cutoff.
 */
export function releaseCalendarStatus(
  release: Pick<Release, "id" | "state">,
  overdue: ReadonlySet<string>
): ReleaseRowStatus {
  return releaseRowStatus(
    release,
    overdue.has(release.id) ? "attention" : "upcoming"
  );
}

/** "Wednesday, October 21, 2026", in the reader's locale. */
export function longDayLabel(day: DayKey): string {
  // Noon UTC, rendered in UTC: a label, never an instant, so no zone can move
  // it onto the day either side.
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * What a day cell says out loud: its date, whether it is today, and its
 * complete count, with how many of them stopped.
 *
 * One sentence, so the spoken day and the drawn one cannot drift: a cell that
 * shows a count and announces nothing is how a calendar becomes unusable
 * without looking broken.
 */
export function calendarDayLabel(
  day: Pick<ReleaseCalendarDay, "date" | "total" | "counts">,
  { isToday }: { isToday: boolean }
): string {
  const parts = [longDayLabel(day.date)];
  if (isToday) parts.push("today");
  if (day.total === 0) {
    parts.push("no releases");
  } else {
    parts.push(`${day.total} ${day.total === 1 ? "release" : "releases"}`);
    if (day.counts.blocked > 0) parts.push(`${day.counts.blocked} stopped`);
  }
  return parts.join(", ");
}
