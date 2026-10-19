// The where builder's text operators against a real MySQL server, on a column
// whose collation is case-SENSITIVE (`utf8mb4_bin`). A bare LIKE inherits the
// column's collation, so this is the setting that shows whether a
// "case-insensitive" operator really ignores case or only does so under the
// default `utf8mb4_0900_ai_ci`.
//
// Self-skips when TEST_MYSQL_URL is unset.

import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMySqlAdapter, type MySqlAdapter } from "../index";

import type { WhereCondition } from "@nextlyhq/adapter-drizzle/types";

const TABLE = "int_mysql_text_match";
const TEST_DB_URL = process.env.TEST_MYSQL_URL;

const releases = mysqlTable(TABLE, {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: varchar("title", { length: 100 }).notNull(),
});

const TITLES = ["Spring launch", "50% off", "a_b", "AXB"];

const canConnect = async (url: string): Promise<boolean> => {
  // Bounded, so an unreachable TEST_MYSQL_URL cannot hang the suite.
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

describe("MySQL text matching under a case-sensitive collation", async () => {
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
      `CREATE TABLE ${TABLE} (id varchar(36) PRIMARY KEY, title varchar(100) COLLATE utf8mb4_bin NOT NULL)`
    );
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? releases : null),
    });
    for (const [index, title] of TITLES.entries()) {
      await adapter.insert(TABLE, { id: String(index), title });
    }
  });

  afterAll(async () => {
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.disconnect();
  });

  async function titlesWhere(condition: WhereCondition): Promise<string[]> {
    const rows = await adapter.select<{ title: string }>(TABLE, {
      where: { and: [condition] },
    });
    return rows.map(row => row.title).sort();
  }

  it("the column really compares case-sensitively, so the cases below can tell", async () => {
    // The positive control: CONTAINS follows the column's collation, and under
    // utf8mb4_bin a different case is a different string.
    expect(
      await titlesWhere({ column: "title", op: "CONTAINS", value: "spring" })
    ).toEqual([]);
    expect(
      await titlesWhere({ column: "title", op: "CONTAINS", value: "Spring" })
    ).toEqual(["Spring launch"]);
  });

  it("ICONTAINS ignores case whatever the collation", async () => {
    expect(
      await titlesWhere({ column: "title", op: "ICONTAINS", value: "spring" })
    ).toEqual(["Spring launch"]);
    expect(
      await titlesWhere({ column: "title", op: "ICONTAINS", value: "LAUNCH" })
    ).toEqual(["Spring launch"]);
  });

  it("ICONTAINS matches % and _ as characters, not wildcards", async () => {
    expect(
      await titlesWhere({ column: "title", op: "ICONTAINS", value: "50%" })
    ).toEqual(["50% off"]);
    // As a wildcard, `_` would also match "AXB".
    expect(
      await titlesWhere({ column: "title", op: "ICONTAINS", value: "A_B" })
    ).toEqual(["a_b"]);
  });

  it("ILIKE runs on MySQL and ignores case whatever the collation", async () => {
    expect(
      await titlesWhere({ column: "title", op: "ILIKE", value: "%SPRING%" })
    ).toEqual(["Spring launch"]);
    // A pattern operator: the caller's `_` is a wildcard here.
    expect(
      await titlesWhere({ column: "title", op: "ILIKE", value: "a_b" })
    ).toEqual(["AXB", "a_b"]);
  });
});
