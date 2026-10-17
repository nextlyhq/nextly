/**
 * Days in a named time zone, as spans of instants, and a window of them
 * tallied into what a release calendar shows.
 *
 * A release carries an instant. Which DAY it falls on has no answer until a
 * zone is named: 23:30 in New York is the next morning in London. So a day here
 * is always a day in a zone, and it is turned into the span of instants it
 * covers — from the first instant whose local date is that day to the first
 * instant of the next — before anything reaches the database. The database then
 * compares `scheduledAt` against two instants, which every dialect does the
 * same way, with no date function and no zone database of its own.
 *
 * The span is worked out from what the zone's clock reads, asked of `Intl`,
 * rather than by adding 24 hours: a day in a zone with daylight saving is 23
 * hours long in spring and 25 in autumn, and a zone that skips a date (Samoa
 * did, in 2011) has a day with no instants at all.
 *
 * One span answers both questions asked of a day: the list's day filter hands
 * its conditions to the database, and {@link tallyByDay} evaluates the same
 * conditions against rows already read. Two rules for "which day is this
 * release on" would agree until a daylight boundary and then put a release on
 * one day in the calendar and another in its "+N more" list.
 *
 * @module domains/releases/release-calendar
 * @experimental The calendar's names and shapes may change until the releases
 *   redesign is complete.
 */
import { NextlyError } from "../../errors";
import type { ReleaseState } from "../../schemas/releases/types";
import type { VersionsWhereCondition } from "../versions/db-api";

import { meetsCondition } from "./release-conditions";
import type { ReleaseRow } from "./releases-repository";

/**
 * The longest window a calendar read covers, in days: six weeks, the most a
 * month grid shows. A bound on the read as much as on the screen, since every
 * release in the window is tallied.
 *
 * @experimental
 */
export const RELEASE_CALENDAR_MAX_DAYS = 42;

/**
 * How many of a day's releases the calendar sends with the day. The rest are
 * counted, so the screen can say how many more there are, and read from the
 * list filtered to that day.
 *
 * @experimental
 */
export const RELEASE_CALENDAR_RELEASES_PER_DAY = 3;

/** A span of instants: from `start`, inclusive, to `end`, exclusive. */
export interface ReleaseTimeSpan {
  start: Date;
  end: Date;
}

/**
 * One day in a zone: its date as written, and the instants it covers.
 *
 * @experimental
 */
export interface ZonedDay extends ReleaseTimeSpan {
  /** `YYYY-MM-DD`. */
  date: string;
}

/**
 * How many releases a day holds in each state, every state present.
 *
 * @experimental
 */
export type ReleaseStateCounts = Record<ReleaseState, number>;

/**
 * One day of a calendar read.
 *
 * `total` and `counts` cover every release on the day; `releases` holds the
 * first of them in time order, at most {@link RELEASE_CALENDAR_RELEASES_PER_DAY}.
 *
 * @experimental
 */
export type ReleaseCalendarDay = {
  date: string;
  total: number;
  counts: ReleaseStateCounts;
  releases: ReleaseRow[];
};

/**
 * A calendar read: the window asked for, and each of its days in order.
 *
 * @experimental
 */
export type ReleaseCalendar = {
  timezone: string;
  from: string;
  to: string;
  days: ReleaseCalendarDay[];
};

/** A day's tally before its releases are read: their ids, in time order. */
export interface CalendarDayTally {
  date: string;
  total: number;
  counts: ReleaseStateCounts;
  firstIds: string[];
}

/** The columns a release is tallied by. */
export type PlacedRelease = Pick<ReleaseRow, "id" | "state" | "scheduledAt">;

const SECOND_MS = 1000;
const DAY_MS = 86_400_000;

/** A date as written, `YYYY-MM-DD`; whether it exists is checked separately. */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether the platform can tell the time in `zone`.
 *
 * `Intl` is the only authority on which zones this runtime knows, so it is
 * asked directly; a list kept here would fall behind the platform's own.
 *
 * @experimental
 */
export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** A zone the platform knows, or a refusal naming the field. */
function knownTimeZone(value: unknown, name: string): string {
  // The type is checked before `Intl` sees it: the Direct API is reachable from
  // JavaScript, and `Intl` reads a number as the zone named by its digits.
  if (typeof value !== "string" || !isKnownTimeZone(value)) {
    throw NextlyError.invalidInput({
      message: `\`${name}\` must be an IANA time zone, such as Europe/Berlin.`,
      logContext: { reason: `invalid-${name}` },
    });
  }
  return value;
}

/** Midnight UTC of a calendar date, in milliseconds, for any four-digit year. */
function utcMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): number {
  // `setUTCFullYear` rather than `Date.UTC`, which reads years 0 to 99 as
  // 1900 to 1999.
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  at.setUTCHours(hour, minute, second, 0);
  return at.getTime();
}

/**
 * The date as a count of days since 1970-01-01, or a refusal naming the field.
 *
 * Refused when it is not written `YYYY-MM-DD` and when it does not exist:
 * `2026-02-30` would otherwise roll over to March 2, a day nobody asked for.
 */
function dayNumberOf(value: unknown, name: string): number {
  const shape = typeof value === "string" ? CALENDAR_DATE.exec(value) : null;
  if (shape === null) {
    throw NextlyError.invalidInput({
      message: `\`${name}\` must be a date written YYYY-MM-DD, such as 2026-03-01.`,
      logContext: { reason: `invalid-${name}` },
    });
  }
  const [year, month, day] = [shape[1], shape[2], shape[3]].map(Number);
  const at = new Date(utcMs(year, month, day));
  if (
    at.getUTCFullYear() !== year ||
    at.getUTCMonth() !== month - 1 ||
    at.getUTCDate() !== day
  ) {
    throw NextlyError.invalidInput({
      message: `\`${name}\` names a date that does not exist.`,
      logContext: { reason: `nonexistent-${name}`, value },
    });
  }
  return Math.round(at.getTime() / DAY_MS);
}

/** A count of days since 1970-01-01, written `YYYY-MM-DD`. */
function dateOf(dayNumber: number): string {
  const at = new Date(dayNumber * DAY_MS);
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1, 2)}-${pad(at.getUTCDate(), 2)}`;
}

/** What a clock in a zone reads at an instant. */
interface WallReading {
  /** The local date, `YYYY-MM-DD`. */
  date: string;
  /** The local date and time, read as if it were UTC, in milliseconds. */
  wallMs: number;
}

/**
 * A reader of the clock in `zone`, built once for a whole window.
 *
 * One formatter for every instant a read asks about, rather than one per
 * instant: building a formatter is the expensive part of asking `Intl`.
 */
function clockIn(zone: string): (ms: number) => WallReading {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return ms => {
    const parts = format.formatToParts(ms);
    const read = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find(part => part.type === type)?.value ?? "0");
    const [year, month, day] = [read("year"), read("month"), read("day")];
    return {
      date: dateOf(Math.round(utcMs(year, month, day) / DAY_MS)),
      // `% 24`: some engines write midnight as 24 even under `h23`.
      wallMs: utcMs(
        year,
        month,
        day,
        read("hour") % 24,
        read("minute"),
        read("second")
      ),
    };
  };
}

/**
 * The first instant whose local date, in the clock's zone, is `dayNumber` or
 * later: where that day starts.
 *
 * Usually the instant the clock reads 00:00:00 that day, found from the zone's
 * offset and then checked against the definition. Where that is not the start —
 * a zone that moves its clocks at midnight, so the day begins at 01:00, or a
 * zone that skipped the date — the start is searched for, a second at a time,
 * between two instants that lie certainly before and after it. Every instant
 * returned is a whole second, the coarsest precision a dialect stores an
 * instant in, so the database and {@link tallyByDay} compare it alike.
 */
function startOfDay(clock: (ms: number) => WallReading, dayNumber: number) {
  const date = dateOf(dayNumber);
  const reached = (ms: number) => clock(ms).date >= date;
  const naive = dayNumber * DAY_MS;
  const offsetAt = (ms: number) => clock(ms).wallMs - ms;

  // The offset at the naive instant, and then at the guess it gives, so an
  // offset that changes between the two is followed.
  const first = naive - offsetAt(naive);
  const guess = naive - offsetAt(first);
  if (reached(guess) && !reached(guess - SECOND_MS)) return guess;

  // Two days either side lie outside any zone's offset, so `low` is still the
  // day before and `high` already the day after.
  let low = naive - 2 * DAY_MS;
  let high = naive + 2 * DAY_MS;
  while (high - low > SECOND_MS) {
    const middle = low + Math.floor((high - low) / 2 / SECOND_MS) * SECOND_MS;
    if (reached(middle)) high = middle;
    else low = middle;
  }
  return high;
}

/** Each day from `first` to `last` in `zone`, with the instants it covers. */
function daysBetween(first: number, last: number, zone: string): ZonedDay[] {
  const clock = clockIn(zone);
  const starts: number[] = [];
  // One start past the last day: it is where the last day ends.
  for (let n = first; n <= last + 1; n += 1) {
    starts.push(startOfDay(clock, n));
  }
  return starts.slice(0, -1).map((start, i) => ({
    date: dateOf(first + i),
    start: new Date(start),
    end: new Date(starts[i + 1]),
  }));
}

/**
 * The days from `from` to `to`, both included, in `timezone`.
 *
 * Refused when either date is not a real `YYYY-MM-DD` date, when the zone is
 * unknown, when `to` is before `from`, and when the window is longer than
 * {@link RELEASE_CALENDAR_MAX_DAYS}.
 *
 * @experimental
 */
export function zonedDays(window: {
  from: unknown;
  to: unknown;
  timezone: unknown;
}): ZonedDay[] {
  const zone = knownTimeZone(window.timezone, "timezone");
  const first = dayNumberOf(window.from, "from");
  const last = dayNumberOf(window.to, "to");
  if (last < first) {
    throw NextlyError.invalidInput({
      message: "`to` must be the same day as `from` or later.",
      logContext: { reason: "calendar-window-inverted" },
    });
  }
  const length = last - first + 1;
  if (length > RELEASE_CALENDAR_MAX_DAYS) {
    throw NextlyError.invalidInput({
      message: `A calendar window is at most ${RELEASE_CALENDAR_MAX_DAYS} days (six weeks); ${String(window.from)} to ${String(window.to)} is ${length} days.`,
      logContext: { reason: "calendar-window-too-long", length },
    });
  }
  return daysBetween(first, last, zone);
}

/**
 * One day in `timezone`, with the instants it covers.
 *
 * @experimental
 */
export function zonedDay(day: { date: unknown; timezone: unknown }): ZonedDay {
  const zone = knownTimeZone(day.timezone, "timezone");
  const n = dayNumberOf(day.date, "day");
  return daysBetween(n, n, zone)[0];
}

/**
 * A span as the conditions a release's instant meets inside it.
 *
 * Half-open, so a release at the instant one day ends and the next begins is on
 * the next day only, and consecutive days share no release.
 *
 * @experimental
 */
export function withinSpanConditions(
  span: ReleaseTimeSpan
): VersionsWhereCondition[] {
  return [
    { column: "scheduledAt", op: ">=", value: span.start },
    { column: "scheduledAt", op: "<", value: span.end },
  ];
}

/** Zero releases in every state. */
function noReleases(): ReleaseStateCounts {
  return { draft: 0, scheduled: 0, published: 0, cancelled: 0, blocked: 0 };
}

/**
 * Each day's complete count by state, and the ids of its first `perDay`
 * releases.
 *
 * `releases` must be in the order the day's list shows them, since the first
 * ones are kept in the order they arrive. A release is placed on the day whose
 * {@link withinSpanConditions} it meets, evaluated as the database evaluates
 * them, so the calendar and the list filtered to that day hold the same
 * releases.
 *
 * @experimental
 */
export function tallyByDay(
  days: readonly ZonedDay[],
  releases: readonly PlacedRelease[],
  perDay: number
): CalendarDayTally[] {
  const spans = days.map(day => withinSpanConditions(day));
  const tallies: CalendarDayTally[] = days.map(day => ({
    date: day.date,
    total: 0,
    counts: noReleases(),
    firstIds: [],
  }));
  for (const release of releases) {
    const index = spans.findIndex(conditions =>
      conditions.every(condition => meetsCondition(release, condition))
    );
    if (index === -1) {
      // The releases were read for exactly these days, so one on none of them
      // means the read and this placement disagree. Refused, because a count
      // that silently left it out would be the incomplete answer this exists
      // to prevent.
      throw NextlyError.internal({
        logContext: {
          reason: "release-outside-calendar-window",
          releaseId: release.id,
        },
      });
    }
    const tally = tallies[index];
    tally.total += 1;
    tally.counts[release.state] += 1;
    if (tally.firstIds.length < perDay) tally.firstIds.push(release.id);
  }
  return tallies;
}
