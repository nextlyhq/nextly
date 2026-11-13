// A JSON column written through a transaction's own methods stores the
// document, as the pooled methods do. A transaction's `insert` builds its
// statement itself and hands each value to mysql2, whose formatter spells an
// object as `key = value` pairs and an array as a value list — neither of them
// JSON — so a document has to be serialized before it reaches the driver, the
// way the column's own encoder serializes it on the pooled path.
//
// Every method a transaction offers for a write is covered, with an object and
// an array, and each row is read back twice: through the model, as a caller
// reads it, and raw, so a value the model would decode differently from what
// the table holds still fails.
//
// Self-skips when TEST_MYSQL_URL is unset or unreachable.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import { json, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createMySqlAdapter, type MySqlAdapter } from "../index";

const TABLE = "int_txmysql_json_writes";
const TEST_DB_URL = process.env.TEST_MYSQL_URL;

const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "varchar(36)", primaryKey: true },
    { name: "doc", type: "json" },
  ],
};

const docs = mysqlTable(TABLE, {
  id: varchar("id", { length: 36 }).primaryKey(),
  doc: json("doc"),
});

const OBJECT = { a: 1, nested: { b: [true, null, "c"] } };
const ARRAY = [1, "two", { three: 3 }, [4]];

const byId = (id: string) => ({
  and: [{ column: "id", op: "=" as const, value: id }],
});

const canConnect = async (url: string): Promise<boolean> => {
  // Bound the probe so an unreachable TEST_MYSQL_URL cannot hang the suite for
  // the OS-level connect timeout.
  const connPromise = mysql.createConnection(url).catch(() => undefined);
  const attempt = (async () => {
    const conn = await connPromise;
    if (!conn) return false;
    try {
      await conn.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  })();
  const timeout = new Promise<boolean>(resolve =>
    setTimeout(() => resolve(false), 5000)
  );
  const ok = await Promise.race([attempt, timeout]);
  void connPromise.then(conn => conn?.end().catch(() => {}));
  return ok;
};

describe("MySQL transaction writes store JSON as JSON", async () => {
  const available = TEST_DB_URL ? await canConnect(TEST_DB_URL) : false;

  if (!available) {
    it.skip("Skipping: TEST_MYSQL_URL not set or unreachable", () => {});
    return;
  }

  let adapter: MySqlAdapter;

  /** The stored document, read through the model and raw; the two must agree. */
  const stored = async (id: string): Promise<unknown> => {
    const [modelled] = await adapter.select<{ doc: unknown }>(TABLE, {
      where: byId(id),
    });
    const [raw] = await adapter.executeQuery<{ doc: unknown }>(
      `SELECT doc FROM ${TABLE} WHERE id = ?`,
      [id]
    );
    const rawDoc =
      typeof raw?.doc === "string" ? JSON.parse(raw.doc) : raw?.doc;
    expect(rawDoc).toEqual(modelled?.doc);
    return modelled?.doc;
  };

  beforeAll(async () => {
    adapter = createMySqlAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.createTable(TABLE_DEFINITION);
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? docs : null),
    });
  });

  beforeEach(async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
  });

  afterAll(async () => {
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.disconnect();
  });

  it("insert stores an object and an array", async () => {
    await adapter.transaction(async ctx => {
      await ctx.insert(TABLE, { id: "object", doc: OBJECT });
      await ctx.insert(TABLE, { id: "array", doc: ARRAY }, { returning: [] });
    });
    expect(await stored("object")).toEqual(OBJECT);
    expect(await stored("array")).toEqual(ARRAY);
  });

  it("insert stores a document that arrives serialized once, as the pooled insert does", async () => {
    await adapter.transaction(async ctx => {
      await ctx.insert(TABLE, { id: "object", doc: JSON.stringify(OBJECT) });
    });
    expect(await stored("object")).toEqual(OBJECT);
  });

  it("insertMany stores an object and an array", async () => {
    await adapter.transaction(async ctx => {
      await ctx.insertMany(TABLE, [
        { id: "object", doc: OBJECT },
        { id: "array", doc: ARRAY },
      ]);
    });
    expect(await stored("object")).toEqual(OBJECT);
    expect(await stored("array")).toEqual(ARRAY);
  });

  it("update stores an object and an array", async () => {
    await adapter.insert(TABLE, { id: "row", doc: null });
    await adapter.transaction(async ctx => {
      await ctx.update(TABLE, { doc: OBJECT }, byId("row"));
    });
    expect(await stored("row")).toEqual(OBJECT);
    await adapter.transaction(async ctx => {
      await ctx.update(TABLE, { doc: ARRAY }, byId("row"));
    });
    expect(await stored("row")).toEqual(ARRAY);
  });

  it("upsert stores an object and an array, inserting and then updating", async () => {
    await adapter.transaction(async ctx => {
      await ctx.upsert(
        TABLE,
        { id: "row", doc: OBJECT },
        { conflictColumns: ["id"] }
      );
    });
    expect(await stored("row")).toEqual(OBJECT);
    await adapter.transaction(async ctx => {
      await ctx.upsert(
        TABLE,
        { id: "row", doc: ARRAY },
        { conflictColumns: ["id"] }
      );
    });
    expect(await stored("row")).toEqual(ARRAY);
  });
});
