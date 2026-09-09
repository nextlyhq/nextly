/**
 * The SQL each dialect buckets a date column with.
 *
 * Separate from `timeseries-interval.ts` because this reaches Drizzle, and the
 * interval vocabulary is published on the client-safe config surface where a
 * database import is refused.
 */

import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import type { SupportedDialect } from "../../../types/database";

import { bucketFormat, type TimeseriesInterval } from "./timeseries-interval";

/**
 * The instant each row's date falls into, as text every dialect spells alike.
 *
 * TEXT on all three, rather than each database's own date type. PostgreSQL
 * hands a `timestamp` back to the driver as a `Date` while MySQL and SQLite
 * answer strings, so returning the native type would label identical data
 * differently per adapter — the divergence a bucket label exists to remove.
 * `YYYY-MM-DD HH:MM:SS` is fixed width, so ordering it lexicographically is
 * ordering it chronologically, with one comparison that works everywhere.
 *
 * ONE expression, handed to `SELECT`, `GROUP BY` and `ORDER BY` alike. MySQL's
 * `only_full_group_by` refuses a `GROUP BY` expression that differs from the
 * selected one, so the three cannot be spelled separately even if they agreed
 * on the day they were written.
 *
 * No time zone is applied. These columns hold a wall clock that is UTC because
 * the write path binds UTC, which is the same reading `parseWallClockAsUtc`
 * takes when it decodes one. Converting would move a row recorded either side
 * of midnight into the adjacent day's bucket.
 */
/**
 * What a MySQL `TIMESTAMP` column can hold, as epoch seconds.
 *
 * The documented range is 1970-01-01 00:00:01 UTC to 2038-01-19 03:14:07 UTC.
 * A bound outside it cannot exclude a stored row, and rendering one produces
 * NULL rather than a comparison.
 */
const MYSQL_TIMESTAMP_MIN_EPOCH = 1;
const MYSQL_TIMESTAMP_MAX_EPOCH = 2147483647;

/**
 * The value a window bound is compared against, spelled so the comparison means
 * the same instant whatever zone the server runs in.
 *
 * PostgreSQL and SQLite need nothing: a `timestamp` carries no zone and SQLite
 * stores epoch seconds, so the driver's own mapping is already absolute.
 *
 * MySQL does. It interprets a datetime operand compared against a `TIMESTAMP`
 * in the SESSION time zone, so a bound meaning UTC midnight is read as 08:00Z
 * on a server at -08:00 and the first eight hours of the oldest interval are
 * dropped -- while the bucket expression beside it is UTC-normalised, so the
 * filter and the buckets would cover different windows. Measured: a row stored
 * at 2026-03-04T03:00:00Z matches `c >= '2026-03-04 00:00:00'` at +00:00 and
 * does NOT match it at -08:00.
 *
 * `from_unixtime` renders the absolute instant in whatever the session zone is,
 * which is the same zone the column is compared in, so the two agree. It is a
 * constant expression, so an index over the date still serves the comparison --
 * confirmed with `EXPLAIN`, which keeps the key. Wrapping the COLUMN in
 * `unix_timestamp` would be equally correct and would lose the index.
 */
export function timeseriesBoundOperand(
  instant: Date,
  dialect: SupportedDialect
): Date | SQL | undefined {
  if (dialect !== "mysql") return instant;
  const epochSeconds = Math.floor(instant.getTime() / 1000);
  if (!Number.isFinite(epochSeconds)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "interval",
          code: "TIMESERIES_WINDOW_INVALID",
          message: "A timeseries window bound must be a real instant.",
        },
      ],
    });
  }
  // A bound outside what a MySQL `TIMESTAMP` can hold is DROPPED rather than
  // rendered, because `from_unixtime` answers NULL outside its range and
  // `column >= NULL` matches nothing -- so the predicate meant to bound the
  // scan would instead empty it, and the whole series would report zeros while
  // rows exist. Measured: `from_unixtime(-9750000000)` is NULL, and a probe
  // table holding one row returns 0 for `c >= from_unixtime(-9750000000)`.
  //
  // Reachable from an ordinary request, not a contrived one: 366 yearly
  // intervals is the documented maximum, and in 2026 that window starts in
  // 1661.
  //
  // Dropping the bound is sound rather than a fallback. A `TIMESTAMP` cannot
  // store an instant outside this range, so a bound beyond it excludes no row
  // that could exist -- the predicate was never doing anything except limiting
  // the scan, and there is nothing there to skip.
  if (epochSeconds < MYSQL_TIMESTAMP_MIN_EPOCH) return undefined;
  if (epochSeconds > MYSQL_TIMESTAMP_MAX_EPOCH) return undefined;
  return sql`from_unixtime(${epochSeconds})`;
}

/**
 * Whether a window can contain any instant the dialect is able to store.
 *
 * The rendered bounds cannot answer this, and reading them as though they could
 * is what makes a spanning window look empty. Each end is dropped
 * INDIVIDUALLY when it falls outside the storable range, so "both ends were
 * dropped" describes two opposite windows: one lying entirely to one side of
 * the range, and one SURROUNDING it. A 366-interval yearly window anchored in
 * 2040 runs from 1675 to 2041 and drops both ends while containing every
 * instant a MySQL `TIMESTAMP` can hold, so treating it as unaskable would
 * answer zeros for 1970 through 2038 without reading a row.
 *
 * The endpoints are therefore judged as a RANGE, before either is rendered.
 * `to` is the exclusive end of the last bucket, so a window ending exactly at
 * the first storable instant holds nothing.
 */
export function timeseriesWindowIsStorable(
  from: Date,
  to: Date,
  dialect: SupportedDialect
): boolean {
  if (dialect !== "mysql") return true;
  return (
    from.getTime() <= MYSQL_TIMESTAMP_MAX_EPOCH * 1000 &&
    to.getTime() > MYSQL_TIMESTAMP_MIN_EPOCH * 1000
  );
}

export function timeseriesBucketExpression(
  column: unknown,
  interval: TimeseriesInterval,
  dialect: SupportedDialect
): SQL {
  const format = sql.raw(`'${bucketFormat(interval)}'`);

  if (dialect === "postgresql") {
    // `date_trunc` already starts its week on Monday, matching ISO-8601 and
    // the Monday the other two dialects are steered to. Its own output is
    // rendered rather than returned, so all three answer the same text.
    return sql`to_char(date_trunc(${sql.raw(`'${interval}'`)}, ${column}), 'YYYY-MM-DD HH24:MI:SS')`;
  }

  if (dialect === "mysql") {
    // Read back as UTC before anything is formatted. A date field is a MySQL
    // `TIMESTAMP`, and MySQL converts a `TIMESTAMP` into the SESSION time zone
    // on read -- a zone that follows `@@global.time_zone`, which is `SYSTEM` by
    // default and therefore the host's. Formatting the column directly would
    // bucket in whatever zone the server happens to run in while the window
    // this is matched against is generated in UTC, so a row near a boundary
    // lands under an adjacent point whose label claims to be UTC. Measured: one
    // row stored at 2026-03-04T23:30:00Z buckets to 2026-03-04 with the session
    // at +00:00 and to 2026-03-05 at +05:30.
    //
    // `unix_timestamp` answers the absolute instant whatever the session zone
    // is, and adding it to a literal epoch produces the UTC wall clock without
    // consulting a zone at all. `convert_tz` is not used: it needs a named
    // source zone, and `@@session.time_zone` is frequently the literal
    // `SYSTEM`, which `convert_tz` cannot resolve.
    const utc = sql`date_add('1970-01-01 00:00:00', interval unix_timestamp(${column}) second)`;
    // `WEEKDAY` counts Monday as 0, so subtracting it lands on the Monday of
    // the row's own week. `WEEK()` is not used: where its week starts depends
    // on a mode argument whose default is a server setting.
    const source =
      interval === "week"
        ? sql`date_sub(${utc}, interval weekday(${utc}) day)`
        : utc;
    return sql`date_format(${source}, ${format})`;
  }

  if (dialect === "sqlite") {
    // `unixepoch` is load-bearing. These columns store epoch SECONDS, and
    // without the modifier SQLite reads the integer as a Julian day. A modern
    // epoch value is far past the largest Julian day SQLite can render, so
    // every row answers NULL and the whole collection collapses into a single
    // undated bucket — silently, with no error raised.
    //
    // `-6 days` then `weekday 1` is the Monday of the row's own week: from any
    // day, stepping back six days and forward to the next Monday lands on that
    // week's Monday, including when the row already falls on one.
    const week = interval === "week" ? sql`, '-6 days', 'weekday 1'` : sql``;
    return sql`strftime(${format}, ${column}, 'unixepoch'${week})`;
  }

  throw NextlyError.validation({
    errors: [
      {
        path: "interval",
        code: "TIMESERIES_UNSUPPORTED_DIALECT",
        message: `Timeseries buckets are not implemented for the "${String(dialect)}" database.`,
      },
    ],
  });
}
