/**
 * A MySQL date filter selects a row Nextly wrote, whatever time zone the
 * server's session runs in.
 *
 * A date field is a MySQL `TIMESTAMP`. Every Nextly write stores a `Date`
 * through the column's own encoder, as its UTC wall clock, and MySQL reads that
 * wall clock in the SESSION time zone, which follows the server's own unless
 * something pins it. A filter is right when its bound is read the same way, so
 * this writes the row as Nextly writes it in each session zone, then filters in
 * that same zone. The REST suite cannot see this: its container runs in UTC,
 * where every spelling of a bound answers alike. This renders the condition the
 * where builder SHIPS.
 */

import {
  MySqlDialect,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildWhereClause,
  type WhereFilter,
} from "../../../domains/collections/query/query-operators";
import { buildDesiredTableFromFields } from "../../../domains/schema/pipeline/diff/build-from-fields";
import { emitDdl } from "../../../domains/schema/pipeline/ddl-emitter";
import { buildDrizzleCondition } from "../drizzle-condition";

const URL = process.env.TEST_MYSQL_URL;
const TABLE = "dfo_tz_probe";
const ZONES = ["+00:00", "-08:00", "+05:30"];

/** The table as the where builder sees a collection's: a date field `c`. */
const table = mysqlTable(TABLE, {
  label: varchar("label", { length: 255 }),
  c: timestamp("c"),
});

/** The row's instant: 03:00 UTC on March 4, 19:00 on March 3 at -08:00. */
const STORED = new Date("2026-03-04T03:00:00.000Z");

type Conn = {
  query: (text: string, values?: unknown[]) => Promise<[unknown, unknown]>;
  end: () => Promise<void>;
};

let connection: Conn | undefined;

/**
 * Store the row in `zone` as a Nextly write stores it: the instant through the
 * column's own encoder, the one `mapDateValuesToDriver` applies to every write.
 */
async function writeAt(zone: string): Promise<void> {
  if (!connection) throw new Error("no connection");
  await connection.query(`SET time_zone = '${zone}'`);
  await connection.query(`DELETE FROM ${TABLE}`);
  await connection.query(
    `INSERT INTO ${TABLE} (id, title, slug, label, c) VALUES ('probe', 'probe', 'probe', 'probe', ?)`,
    [table.c.mapToDriverValue(STORED)]
  );
}

/** How many rows a filter selects, read in the zone the row was written in. */
async function countAt(zone: string, where: WhereFilter): Promise<number> {
  if (!connection) throw new Error("no connection");
  await writeAt(zone);
  const condition = buildDrizzleCondition(buildWhereClause(where), table);
  if (!condition) throw new Error("the filter compiled to no condition");
  const { sql: text, params } = new MySqlDialect().sqlToQuery(condition);
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS n FROM ${TABLE} WHERE ${text}`,
    params
  );
  return Number((rows as Array<{ n: number }>)[0]?.n ?? -1);
}

const describeOrSkip = URL ? describe : describe.skip;

describeOrSkip("a MySQL date filter, across session time zones", () => {
  beforeAll(async () => {
    const { createConnection } = await import("mysql2/promise");
    connection = (await createConnection(URL as string)) as unknown as Conn;
    await connection.query(`DROP TABLE IF EXISTS ${TABLE}`);
    // Created by the same code that creates a real collection table, so the
    // probe certifies the filter over the column type a date field gets.
    const spec = buildDesiredTableFromFields(
      TABLE,
      [
        { name: "label", type: "text" },
        { name: "c", type: "date" },
      ],
      "mysql",
      { builtBy: "collection" }
    );
    expect(spec.columns.find(column => column.name === "c")?.type).toBe(
      "timestamp"
    );
    for (const statement of emitDdl(
      [{ type: "add_table", table: spec }],
      "mysql"
    )) {
      await connection.query(statement);
    }
  });

  afterAll(async () => {
    await connection?.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await connection?.end();
    connection = undefined;
  });

  it("selects the row after a UTC midnight bound in every session zone", async () => {
    const where = { c: { greater_than_equal: "2026-03-04T00:00:00Z" } };
    const counts: number[] = [];
    for (const zone of ZONES) counts.push(await countAt(zone, where));
    expect(counts).toEqual([1, 1, 1]);
  });

  it("compares the stored instant exactly in every session zone", async () => {
    // Equal to the second, and not a second later, whatever the zone.
    for (const zone of ZONES) {
      expect(
        await countAt(zone, { c: { equals: "2026-03-04T03:00:00Z" } }),
        zone
      ).toBe(1);
      expect(
        await countAt(zone, { c: { greater_than: "2026-03-04T03:00:00Z" } }),
        zone
      ).toBe(0);
    }
  });
});
