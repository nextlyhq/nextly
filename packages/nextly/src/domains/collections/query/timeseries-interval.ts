/**
 * The interval vocabulary a timeseries buckets by, and the UTC arithmetic that
 * places an instant in one.
 *
 * Deliberately carries NO database dependency. The admin needs the vocabulary
 * to label a chart's axis and to check the width it was handed, so this module
 * is published on the client-safe `nextly/config` surface — and a browser
 * bundle that reached Drizzle through it is exactly what
 * `client-bundle-boundary.test.ts` refuses. The expression builder that needs
 * Drizzle lives beside this in `timeseries-bucket.ts` and imports from here.
 */

import { NextlyError } from "../../../errors/nextly-error";

export const TIMESERIES_INTERVALS = [
  "hour",
  "day",
  "week",
  "month",
  "year",
] as const;

export type TimeseriesInterval = (typeof TIMESERIES_INTERVALS)[number];

export function isTimeseriesInterval(
  value: unknown
): value is TimeseriesInterval {
  return (
    typeof value === "string" &&
    (TIMESERIES_INTERVALS as readonly string[]).includes(value)
  );
}

/**
 * How each interval's start is rendered, in the format specifiers SQLite's
 * `strftime` and MySQL's `DATE_FORMAT` spell identically.
 *
 * One table for both dialects, because `%Y`, `%m`, `%d` and `%H` mean the same
 * thing in each. The specifiers they disagree on are not reachable here: every
 * position below the interval is a literal, so a month bucket writes `-01`
 * rather than asking either database for a day.
 *
 * Writing the literal start is what makes the bucket a bucket. Rendering the
 * row's own `%d` into a month pattern would give two rows in one month two
 * different labels.
 */
const BUCKET_START_FORMAT: Record<TimeseriesInterval, string> = {
  hour: "%Y-%m-%d %H:00:00",
  day: "%Y-%m-%d 00:00:00",
  week: "%Y-%m-%d 00:00:00",
  month: "%Y-%m-01 00:00:00",
  year: "%Y-01-01 00:00:00",
};

/**
 * The literal spelling of one interval, refusing anything not in the table.
 *
 * These reach the statement as literal text rather than as bound parameters,
 * so the expression is byte-identical everywhere it appears. MySQL's
 * `only_full_group_by` compares the `GROUP BY` expression against the selected
 * one, and two placeholders are not self-evidently the same expression.
 *
 * Safe to inline for the reason that makes inlining unsafe elsewhere: the
 * value is read out of a closed table keyed by a validated union, never from a
 * caller. The lookup is checked anyway, so the closed set is enforced here
 * rather than assumed of every call site.
 */
export function bucketFormat(interval: TimeseriesInterval): string {
  const format = Object.prototype.hasOwnProperty.call(
    BUCKET_START_FORMAT,
    interval
  )
    ? BUCKET_START_FORMAT[interval]
    : undefined;
  if (format === undefined) {
    throw NextlyError.validation({
      errors: [
        {
          path: "interval",
          code: "TIMESERIES_INTERVAL_UNSUPPORTED",
          message: `"${String(interval)}" is not an interval a timeseries can bucket by.`,
        },
      ],
    });
  }
  return format;
}

/**
 * The bucket text as an instant a caller can plot.
 *
 * The database renders a UTC wall clock carrying no zone marker, so the marker
 * is added here rather than left to the runtime: `new Date("2026-03-04
 * 00:00:00")` is read as LOCAL time by the platform, which would shift every
 * point on a chart by the viewer's own offset.
 */
export function bucketStartToIso(text: string): string | null {
  const parsed = Date.parse(`${text.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * The start of the interval an instant falls in, as UTC.
 *
 * A second spelling of what the SQL expressions above compute, and it exists
 * because an interval with no rows produces no row to read a label from — the
 * database cannot describe a bucket it did not group. Two implementations of
 * one question drift, so `timeseries-bucket.integration.test.ts` writes a row
 * at each instant and requires the database's own label to equal this one on
 * every dialect. That test is the control; without it these are two guesses.
 */
export function bucketStartUtc(
  instant: Date,
  interval: TimeseriesInterval
): Date {
  const start = new Date(instant.getTime());
  start.setUTCMilliseconds(0);
  start.setUTCSeconds(0);
  start.setUTCMinutes(0);
  if (interval === "hour") return start;

  start.setUTCHours(0);
  if (interval === "day") return start;

  if (interval === "week") {
    // `getUTCDay` counts Sunday as 0, so this maps Monday to 0 and Sunday to 6
    // — the same ISO week the three dialects are steered to.
    const sinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - sinceMonday);
    return start;
  }

  start.setUTCDate(1);
  if (interval === "month") return start;

  start.setUTCMonth(0);
  return start;
}

/**
 * The starts of `count` consecutive intervals ending with the one `endInstant`
 * falls in, oldest first.
 *
 * Stepped by calendar field rather than by a fixed number of milliseconds: a
 * month is not a constant width, and subtracting 30 days from the 31st lands
 * in the wrong month. `setUTCDate` and `setUTCMonth` normalise across
 * boundaries, so stepping back from January reaches the previous December.
 */
export function intervalWindow(
  endInstant: Date,
  interval: TimeseriesInterval,
  count: number
): Date[] {
  if (!Number.isFinite(count) || count < 1) {
    throw NextlyError.validation({
      errors: [
        {
          path: "intervals",
          code: "TIMESERIES_WINDOW_INVALID",
          message: "A timeseries window must cover at least one interval.",
        },
      ],
    });
  }

  const last = bucketStartUtc(endInstant, interval);
  const starts: Date[] = [];
  for (let back = Math.trunc(count) - 1; back >= 0; back -= 1) {
    const step = new Date(last.getTime());
    if (interval === "hour") step.setUTCHours(step.getUTCHours() - back);
    else if (interval === "day") step.setUTCDate(step.getUTCDate() - back);
    else if (interval === "week") step.setUTCDate(step.getUTCDate() - back * 7);
    else if (interval === "month") step.setUTCMonth(step.getUTCMonth() - back);
    else step.setUTCFullYear(step.getUTCFullYear() - back);
    starts.push(step);
  }
  return starts;
}

/**
 * The start of the interval that FOLLOWS one, as an exclusive upper bound.
 *
 * A window needs both ends. Bounded only below, a read still scans and groups
 * every row after the window -- a scheduled publication date or an event date
 * puts rows in the future, and they are grouped and then discarded, so the
 * documented cap bounds the answer while the database reads the whole table.
 *
 * Stepped by calendar field for the reason the window is: a month is not a
 * constant width.
 */
export function intervalAfter(start: Date, interval: TimeseriesInterval): Date {
  const next = new Date(start.getTime());
  if (interval === "hour") next.setUTCHours(next.getUTCHours() + 1);
  else if (interval === "day") next.setUTCDate(next.getUTCDate() + 1);
  else if (interval === "week") next.setUTCDate(next.getUTCDate() + 7);
  else if (interval === "month") next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

/**
 * The database's own spelling of an interval start, so a generated label and a
 * grouped one compare as equal text.
 */
export function bucketStartToDbText(start: Date): string {
  return start.toISOString().replace("T", " ").slice(0, 19);
}
