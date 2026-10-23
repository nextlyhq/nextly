/**
 * A MySQL date filter selects the same rows whatever time zone the server runs
 * in.
 *
 * A date field is a MySQL `TIMESTAMP`, and MySQL compares a `TIMESTAMP` with a
 * datetime operand in the SESSION time zone, which follows the server's own
 * unless something pins it. A bound handed over as a wall-clock datetime is
 * therefore read as a different instant on a server outside UTC. The REST
 * suite cannot see this: its container runs in UTC, where the defect and the
 * fix answer alike. This renders the condition the where builder SHIPS and
 * runs it under three session zones.
 */

import {
  MySqlDialect,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildWhereClause } from "../../../domains/collections/query/query-operators";
import { buildDesiredTableFromFields } from "../../../domains/schema/pipeline/diff/build-from-fields";
import { emitDdl } from "../../../domains/schema/pipeline/ddl-emitter";
import { buildDrizzleCondition } from "../drizzle-condition";

const URL = process.env.TEST_MYSQL_URL;
const TABLE = "dfo_tz_probe";

/** The table as the where builder sees a collection's: a date field `c`. */
const table = mysqlTable(TABLE, {
  label: varchar("label", { length: 255 }),
  c: timestamp("c"),
});

type Conn = {
  query: (text: string, values?: unknown[]) => Promise<[unknown, unknown]>;
  end: () => Promise<void>;
};

let connection: Conn | undefined;

/** How many probe rows a filter selects at a session zone. */
async function countAt(zone: string, where: Record<string, unknown>) {
  if (!connection) throw new Error("no connection");
  const condition = buildDrizzleCondition(buildWhereClause(where), table);
  if (!condition) throw new Error("the filter compiled to no condition");
  const { sql: text, params } = new MySqlDialect().sqlToQuery(condition);
  await connection.query(`SET time_zone = '${zone}'`);
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS n FROM ${TABLE} WHERE ${text}`,
    params
  );
  return Number((rows as Array<{ n: number }>)[0]?.n ?? -1);
}

const describeOrSkip = URL ? describe : describe.skip;

describeOrSkip("a MySQL date filter, across server time zones", () => {
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
    // Written at UTC, so the stored instant is unambiguous: 03:00 UTC on
    // March 4, which is 19:00 on March 3 at -08:00.
    await connection.query(`SET time_zone = '+00:00'`);
    await connection.query(
      `INSERT INTO ${TABLE} (id, title, slug, label, c)
       VALUES ('probe', 'probe', 'probe', 'probe', '2026-03-04 03:00:00')`
    );
  });

  afterAll(async () => {
    await connection?.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await connection?.end();
    connection = undefined;
  });

  it("selects the row after a UTC midnight bound at +00:00, -08:00 and +05:30", async () => {
    // A bound at UTC midnight, read as wall-clock midnight at -08:00, would be
    // 08:00 UTC and leave out the row stored at 03:00 UTC.
    const where = { c: { greater_than_equal: "2026-03-04T00:00:00Z" } };
    const counts: number[] = [];
    for (const zone of ["+00:00", "-08:00", "+05:30"]) {
      counts.push(await countAt(zone, where));
    }
    expect(counts).toEqual([1, 1, 1]);
  });

  it("compares the stored instant exactly at every zone", async () => {
    // Equal to the second, and not a second later, whatever the zone.
    for (const zone of ["+00:00", "-08:00", "+05:30"]) {
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
