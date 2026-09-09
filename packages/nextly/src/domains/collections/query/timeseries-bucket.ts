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
    // `WEEKDAY` counts Monday as 0, so subtracting it lands on the Monday of
    // the row's own week. `WEEK()` is not used: where its week starts depends
    // on a mode argument whose default is a server setting.
    const source =
      interval === "week"
        ? sql`date_sub(${column}, interval weekday(${column}) day)`
        : sql`${column}`;
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
