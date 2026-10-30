/**
 * A row's time as core's list cards word it: "just now", "5m ago", "3h ago",
 * "2d ago", and the date ("Mar 1") from a week on.
 *
 * Measured from an instant the caller names, so a card and its test read the
 * same moment rather than each its own clock.
 *
 * @module dashboard/relative-time
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `iso` as a time relative to `now`, in epoch milliseconds. */
export function relativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(then));
}
