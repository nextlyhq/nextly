// Verifies that the TransactionContext's Drizzle-path CRUD (select/selectOne)
// runs inside the open transaction and observes rows written earlier in the
// same uncommitted transaction. Postgres is pool-based: before the fix the
// delegated select/selectOne ran on the pool (a different connection) and could
// NOT see the transaction's uncommitted rows, so these assertions failed.
//
// Self-skips when TEST_POSTGRES_URL is unset.

import { pgTable, text } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresAdapter, type PostgresAdapter } from "../index";

const TABLE = "int_txpg_ryw";
const TEST_DB_URL = process.env.TEST_POSTGRES_URL;

// Drizzle table definition backing the resolver so the adapter's Drizzle CRUD
// path (used by ctx.select / ctx.selectOne) can resolve this table.
const posts = pgTable(TABLE, {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
});

const canConnect = async (url: string): Promise<boolean> => {
  const client = new pg.Client({ connectionString: url });
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

describe("PostgreSQL transaction read-your-writes", async () => {
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
      `CREATE TABLE ${TABLE} (id text PRIMARY KEY, slug text NOT NULL UNIQUE)`
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
