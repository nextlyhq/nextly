// An insert names a table the running instance holds no model for — one a
// newer deploy added after this process started — and is refused before any
// statement runs, as every other CRUD call already is. A transaction's insert
// used to build its own SQL and so wrote the row regardless.
//
// Both tables exist physically; only the resolver tells them apart. Rows are
// counted with raw SQL, since the model cannot be asked about the table it
// does not hold.
//
// Self-skips when TEST_MYSQL_URL is unset or unreachable.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import { TABLE_NOT_REGISTERED_CODE } from "@nextlyhq/adapter-drizzle/types";
import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createMySqlAdapter, type MySqlAdapter } from "../index";

const TEST_DB_URL = process.env.TEST_MYSQL_URL;

const KNOWN = "int_mysql_insert_known";
const UNKNOWN = "int_mysql_insert_unknown";

const definition = (name: string): TableDefinition => ({
  name,
  columns: [
    { name: "id", type: "varchar(36)", primaryKey: true },
    { name: "title", type: "varchar(255)" },
  ],
});

const known = mysqlTable(KNOWN, {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: varchar("title", { length: 255 }),
});

/** Every insert road, each writing into `table`. */
const ROADS: Array<
  [string, (adapter: MySqlAdapter, table: string) => Promise<unknown>]
> = [
  [
    "transaction insert",
    (adapter, table) =>
      adapter.transaction(tx =>
        tx.insert(table, { id: "a", title: "A" }, { returning: ["id"] })
      ),
  ],
  [
    "transaction insert without RETURNING",
    (adapter, table) =>
      adapter.transaction(tx =>
        tx.insert(table, { id: "a", title: "A" }, { returning: [] })
      ),
  ],
  [
    "transaction insertMany of one row",
    (adapter, table) =>
      adapter.transaction(tx =>
        tx.insertMany(table, [{ id: "a", title: "A" }], { returning: "*" })
      ),
  ],
  [
    "transaction insertMany of two rows",
    (adapter, table) =>
      adapter.transaction(tx =>
        tx.insertMany(
          table,
          [
            { id: "a", title: "A" },
            { id: "b", title: "B" },
          ],
          { returning: "*" }
        )
      ),
  ],
  [
    "pooled insertMany of two rows",
    (adapter, table) =>
      adapter.insertMany(
        table,
        [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
        { returning: "*" }
      ),
  ],
  [
    "pooled insert",
    (adapter, table) =>
      adapter.insert(table, { id: "a", title: "A" }, { returning: ["id"] }),
  ],
];

const canConnect = async (url: string): Promise<boolean> => {
  // Bounded, as the other MySQL suites probe: mysql2 has no simple connect
  // timeout when given a URL string.
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

// Gated on a reachable server, as the suite needs one: unset or unreachable
// TEST_MYSQL_URL skips the whole suite rather than failing it.
const available = TEST_DB_URL ? await canConnect(TEST_DB_URL) : false;

describe.skipIf(!available)(
  "MySQL insert into a table the resolver does not hold",
  () => {
    let adapter: MySqlAdapter;

    const count = async (table: string): Promise<number> => {
      const rows = await adapter.executeQuery<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table}`
      );
      return Number(rows[0]?.n);
    };

    beforeAll(async () => {
      adapter = createMySqlAdapter({ url: TEST_DB_URL as string });
      await adapter.connect();
      for (const table of [KNOWN, UNKNOWN]) {
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${table}`);
        await adapter.createTable(definition(table));
      }
      adapter.setTableResolver({
        getTable: (name: string) => (name === KNOWN ? known : null),
      });
    });

    beforeEach(async () => {
      await adapter.executeQuery(`DELETE FROM ${KNOWN}`);
      await adapter.executeQuery(`DELETE FROM ${UNKNOWN}`);
    });

    afterAll(async () => {
      for (const table of [KNOWN, UNKNOWN]) {
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${table}`);
      }
      await adapter.disconnect();
    });

    it.each(ROADS)(
      "%s is refused, naming the table, and writes nothing",
      async (_road, insert) => {
        const refusal = await insert(adapter, UNKNOWN).then(
          () => undefined,
          (error: unknown) => error
        );
        expect(refusal).toMatchObject({ code: TABLE_NOT_REGISTERED_CODE });
        expect((refusal as Error).message).toContain(`"${UNKNOWN}"`);
        expect(await count(UNKNOWN)).toBe(0);
      }
    );

    it.each(ROADS)(
      "%s still writes a table the resolver holds",
      async (_road, insert) => {
        await insert(adapter, KNOWN);
        expect(await count(KNOWN)).toBeGreaterThan(0);
      }
    );

    it("refuses before any statement, so the transaction can go on and commit", async () => {
      await adapter.transaction(async tx => {
        const refusal = await tx.insert(UNKNOWN, { id: "a", title: "A" }).then(
          () => undefined,
          (error: unknown) => error
        );
        expect(refusal).toMatchObject({ code: TABLE_NOT_REGISTERED_CODE });
        await tx.insert(KNOWN, { id: "b", title: "B" }, { returning: [] });
      });
      expect(await count(KNOWN)).toBe(1);
      expect(await count(UNKNOWN)).toBe(0);
    });
  }
);
