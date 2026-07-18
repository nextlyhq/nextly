// Verifies that the TransactionContext's Drizzle-path CRUD (select/selectOne)
// runs inside the open transaction and observes rows written earlier in the
// same uncommitted transaction. SQLite is single-connection, so this has always
// worked here; the test locks that in and mirrors the pooled-adapter suites
// (Postgres/MySQL) where the same guarantee is the actual bug fix.

import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

const TABLE = "int_txsqlite_ryw";

// Drizzle table definition backing the resolver so the adapter's Drizzle CRUD
// path (used by ctx.select / ctx.selectOne) can resolve this table.
const posts = sqliteTable(TABLE, {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
});

describe("SQLite transaction read-your-writes", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    await adapter.executeQuery(
      `CREATE TABLE ${TABLE} (id text PRIMARY KEY, slug text NOT NULL UNIQUE)`
    );
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? posts : null),
    });
  });

  afterAll(async () => {
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
    // Mirrors the collection slug-dedupe path: each iteration must see the
    // pending row from the previous one, so two same-base slugs resolve to
    // `dup` and `dup-2` rather than both choosing `dup`.
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
