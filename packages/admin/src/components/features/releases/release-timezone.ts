/**
 * Turning instants into what a reader in a given zone would call them.
 *
 * A release carries an INSTANT and the author's timezone, and those two facts
 * disagree about basic questions. "Which day does this launch on" has no answer
 * until a zone is named: a release at 23:00 in Berlin is the following day in
 * UTC and the same evening in New York, so a calendar cannot place it, and a
 * schedule input cannot resolve what somebody typed, without one.
 *
 * Extracted from the schedule dialog when the calendar needed the same
 * arithmetic. Two implementations of a zone conversion agree until a daylight
 * boundary, and then disagree by an hour in a way neither screen can show.
 *
 * @module components/features/releases/release-timezone
 */
import { isValidTimezone } from "@admin/lib/dates/format";

/**
 * The offset, in minutes, that `timeZone` is running at `instant`.
 *
 * Derived by asking `Intl` what the wall clock reads there and subtracting the
 * instant, rather than from a table: the platform's own database is the only
 * thing that knows when a zone last changed its rules.
 */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(part => part.type === type)?.value ?? "0");

  // `hour` formats midnight as 24 under `hour12: false` in some engines, which
  // would place the reading a day late if carried through unchanged.
  const hour = read("hour") % 24;
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    hour,
    read("minute"),
    read("second")
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/** What a clock in `timeZone` reads at `instant`, as `YYYY-MM-DDTHH:mm`. */
export function wallTimeIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? "";
  const hour = String(Number(read("hour")) % 24).padStart(2, "0");
  return `${read("year")}-${read("month")}-${read("day")}T${hour}:${read("minute")}`;
}

/**
 * The calendar day `instant` falls on in `timeZone`, as `YYYY-MM-DD`.
 *
 * The calendar's whole bucketing rule. Derived from the same `Intl` reading the
 * offset arithmetic uses rather than from a UTC rendering, because a UTC day is
 * the one thing this must NOT answer with — placing a 23:00 Berlin launch on
 * the following day is exactly the error a calendar exists to prevent.
 */
export function dayKeyIn(instant: Date, timeZone: string): string {
  return wallTimeIn(instant, timeZone).slice(0, 10);
}

/**
 * The instant at which `wall` occurs in `timeZone`, as an ISO string with `Z`.
 *
 * Both DST edges are answered here, and they need opposite treatment.
 *
 * A SPRING FORWARD deletes an hour, so the requested wall time may not exist at
 * all. Returning the solver's nearest approach schedules a different moment
 * while every screen reads as though it took: measured, `2026-03-29T02:30` in
 * `Europe/Berlin` came back as 03:30 and `2026-03-08T02:30` in
 * `America/New_York` as 01:30 — an hour late and an hour early from ONE
 * implementation. So a candidate is accepted only if it renders back as exactly
 * what was typed, and `null` otherwise.
 *
 * A FALL BACK repeats an hour, so TWO real instants render as the requested
 * time — in Berlin on 2026-10-25, `00:30Z` and `01:30Z` both read as 02:30. A
 * single-candidate solver silently returns whichever its arithmetic lands on,
 * which is the later one; "02:30 that day" means the first, and an editor who
 * meant the second would have to be able to say so, which this input cannot
 * express. So both offsets in play around the instant are tried and the EARLIER
 * surviving candidate wins.
 *
 * Offsets are read at a full day either side rather than derived from one
 * guess, because that is what makes both members of the ambiguous pair
 * reachable — a transition is at most a couple of hours wide and always falls
 * inside that window.
 */
export function instantFor(wall: string, timeZone: string): string | null {
  // `datetime-local` yields `YYYY-MM-DDTHH:mm`, which `Date.parse` reads as
  // LOCAL time. Appending `Z` reads the same digits as UTC, which is the anchor
  // every candidate below is measured from.
  const asUtc = new Date(`${wall}:00.000Z`);
  if (Number.isNaN(asUtc.getTime())) return null;

  const DAY = 86_400_000;
  const offsets = new Set([
    offsetMinutesAt(new Date(asUtc.getTime() - DAY), timeZone),
    offsetMinutesAt(asUtc, timeZone),
    offsetMinutesAt(new Date(asUtc.getTime() + DAY), timeZone),
  ]);

  const candidates = [...offsets]
    .map(offset => new Date(asUtc.getTime() - offset * 60_000))
    // The round trip is the whole guarantee: an offset that does not reproduce
    // the typed wall time is not this zone's offset at that moment.
    .filter(candidate => wallTimeIn(candidate, timeZone) === wall)
    .sort((a, b) => a.getTime() - b.getTime());

  return candidates[0]?.toISOString() ?? null;
}

/** The reader's own zone, or UTC where the platform will not name one. */
export function readerZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimezone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}
