// A transaction's `update` is built by the adapter, as its `insert` is, so it
// reaches the columns the PHYSICAL table has. The pooled `update` goes through
// the Drizzle query builder, which writes only the columns the runtime MODEL
// declares and drops the rest without a word. The localization transition
// window depends on the difference: `localized` has been flipped, the model has
// moved a translatable column to a companion table that does not exist yet,
// and the default locale must keep writing the column the main table still
// has. The table here has `title` and `published_at` and the model declares
// neither, which is that window in miniature.
//
// Every stored value is read back with a raw SELECT rather than through the
// model, since the model cannot see the column whose write is in question.
//
// Self-skips when TEST_MYSQL_URL is unset or unreachable.

import {
  boolean,
  datetime,
  json,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createMySqlAdapter, type MySqlAdapter } from "../index";

const TABLE = "int_txmysql_update_table";
const TEST_DB_URL = process.env.TEST_MYSQL_URL;

// The runtime model: `title` and `published_at` are deliberately absent.
const pages = mysqlTable(TABLE, {
  id: varchar("id", { length: 36 }).primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull(),
  meta: json("meta"),
  updatedAt: datetime("updated_at"),
  published: boolean("published"),
});

const byId = (id: string) => ({
  and: [{ column: "id", op: "=" as const, value: id }],
});

/**
 * The two timestamps come back as text spelled by the database. mysql2 turns
 * a `datetime` into a `Date` in the runner's LOCAL zone, so a `Date` read
 * here would move with the machine; the wall clock as text does not.
 */
interface StoredRow {
  id: string;
  slug: string;
  title: string | null;
  meta: unknown;
  published_at: string | null;
  updated_at: string | null;
  published: number | null;
}

const WALL_CLOCK = "2026-09-11T10:00:00";
const AT = new Date(`${WALL_CLOCK}.000Z`);

const canConnect = async (url: string): Promise<boolean> => {
  // Bound the probe so an unreachable TEST_MYSQL_URL cannot hang the suite for
  // the OS-level connect timeout; mysql2 has no simple connect timeout when
  // given a URL string, so race the attempt against a short timer.
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

describe("MySQL transaction update writes the physical table", async () => {
  const available = TEST_DB_URL ? await canConnect(TEST_DB_URL) : false;

  if (!available) {
    it.skip("Skipping: TEST_MYSQL_URL not set or unreachable", () => {});
    return;
  }

  let adapter: MySqlAdapter;

  const stored = async (id: string): Promise<StoredRow | undefined> => {
    const rows = await adapter.executeQuery<StoredRow>(
      `SELECT id, slug, title, meta, DATE_FORMAT(published_at, '%Y-%m-%dT%H:%i:%s') AS published_at, DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s') AS updated_at, published FROM ${TABLE} WHERE id = ?`,
      [id]
    );
    return rows[0];
  };

  beforeAll(async () => {
    adapter = createMySqlAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.executeQuery(
      `CREATE TABLE ${TABLE} (id varchar(36) PRIMARY KEY, slug varchar(255) NOT NULL, title varchar(255), meta json, published_at datetime, updated_at datetime, published boolean)`
    );
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? pages : null),
    });
  });

  beforeEach(async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
    await adapter.executeQuery(
      `INSERT INTO ${TABLE} (id, slug, title, published) VALUES ('a', 'first', 'First', false)`
    );
  });

  afterAll(async () => {
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.disconnect();
  });

  it("writes a column the model does not declare; the pooled builder update drops it", async () => {
    // The control first, and it must come out DIFFERENT: the same write
    // through the query builder stores the declared column and leaves the
    // undeclared one as it was, without a word — the silence this path
    // exists to replace. A declared column rides along in both writes
    // because that is the shape of every entry update (`updated_at` is
    // always in it).
    await adapter.update(
      TABLE,
      { slug: "pooled", title: "Dropped" },
      byId("a")
    );
    expect(await stored("a")).toMatchObject({ slug: "pooled", title: "First" });

    await adapter.transaction(async ctx => {
      await ctx.update(TABLE, { slug: "tx", title: "Written" }, byId("a"));
    });
    expect(await stored("a")).toMatchObject({ slug: "tx", title: "Written" });
  });

  it("binds a declared date, JSON document and boolean as the query builder would, and an undeclared date as the insert does", async () => {
    const document = { a: 1, b: [true, null] };
    await adapter.transaction(async ctx => {
      await ctx.update(
        TABLE,
        {
          updated_at: AT,
          meta: JSON.stringify(document),
          published: true,
          published_at: AT,
        },
        byId("a")
      );
    });
    const row = await stored("a");
    // The declared column stores the UTC wall clock its encoder wrote.
    expect(row?.updated_at).toBe(WALL_CLOCK);
    // Encoded once: a serialized document is stored as the document, not as
    // a JSON string containing one.
    expect(row?.meta).toEqual(document);
    expect(row?.published).toBe(1);
    // The undeclared column is bound as the transactional insert binds a
    // column the model does not know: natively, by the driver. The adapter
    // cannot encode a column it cannot see, so this pins that it stores
    // something for it rather than which zone the driver chose.
    expect(row?.published_at).not.toBeNull();
  });

  it("leaves a column alone for undefined and clears it for null", async () => {
    await adapter.transaction(async ctx => {
      await ctx.update(TABLE, { slug: "second", title: undefined }, byId("a"));
    });
    expect(await stored("a")).toMatchObject({ slug: "second", title: "First" });

    await adapter.transaction(async ctx => {
      await ctx.update(TABLE, { title: null }, byId("a"));
    });
    expect((await stored("a"))?.title).toBeNull();
  });

  it("refuses a column the table does not have, rather than dropping it", async () => {
    await expect(
      adapter.transaction(async ctx => {
        await ctx.update(TABLE, { slug: "x", ghost: "x" }, byId("a"));
      })
    ).rejects.toThrow(/ghost/);
    // The refused statement wrote nothing else either.
    expect((await stored("a"))?.slug).toBe("first");
  });

  it("selects the updated rows back when asked, and returns nothing when not", async () => {
    const [none, requested] = await adapter.transaction(async ctx => [
      await ctx.update(TABLE, { slug: "n" }, byId("a")),
      await ctx.update<{ id: string; slug: string; updatedAt: Date }>(
        TABLE,
        { slug: "r", updated_at: AT },
        byId("a"),
        { returning: "*" }
      ),
    ]);
    expect(none).toEqual([]);
    // MySQL has no RETURNING, so the rows come from a select-back on the
    // transaction's own executor: the model's view of the row, decoded as a
    // read decodes it, and read inside the transaction so it sees the write.
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({ id: "a", slug: "r" });
    expect(requested[0].updatedAt).toBeInstanceOf(Date);
  });

  it("runs inside the transaction: a rolled-back update leaves the row untouched", async () => {
    await expect(
      adapter.transaction(async ctx => {
        await ctx.update(TABLE, { title: "Uncommitted" }, byId("a"));
        throw new Error("roll it back");
      })
    ).rejects.toThrow("roll it back");
    expect((await stored("a"))?.title).toBe("First");
  });
});
