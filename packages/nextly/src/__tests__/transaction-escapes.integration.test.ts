/**
 * The escape guard (`./transaction-escapes`) sees a statement that leaves its
 * transaction, and only such a statement.
 *
 * Each case drains the guard itself, so what it saw is asserted here rather
 * than failing the test from the setup file. Every escape is the same kind of
 * defect, one statement on another pooled connection while the flow's
 * transaction is open, reached by the routes product code has to the pool:
 * the adapter's own query, the Drizzle handle's query, and a transaction
 * opened inside another. The controls run the same work through the
 * transaction and must report nothing.
 */
import { afterAll, beforeAll, expect, it } from "vitest";

import { describeEachDialect } from "../plugins/__tests__/helpers/dialect-matrix";
import { createTestNextly, type TestNextly } from "../plugins/test-nextly";

import { OPENED_BY, takeTransactionEscapes } from "./transaction-escapes";

describeEachDialect("the transaction escape guard", dialect => {
  let current: TestNextly;
  // SQLite has one connection: nothing can run beside a transaction there.
  const pooled = dialect !== "sqlite";

  beforeAll(async () => {
    current = await createTestNextly({ dialect });
    takeTransactionEscapes();
  });

  afterAll(async () => {
    await current.destroy();
  });

  it("reports the adapter's own query made inside a transaction, naming this file", async () => {
    await current.adapter.transaction(async () => {
      await current.adapter.executeQuery("SELECT 1");
    });

    const escapes = takeTransactionEscapes();
    expect(escapes).toHaveLength(pooled ? 1 : 0);
    if (pooled) {
      expect(escapes[0].site).toContain("transaction-escapes.integration.test");
      // Awaited as a promise, the statement's own caller is on its stack.
      expect(escapes[0].key).toMatch(
        /^packages\/nextly\/src\/__tests__\/transaction-escapes\.integration\.test\.ts#/
      );
      expect(escapes[0].key).not.toContain(OPENED_BY);
    }
  });

  // SQLite's Drizzle handle runs synchronous statements and has no pool.
  it.runIf(pooled)(
    "reports a query through the pool-bound Drizzle handle made inside a transaction",
    async () => {
      const db = current.adapter.getDrizzle<{
        execute(query: string): Promise<unknown>;
      }>();

      await current.adapter.transaction(async () => {
        await db.execute("SELECT 1");
      });

      // A query builder is awaited as a thenable, and V8 links no caller
      // across that, so the escape is traced to where its transaction was
      // opened, here, rather than reported with no site at all.
      const escapes = takeTransactionEscapes();
      expect(escapes).toHaveLength(1);
      expect(escapes[0].key).toBe(
        `packages/nextly/src/__tests__/transaction-escapes.integration.test.ts#<anonymous>${OPENED_BY} · select`
      );
    }
  );

  it("reports a transaction opened inside another's work", async () => {
    await current.adapter.transaction(async () => {
      await current.adapter.transaction(ctx => ctx.execute("SELECT 1"));
    });

    expect(takeTransactionEscapes()).toHaveLength(pooled ? 1 : 0);
  });

  it("reports nothing when the same work runs through the transaction", async () => {
    await current.adapter.transaction(async ctx => {
      await ctx.execute("SELECT 1");
      if (pooled) {
        await ctx
          .getDrizzle<{ execute(query: string): Promise<unknown> }>()
          .execute("SELECT 1");
      }
    });

    expect(takeTransactionEscapes()).toEqual([]);
  });

  it("reports nothing for queries made outside any transaction", async () => {
    await current.adapter.executeQuery("SELECT 1");
    await current.adapter.transaction(ctx => ctx.execute("SELECT 1"));
    await current.adapter.executeQuery("SELECT 1");

    expect(takeTransactionEscapes()).toEqual([]);
  });
});
