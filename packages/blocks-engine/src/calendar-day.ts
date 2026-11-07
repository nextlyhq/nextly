/**
 * A calendar day as a list stores one, `YYYY-MM-DD`: the one test of it, for
 * a date filter's value and a named query's day input alike.
 *
 * @module calendar-day
 */

/** A calendar day's spelling. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether a value is a calendar day, `YYYY-MM-DD`, that exists. */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DAY.exec(value);
  if (match === null) return false;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const date = new Date(Date.UTC(2000, (month ?? 1) - 1, day ?? 1));
  // Set apart, since `Date.UTC` reads years 0 to 99 as 1900 to 1999.
  date.setUTCFullYear(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

/**
 * The calendar day an instant falls on in a time zone, `YYYY-MM-DD`: what
 * "today" is for a page in the site's zone. `zone` must be one the runtime
 * knows (see `safeTimeZone`).
 */
export function calendarDayIn(zone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(candidate => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
