import { sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { SQLiteDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { SupportedDialect } from "../../../../types/database";
import { timeseriesBucketExpression } from "../timeseries-bucket";
import {
  bucketStartToDbText,
  bucketStartToIso,
  bucketStartUtc,
  intervalWindow,
  isTimeseriesInterval,
  TIMESERIES_INTERVALS,
  type TimeseriesInterval,
} from "../timeseries-interval";

/** A stand-in for the grouped column, so the rendering can be read as text. */
const COLUMN = sql`"created_at"`;

function render(interval: TimeseriesInterval, dialect: SupportedDialect) {
  const expression = timeseriesBucketExpression(COLUMN, interval, dialect);
  if (dialect === "postgresql") return new PgDialect().sqlToQuery(expression);
  if (dialect === "mysql") return new MySqlDialect().sqlToQuery(expression);
  return new SQLiteDialect().sqlToQuery(expression);
}

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

describe("timeseriesBucketExpression", () => {
  it.each(DIALECTS)(
    "binds no parameters on %s, so one expression stays byte-identical wherever it is placed",
    dialect => {
      // MySQL's `only_full_group_by` compares the GROUP BY expression with the
      // selected one. A bound parameter would render as a placeholder in each
      // position, and two placeholders are not self-evidently one expression.
      for (const interval of TIMESERIES_INTERVALS) {
        const { params } = render(interval, dialect);
        expect(params, `${dialect}/${interval} bound a parameter`).toEqual([]);
      }
    }
  );

  it("renders every interval's start, never the row's own position inside it", () => {
    // A month bucket asking the database for `%d` would give two rows in one
    // month two different labels.
    expect(render("month", "sqlite").sql).toContain("'%Y-%m-01 00:00:00'");
    expect(render("year", "sqlite").sql).toContain("'%Y-01-01 00:00:00'");
    expect(render("day", "sqlite").sql).toContain("'%Y-%m-%d 00:00:00'");
    expect(render("hour", "sqlite").sql).toContain("'%Y-%m-%d %H:00:00'");
  });

  it("keeps SQLite reading epoch seconds rather than a Julian day", () => {
    // Without the modifier a modern epoch value is past the largest Julian day
    // SQLite renders, so every row answers NULL and the collection collapses
    // into one undated bucket with no error raised.
    for (const interval of TIMESERIES_INTERVALS) {
      expect(render(interval, "sqlite").sql).toContain("'unixepoch'");
    }
  });

  it("starts a week on Monday in each dialect's own spelling", () => {
    expect(render("week", "postgresql").sql).toContain("date_trunc('week'");
    // `WEEKDAY` counts Monday as 0; `WEEK()` would depend on a server default.
    expect(render("week", "mysql").sql).toContain("weekday");
    expect(render("week", "mysql").sql).not.toContain("week(");
    expect(render("week", "sqlite").sql).toContain("'-6 days', 'weekday 1'");
  });

  it("applies the week shift only to the week interval", () => {
    for (const interval of TIMESERIES_INTERVALS) {
      if (interval === "week") continue;
      expect(render(interval, "sqlite").sql).not.toContain("weekday 1");
      expect(render(interval, "mysql").sql).not.toContain("weekday");
    }
  });

  it("converts no time zone, so a row keeps the day it was written on", () => {
    for (const dialect of DIALECTS) {
      for (const interval of TIMESERIES_INTERVALS) {
        const { sql: text } = render(interval, dialect);
        expect(text.toLowerCase()).not.toContain("at time zone");
        expect(text.toLowerCase()).not.toContain("convert_tz");
        expect(text.toLowerCase()).not.toContain("localtime");
      }
    }
  });

  it("refuses an interval that reached it past the type", () => {
    // The union is enforced at the boundary, but a closed table indexed by a
    // value that is not in it would otherwise render `undefined` into SQL.
    const call = () =>
      timeseriesBucketExpression(
        COLUMN,
        "fortnight" as TimeseriesInterval,
        "sqlite"
      );
    expect(call).toThrow(NextlyError);
  });

  it("refuses an inherited name rather than reading it off the prototype", () => {
    // The format table is an ordinary object, so `toString` resolves to a
    // prototype method and would render a function body into the statement.
    const call = () =>
      timeseriesBucketExpression(
        COLUMN,
        "toString" as TimeseriesInterval,
        "sqlite"
      );
    expect(call).toThrow(NextlyError);
  });

  it("refuses a dialect it has no expression for", () => {
    const call = () =>
      timeseriesBucketExpression(COLUMN, "day", "oracle" as SupportedDialect);
    expect(call).toThrow(NextlyError);
  });
});

describe("isTimeseriesInterval", () => {
  it("accepts every declared interval and nothing else", () => {
    for (const interval of TIMESERIES_INTERVALS) {
      expect(isTimeseriesInterval(interval)).toBe(true);
    }
    expect(isTimeseriesInterval("fortnight")).toBe(false);
    expect(isTimeseriesInterval("")).toBe(false);
    expect(isTimeseriesInterval(undefined)).toBe(false);
    // An inherited name is not a declared interval.
    expect(isTimeseriesInterval("toString")).toBe(false);
  });
});

describe("bucketStartToIso", () => {
  it("reads the database's wall clock as UTC", () => {
    // `new Date("2026-03-04 00:00:00")` is LOCAL time to the platform, which
    // would move every point on a chart by the viewer's own offset.
    expect(bucketStartToIso("2026-03-04 00:00:00")).toBe(
      "2026-03-04T00:00:00.000Z"
    );
    expect(bucketStartToIso("2026-03-04 05:00:00")).toBe(
      "2026-03-04T05:00:00.000Z"
    );
  });

  it("answers null for text that is not an instant", () => {
    expect(bucketStartToIso("not a date")).toBeNull();
  });
});

describe("bucketStartUtc", () => {
  // The expected values on the right are the ones the three databases actually
  // produced for these same instants, so this compares the two spellings of
  // the interval rule rather than checking each against itself.
  const MEASURED: Array<[string, TimeseriesInterval, string]> = [
    ["2026-03-01T00:00:00Z", "week", "2026-02-23 00:00:00"],
    ["2026-03-02T00:00:00Z", "week", "2026-03-02 00:00:00"],
    ["2026-03-04T05:06:07Z", "week", "2026-03-02 00:00:00"],
    ["2026-03-08T23:59:59Z", "week", "2026-03-02 00:00:00"],
    ["2026-03-09T12:00:00Z", "week", "2026-03-09 00:00:00"],
    ["2026-03-04T05:06:07Z", "hour", "2026-03-04 05:00:00"],
    ["2026-03-08T23:59:59Z", "hour", "2026-03-08 23:00:00"],
    ["2026-03-04T05:06:07Z", "day", "2026-03-04 00:00:00"],
    ["2026-03-08T23:59:59Z", "day", "2026-03-08 00:00:00"],
    ["2026-03-04T05:06:07Z", "month", "2026-03-01 00:00:00"],
    ["2026-03-04T05:06:07Z", "year", "2026-01-01 00:00:00"],
  ];

  it.each(MEASURED)(
    "buckets %s by %s the way the databases did",
    (instant, interval, expected) => {
      expect(
        bucketStartToDbText(bucketStartUtc(new Date(instant), interval))
      ).toBe(expected);
    }
  );

  it("starts a week on Monday for every day of one week", () => {
    // Every day from Monday to Sunday must answer the same Monday, which is
    // the property a single spot-check cannot establish.
    for (let day = 2; day <= 8; day += 1) {
      const instant = new Date(
        `2026-03-${String(day).padStart(2, "0")}T12:00:00Z`
      );
      expect(bucketStartToDbText(bucketStartUtc(instant, "week"))).toBe(
        "2026-03-02 00:00:00"
      );
    }
  });

  it("does not move an instant that already sits on a boundary", () => {
    const midnight = new Date("2026-03-04T00:00:00Z");
    expect(bucketStartUtc(midnight, "day").toISOString()).toBe(
      midnight.toISOString()
    );
  });
});

describe("intervalWindow", () => {
  it("ends with the interval the instant falls in, oldest first", () => {
    const window = intervalWindow(new Date("2026-03-04T05:06:07Z"), "day", 3);
    expect(window.map(bucketStartToDbText)).toEqual([
      "2026-03-02 00:00:00",
      "2026-03-03 00:00:00",
      "2026-03-04 00:00:00",
    ]);
  });

  it("steps months by the calendar, not by a fixed width", () => {
    // Subtracting 30 days from the 31st lands in the wrong month, so a
    // millisecond step would put two of these in the same bucket.
    const window = intervalWindow(new Date("2026-03-31T00:00:00Z"), "month", 3);
    expect(window.map(bucketStartToDbText)).toEqual([
      "2026-01-01 00:00:00",
      "2026-02-01 00:00:00",
      "2026-03-01 00:00:00",
    ]);
  });

  it("steps back across a year boundary", () => {
    const window = intervalWindow(new Date("2026-01-15T00:00:00Z"), "month", 3);
    expect(window.map(bucketStartToDbText)).toEqual([
      "2025-11-01 00:00:00",
      "2025-12-01 00:00:00",
      "2026-01-01 00:00:00",
    ]);
  });

  it("steps weeks by seven days, staying on Monday", () => {
    const window = intervalWindow(new Date("2026-03-04T05:06:07Z"), "week", 3);
    expect(window.map(bucketStartToDbText)).toEqual([
      "2026-02-16 00:00:00",
      "2026-02-23 00:00:00",
      "2026-03-02 00:00:00",
    ]);
  });

  it("returns exactly the requested number of intervals", () => {
    for (const count of [1, 2, 7, 30]) {
      expect(intervalWindow(new Date(), "day", count)).toHaveLength(count);
    }
  });

  it("refuses a window that covers nothing", () => {
    expect(() => intervalWindow(new Date(), "day", 0)).toThrow(NextlyError);
    expect(() => intervalWindow(new Date(), "day", -1)).toThrow(NextlyError);
    expect(() => intervalWindow(new Date(), "day", Number.NaN)).toThrow(
      NextlyError
    );
  });
});
