// The where builder's text operators against a real PostgreSQL server. Its
// default collation is deterministic, so LIKE compares case-sensitively and a
// "case-insensitive" operator has to ignore case by itself.
//
// Self-skips when TEST_POSTGRES_URL is unset.

import { pgTable, text } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresAdapter, type PostgresAdapter } from "../index";

import type { WhereCondition } from "@nextlyhq/adapter-drizzle/types";

const TABLE = "int_pg_text_match";
const TEST_DB_URL = process.env.TEST_POSTGRES_URL;

const releases = pgTable(TABLE, {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
});

const TITLES = ["Spring launch", "50% off", "a_b", "AXB"];

const canConnect = async (url: string): Promise<boolean> => {
  // Bounded connect so an unreachable TEST_POSTGRES_URL cannot hang the suite.
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
};

describe("PostgreSQL text matching", async () => {
  const available = TEST_DB_URL ? await canConnect(TEST_DB_URL) : false;

  if (!available) {
    it.skip("Skipping: TEST_POSTGRES_URL not set or unreachable", () => {});
    return;
  }

  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = createPostgresAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.executeQuery(
      `CREATE TABLE ${TABLE} (id text PRIMARY KEY, title text NOT NULL)`
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
    expect(
      await titlesWhere({ column: "title", op: "CONTAINS", value: "spring" })
    ).toEqual([]);
    expect(
      await titlesWhere({ column: "title", op: "CONTAINS", value: "Spring" })
    ).toEqual(["Spring launch"]);
  });

  it("ICONTAINS ignores case", async () => {
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

  it("ILIKE ignores case, its pattern's wildcards intact", async () => {
    expect(
      await titlesWhere({ column: "title", op: "ILIKE", value: "%SPRING%" })
    ).toEqual(["Spring launch"]);
    expect(
      await titlesWhere({ column: "title", op: "ILIKE", value: "a_b" })
    ).toEqual(["AXB", "a_b"]);
  });
});
