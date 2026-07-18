// The TransactionContext's Drizzle-path CRUD (select/selectOne) runs inside the
// open transaction and observes rows written earlier in the same uncommitted
// transaction. On the pool-based MySQL adapter this requires the delegated
// reads to run on the transaction's checked-out connection, not the pool.
//
// Self-skips when TEST_MYSQL_URL is unset.

import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMySqlAdapter, type MySqlAdapter } from "../index";

const TABLE = "int_txmysql_ryw";
const TEST_DB_URL = process.env.TEST_MYSQL_URL;

// Drizzle table definition backing the resolver so the adapter's Drizzle CRUD
// path (used by ctx.select / ctx.selectOne) can resolve this table.
const posts = mysqlTable(TABLE, {
  id: varchar("id", { length: 36 }).primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull(),
});

const canConnect = async (url: string): Promise<boolean> => {
  // Bound the probe so an unreachable TEST_MYSQL_URL cannot hang the suite for
  // the OS-level connect timeout (often minutes); mysql2 has no simple connect
  // timeout when given a URL string, so race the attempt against a short timer.
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
  // Close the connection whenever it resolves, even if the timeout won the race
  // while createConnection was still pending — otherwise it would leak.
  void connPromise.then(conn => conn?.end().catch(() => {}));
  return ok;
};

describe("MySQL transaction read-your-writes", async () => {
  const available = TEST_DB_URL ? await canConnect(TEST_DB_URL) : false;

  if (!available) {
    it.skip("Skipping: TEST_MYSQL_URL not set or unreachable", () => {});
    return;
  }

  let adapter: MySqlAdapter;

  beforeAll(async () => {
    adapter = createMySqlAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.executeQuery(
      `CREATE TABLE ${TABLE} (id varchar(36) PRIMARY KEY, slug varchar(255) NOT NULL UNIQUE)`
    );
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? posts : null),
    });
  });

  afterAll(async () => {
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.disconnect();
  });

  it("selectOne sees a row inserted earlier in the same transaction", async () => {
    const found = await adapter.transaction(async ctx => {
      await ctx.insert(TABLE, { id: "a", slug: "hello" });
      return ctx.selectOne<{ slug: string }>(TABLE, {
        where: { and: [{ column: "slug", op: "=", value: "hello" }] },
      });
    });

    expect(found).not.toBeNull();
    expect(found?.slug).toBe("hello");
  });

  it("dedupes generated slugs within a single transaction", async () => {
    const chosen = await adapter.transaction(async ctx => {
      const results: string[] = [];
      for (const base of ["dup", "dup"]) {
        let candidate = base;
        let suffix = 2;
        while (
          await ctx.selectOne(TABLE, {
            where: { and: [{ column: "slug", op: "=", value: candidate }] },
          })
        ) {
          candidate = `${base}-${suffix++}`;
        }
        await ctx.insert(TABLE, { id: `id-${candidate}`, slug: candidate });
        results.push(candidate);
      }
      return results;
    });

    expect(chosen).toEqual(["dup", "dup-2"]);
  });
});
