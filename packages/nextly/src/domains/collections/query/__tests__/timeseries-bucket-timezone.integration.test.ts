/**
 * A MySQL bucket answers the same instant whatever time zone the server runs in.
 *
 * A date field is a MySQL `TIMESTAMP`, and MySQL converts a `TIMESTAMP` into the
 * SESSION time zone on read. That zone follows `@@global.time_zone`, which is
 * `SYSTEM` by default and therefore the host's — so a server outside UTC would
 * bucket a row near a boundary under an adjacent point, while the window it is
 * matched against is generated in UTC and its label claims to be UTC.
 *
 * The suite that exercises the whole read cannot see this: it connects with
 * whatever zone the test container happens to run in, which is UTC, so the
 * defect and the fix produce identical answers there. This drives the SHIPPED
 * expression directly and varies the one thing that suite holds constant.
 */

import { MySqlDialect } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  TIMESERIES_INTERVALS,
  type TimeseriesInterval,
} from "../timeseries-interval";
import { buildDesiredTableFromFields } from "../../../schema/pipeline/diff/build-from-fields";
import { emitDdl } from "../../../schema/pipeline/ddl-emitter";
import {
  timeseriesBoundOperand,
  timeseriesBucketExpression,
} from "../timeseries-bucket";

const URL = process.env.TEST_MYSQL_URL;
const TABLE = "tz_bucket_probe";
/** The date field the bucket expression is exercised over. */
const DATE_COLUMN = "c";

/**
 * One stored instant per interval, each chosen so that a +05:30 shift crosses
 * THAT interval's boundary.
 *
 * One instant for all five would not do. 2026-03-04T23:30Z shifted to
 * 2026-03-05T05:00 crosses an hour and a day and stays inside the same week,
 * month and year -- so three of five cases would pass whatever the expression
 * did, while reading as coverage. Each row here can actually fail.
 */
const PROBES: Record<
  TimeseriesInterval,
  { stored: string; utcBucket: string }
> = {
  hour: { stored: "2026-03-04 23:30:00", utcBucket: "2026-03-04 23:00:00" },
  day: { stored: "2026-03-04 23:30:00", utcBucket: "2026-03-04 00:00:00" },
  // A Sunday: +05:30 moves it into Monday, the next ISO week.
  week: { stored: "2026-03-08 23:30:00", utcBucket: "2026-03-02 00:00:00" },
  // The last day of a month: +05:30 moves it into the next month.
  month: { stored: "2026-03-31 23:30:00", utcBucket: "2026-03-01 00:00:00" },
  // The last day of a year: +05:30 moves it into the next year.
  year: { stored: "2026-12-31 23:30:00", utcBucket: "2026-01-01 00:00:00" },
};

type Conn = {
  query: (text: string) => Promise<[unknown, unknown]>;
  end: () => Promise<void>;
};

let connection: Conn | undefined;

/** The statement the product would run, rendered for MySQL. */
function bucketSql(interval: TimeseriesInterval): string {
  const expression = timeseriesBucketExpression(sql`\`c\``, interval, "mysql");
  const { sql: text, params } = new MySqlDialect().sqlToQuery(expression);
  // A bound parameter here would mean the rendered text is not the whole
  // statement, so reading it back would prove nothing about what runs.
  expect(params).toEqual([]);
  return text;
}

async function bucketAt(zone: string, interval: TimeseriesInterval) {
  if (!connection) throw new Error("no connection");
  await connection.query(`SET time_zone = '${zone}'`);
  const [rows] = await connection.query(
    `SELECT ${bucketSql(interval)} AS b FROM ${TABLE} WHERE label = '${interval}'`
  );
  return (rows as Array<{ b: string }>)[0]?.b;
}

const describeOrSkip = URL ? describe : describe.skip;

describeOrSkip("a MySQL timeseries bucket, across server time zones", () => {
  beforeAll(async () => {
    const { createConnection } = await import("mysql2/promise");
    connection = (await createConnection(URL as string)) as unknown as Conn;
    await connection.query(`DROP TABLE IF EXISTS ${TABLE}`);
    // Created by the SAME code that creates a real collection table: fields in,
    // a `TableSpec` out, DDL emitted for MySQL. Assembling the statement here
    // would leave the probe certifying the bucket expression over a shape no
    // collection has, the moment either the field-to-column mapping or the
    // emitter changed -- and it would still read as coverage, because the
    // expression works perfectly well over a column nobody stores data in.
    const spec = buildDesiredTableFromFields(
      TABLE,
      [
        { name: "label", type: "text" },
        { name: DATE_COLUMN, type: "date" },
      ],
      "mysql",
      { builtBy: "collection" }
    );
    // The expression under test is only meaningful over a timestamp column, so
    // a mapping that stopped producing one must fail here rather than quietly
    // change what is being certified.
    expect(spec.columns.find(c => c.name === DATE_COLUMN)?.type).toBe(
      "timestamp"
    );
    for (const statement of emitDdl(
      [{ type: "add_table", table: spec }],
      "mysql"
    )) {
      await connection.query(statement);
    }
    // Written at UTC so every stored instant is unambiguous. The system columns
    // the production table carries are filled explicitly rather than left to
    // their defaults, so a row is entirely described by this statement.
    await connection.query(`SET time_zone = '+00:00'`);
    for (const [interval, probe] of Object.entries(PROBES)) {
      await connection.query(
        `INSERT INTO ${TABLE} (id, title, slug, label, ${DATE_COLUMN})
         VALUES ('${interval}', '${interval}', '${interval}', '${interval}', '${probe.stored}')`
      );
    }
  });

  afterAll(async () => {
    await connection?.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await connection?.end();
    connection = undefined;
  });

  it.each(TIMESERIES_INTERVALS)(
    "answers the same %s bucket at +00:00, +05:30 and -08:00",
    async interval => {
      const utc = await bucketAt("+00:00", interval);
      const ahead = await bucketAt("+05:30", interval);
      const behind = await bucketAt("-08:00", interval);

      // The expected value is NAMED rather than compared only against the UTC
      // run: three answers agreeing on the wrong instant would satisfy an
      // equality check between them.
      expect(utc).toBe(PROBES[interval].utcBucket);
      expect(ahead).toBe(utc);
      expect(behind).toBe(utc);
    }
  );

  it("selects the same rows for a window bound at every session zone", async () => {
    // The other half of the zone question. The bucket expression decides which
    // point a row lands in; the WHERE bound decides whether the row is read at
    // all, and MySQL interprets a datetime operand compared against a
    // `TIMESTAMP` in the session zone. Measured: a row stored at
    // 2026-03-04T03:00:00Z matches `c >= '2026-03-04 00:00:00'` at +00:00 and
    // does NOT match it at -08:00, so the first eight hours of the oldest
    // interval would be dropped while the bucket beside it is UTC-normalised.
    if (!connection) throw new Error("no connection");
    const bound = new Date("2026-03-04T00:00:00.000Z");
    const operand = timeseriesBoundOperand(bound, "mysql");
    const { sql: text, params } = new MySqlDialect().sqlToQuery(
      sql`SELECT COUNT(*) AS n FROM ${sql.raw(TABLE)} WHERE label = 'day' AND c >= ${operand}`
    );

    const counts: number[] = [];
    for (const zone of ["+00:00", "-08:00", "+05:30"]) {
      await connection.query(`SET time_zone = '${zone}'`);
      const inlined = params.reduce<string>(
        (statement, value) => statement.replace("?", String(value)),
        text
      );
      const [rows] = await connection.query(inlined);
      counts.push(Number((rows as Array<{ n: number }>)[0]?.n ?? -1));
    }

    // The `day` row is 2026-03-04 23:30:00Z, which is after the bound in every
    // zone once the operand is absolute.
    expect(counts).toEqual([1, 1, 1]);
  });

  it("would have dropped rows at a negative offset without the absolute bound", async () => {
    // The must-differ control: the naive bound is a wall-clock literal, and at
    // -08:00 it excludes a row that is genuinely inside the window.
    if (!connection) throw new Error("no connection");
    await connection.query(`SET time_zone = '-08:00'`);
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS n FROM ${TABLE} WHERE label = 'day' AND c >= '2026-03-05 00:00:00'`
    );
    // 2026-03-04 23:30:00Z reads as 15:30 on 2026-03-04 at -08:00, so a naive
    // bound of 2026-03-05 00:00:00 excludes it while the absolute one keeps it.
    expect(Number((rows as Array<{ n: number }>)[0]?.n)).toBe(0);
  });

  it.each(TIMESERIES_INTERVALS)(
    "would have got the %s bucket wrong without the normalisation",
    async interval => {
      // Proves each probe row can DISCRIMINATE. Formatting the column directly
      // is what the expression did before, and at +05:30 every one of these
      // rows crosses its own interval boundary -- so a row that could not fail
      // is caught here rather than passing as coverage.
      if (!connection) throw new Error("no connection");
      await connection.query(`SET time_zone = '+05:30'`);
      const naive = timeseriesBucketExpression(sql`\`c\``, interval, "mysql");
      // `replaceAll`, not `replace`: the week expression contains the
      // normalisation TWICE, and undoing only the first would test a statement
      // the product never had either way.
      const normalisation =
        "date_add('1970-01-01 00:00:00', interval unix_timestamp(`c`) second)";
      const rendered = new MySqlDialect()
        .sqlToQuery(naive)
        .sql.replaceAll(normalisation, "`c`");
      // The undo has to have DONE something, or this control silently becomes a
      // second copy of the assertion above.
      expect(rendered).not.toContain(normalisation);
      expect(rendered).toContain("`c`");
      const [rows] = await connection.query(
        `SELECT ${rendered} AS b FROM ${TABLE} WHERE label = '${interval}'`
      );
      expect((rows as Array<{ b: string }>)[0]?.b).not.toBe(
        PROBES[interval].utcBucket
      );
    }
  );
});
