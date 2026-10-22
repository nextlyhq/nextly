// A transaction opened with `strictSqlMode` runs in MySQL strict mode whatever the session's own
// mode is, and hands its connection back to the pool with that mode put back. Without strict mode
// MySQL cuts an overlong string to the column's length with only a warning; a migration runs with
// nobody there to read it.
//
// A pool of one connection makes "the session" observable: the mode set before the transaction,
// the one inside it and the one after it are all read from the same connection, which stands for a
// server configured without strict mode.
//
// Self-skips when TEST_MYSQL_URL is unset.

import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMySqlAdapter, type MySqlAdapter } from "../index";

const TABLE = "int_txmysql_strict";
const TEST_DB_URL = process.env.TEST_MYSQL_URL;

const canConnect = async (url: string): Promise<boolean> => {
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

describe("MySQL transaction strictSqlMode", async () => {
  const available = TEST_DB_URL ? await canConnect(TEST_DB_URL) : false;

  if (!available) {
    it.skip("Skipping: TEST_MYSQL_URL not set or unreachable", () => {});
    return;
  }

  let adapter: MySqlAdapter;

  const sessionMode = async (): Promise<string> => {
    const [row] = await adapter.executeQuery<{ mode: string }>(
      "SELECT @@SESSION.sql_mode AS mode"
    );
    return row.mode;
  };

  const stored = async (): Promise<string[]> =>
    (
      await adapter.executeQuery<{ v: string }>(
        `SELECT v FROM ${TABLE} ORDER BY v`
      )
    ).map(r => r.v);

  beforeAll(async () => {
    adapter = createMySqlAdapter({ url: TEST_DB_URL, pool: { max: 1 } });
    await adapter.connect();
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.executeQuery(`CREATE TABLE ${TABLE} (v TEXT)`);
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.disconnect();
  });

  it("refuses a narrowing that would cut a value short, and restores the session's mode", async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
    await adapter.executeQuery(`ALTER TABLE ${TABLE} MODIFY COLUMN v TEXT`);
    await adapter.executeQuery(`INSERT INTO ${TABLE} (v) VALUES ('abcdefgh')`);
    await adapter.executeQuery("SET SESSION sql_mode = ''");

    await expect(
      adapter.transaction(
        async ctx => {
          await ctx.execute(`ALTER TABLE ${TABLE} MODIFY COLUMN v varchar(5)`);
        },
        { strictSqlMode: true }
      )
    ).rejects.toThrow(/Data too long/);

    expect(await stored()).toEqual(["abcdefgh"]);
    expect(await sessionMode()).toBe("");
  });

  it("keeps every flag the session had, and puts the mode back after a commit", async () => {
    await adapter.executeQuery("SET SESSION sql_mode = 'NO_ZERO_DATE'");
    let inside = "";
    await adapter.transaction(
      async ctx => {
        const [row] = await ctx.execute<{ mode: string }>(
          "SELECT @@SESSION.sql_mode AS mode"
        );
        inside = row.mode;
      },
      { strictSqlMode: true }
    );
    expect(inside.split(",").sort()).toEqual(
      ["NO_ZERO_DATE", "STRICT_ALL_TABLES"].sort()
    );
    expect(await sessionMode()).toBe("NO_ZERO_DATE");
  });

  it("leaves the session's mode alone without the option", async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
    await adapter.executeQuery(`ALTER TABLE ${TABLE} MODIFY COLUMN v TEXT`);
    await adapter.executeQuery(`INSERT INTO ${TABLE} (v) VALUES ('abcdefgh')`);
    await adapter.executeQuery("SET SESSION sql_mode = ''");

    await adapter.transaction(async ctx => {
      await ctx.execute(`ALTER TABLE ${TABLE} MODIFY COLUMN v varchar(5)`);
    });

    // The control: the same narrowing, unguarded, cuts the value — so the refusal above is the
    // option's doing, not the server's.
    expect(await stored()).toEqual(["abcde"]);
  });
});
