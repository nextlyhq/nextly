/**
 * How a release's instant reads to the person looking at it.
 *
 * In the READER'S zone first, because the question a list answers is "when is
 * that for me". Where the release was scheduled in a zone whose clock reads
 * differently at that instant, the time there is given as well and labelled
 * as the scheduled one, because "7:00 Karachi" is what its author promised and
 * a converted time alone hides that promise. So a release scheduled for 07:00
 * on 17 October in Asia/Karachi reads, in New York, as
 * "Fri, Oct 16, 2026 10:00 PM your time · Sat, Oct 17, 2026 7:00 AM
 * Asia/Karachi (as scheduled)", and in Karachi as plain
 * "Sat, Oct 17, 2026 7:00 AM".
 *
 * "Differs" is judged by the CLOCK, not the zone's name: two names that read
 * the same at that instant (London and UTC in winter, an alias and its zone)
 * would otherwise print one time twice under two labels.
 *
 * Rendered through the admin's own formatter so an installation's configured
 * date and time format still applies; only the zone is chosen here.
 *
 * @module components/features/releases/release-time
 */
import {
  formatGlobalDateTime,
  getGlobalDateTimeConfig,
  isValidTimezone,
} from "@admin/lib/dates/format";

import { dayKeyIn, wallTimeIn } from "./release-timezone";

/** The parts of one release instant, ready to lay out. */
export interface ReleaseTimeText {
  /** The date and time on the reader's clock. */
  local: string;
  /** How far the instant is from now: "in 3 days", "2 hours ago". */
  relative: string;
  /**
   * The same instant in the zone it was scheduled in, present only when that
   * clock reads differently from the reader's. The date is included only when
   * the two clocks are on different days, so the common case stays short.
   */
  scheduled: { zone: string; text: string } | null;
}

/** Where a release time is being read from, and when. */
export interface ReleaseTimeContext {
  /** The reader's IANA zone. */
  readerZone: string;
  /** The zone the release was scheduled in, if it has one. */
  scheduledZone?: string | null;
  /** The instant "now" means, in epoch milliseconds. */
  now: number;
}

const DATE_AND_TIME: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

const TIME_ONLY: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

/**
 * Format `at` in `timeZone`, or `null` where the zone cannot be honoured.
 *
 * `null` rather than the formatter's fallback, because that fallback renders in
 * the reader's own zone, and a time labelled with a foreign zone's name must
 * never be the reader's time in disguise.
 */
function formatIn(
  at: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): string | null {
  if (!isValidTimezone(timeZone)) return null;
  const text = formatGlobalDateTime(at, { ...options, timeZone }, "");
  return text === "" ? null : text;
}

/**
 * The scheduled-zone reading of `at`, or `null` when it would repeat the
 * reader's.
 */
function scheduledReading(
  at: Date,
  readerZone: string,
  scheduledZone: string | null | undefined
): ReleaseTimeText["scheduled"] {
  if (!scheduledZone || !isValidTimezone(scheduledZone)) return null;
  if (wallTimeIn(at, scheduledZone) === wallTimeIn(at, readerZone)) {
    return null;
  }
  const sameDay = dayKeyIn(at, scheduledZone) === dayKeyIn(at, readerZone);
  const text = sameDay
    ? formatIn(at, scheduledZone, TIME_ONLY)
    : formatIn(at, scheduledZone, DATE_AND_TIME);
  return text === null ? null : { zone: scheduledZone, text };
}

/**
 * Every part of how `instant` reads to this reader, or `null` for no instant
 * or one that does not parse.
 */
export function releaseTimeText(
  instant: string | Date | null | undefined,
  context: ReleaseTimeContext
): ReleaseTimeText | null {
  if (!instant) return null;
  const at = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(at.getTime())) return null;

  // An unusable reader zone falls back to UTC, named, rather than to whatever
  // the formatter would pick, so "your time" and the scheduled comparison are
  // made against the same clock.
  const readerZone = isValidTimezone(context.readerZone)
    ? context.readerZone
    : "UTC";
  const local = formatIn(at, readerZone, DATE_AND_TIME);
  if (local === null) return null;

  return {
    local,
    relative: relativeTime(at.getTime(), context.now),
    scheduled: scheduledReading(at, readerZone, context.scheduledZone),
  };
}

/**
 * The instant as one sentence, for a place with room for one line: a title
 * attribute, a notice, a screen reader's reading of the cell.
 */
export function releaseTimeSentence(text: ReleaseTimeText): string {
  if (!text.scheduled) return text.local;
  return `${text.local} your time · ${text.scheduled.text} ${text.scheduled.zone} (as scheduled)`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The units a distance is said in, largest first, each with its length.
 *
 * Months and years are counted as 30 and 365 days. Past a few weeks a reader
 * wants the order of magnitude, and the exact date sits beside this anyway.
 */
const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * DAY],
  ["month", 30 * DAY],
  ["week", 7 * DAY],
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
];

/**
 * How far `at` is from `now`, in words: "in 3 days", "2 hours ago".
 *
 * Always numeric. "Tomorrow" would be a CALENDAR claim, and a count of 24-hour
 * spans cannot make it: a release 30 hours away at 23:00 runs the day after
 * tomorrow. The date beside this says which day; this says how long.
 */
export function relativeTime(at: number, now: number): string {
  const diff = at - now;
  const distance = Math.abs(diff);
  if (distance < MINUTE) return diff >= 0 ? "in under a minute" : "just now";

  const locale = getGlobalDateTimeConfig().locale ?? "en-US";
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  for (const [unit, length] of UNITS) {
    if (distance >= length) {
      return format.format(Math.round(diff / length), unit);
    }
  }
  return format.format(Math.round(diff / MINUTE), "minute");
}
