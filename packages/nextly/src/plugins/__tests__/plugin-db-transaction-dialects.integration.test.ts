/**
 * A plugin's transaction on every dialect, through the typed `ctx.db` and
 * through `ctx.db.raw`.
 *
 * The handle the work receives must be bound to the transaction's own
 * connection: on PostgreSQL and MySQL the pooled handle is a different
 * connection, so a write through it commits on its own and a later throw
 * leaves it behind, and a read through it cannot see the transaction's writes.
 * What the work throws must reach the plugin as the same instance, as
 * Drizzle's own transaction hands it back.
 */
import { eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";

import { col, defineTable } from "../../domains/schema/extension/dsl";
import { definePlugin, type PluginContext } from "../plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

import { describeEachDialect } from "./helpers/dialect-matrix";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const marks = defineTable("marks", { id: col.id(), key: col.shortText() });

async function boot(dialect: TestDialect): Promise<PluginContext> {
  let captured: PluginContext | undefined;
  current = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "@test/tx-dialects",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { schema: { prefix: "txd", tables: [marks] } },
        init(ctx) {
          captured = ctx;
        },
      }),
    ],
  });
  if (!captured) throw new Error("the plugin's init did not run");
  return captured;
}

/** The keys in the plugin's table, read through `ctx.db` outside any transaction. */
async function stored(ctx: PluginContext): Promise<string[]> {
  return (await ctx.db.select(marks).all()).map(row => row.key).sort();
}

/**
 * A plugin's own error class, as a route might throw to answer with a status.
 * Not a `NextlyError`, which the adapters already let through.
 */
class PluginRefusal extends Error {
  readonly status = 409;
}

describeEachDialect("the typed ctx.db.transaction", dialect => {
  it("commits every write, and rolls every write back on a throw", async () => {
    const ctx = await boot(dialect);

    await ctx.db.transaction(async tx => {
      await tx.insert(marks, { key: "a" });
      await tx.insert(marks, { key: "b" });
    });
    await ctx.db
      .transaction(async tx => {
        await tx.insert(marks, { key: "c" });
        throw new Error("later step failed");
      })
      .catch(() => undefined);

    expect(await stored(ctx)).toEqual(["a", "b"]);
  });

  it("hands the work a handle on the transaction's own connection", async () => {
    const ctx = await boot(dialect);
    let inside: string[] = [];
    let outside: string[] = [];

    await ctx.db.transaction(async tx => {
      await tx.insert(marks, { key: "a" });
      inside = (await tx.select(marks).all()).map(row => row.key);
      // SQLite has one connection, which the transaction holds, so a read
      // through the outer handle would run inside it and wait for nothing.
      if (dialect !== "sqlite") outside = await stored(ctx);
    });

    expect(inside).toEqual(["a"]);
    // Another connection does not see an uncommitted write.
    expect(outside).toEqual([]);
    expect(await stored(ctx)).toEqual(["a"]);
  });

  it("hands the plugin what the work threw, as the same instance", async () => {
    const ctx = await boot(dialect);
    const refusal = new PluginRefusal("already linked");

    const caught = await ctx.db
      .transaction(async tx => {
        await tx.insert(marks, { key: "a" });
        throw refusal;
      })
      .catch((error: unknown) => error);

    expect(caught).toBe(refusal);
    expect(await stored(ctx)).toEqual([]);
  });
});

describeEachDialect("ctx.db.raw.transaction", dialect => {
  it("hands the work a handle on the transaction's own connection", async () => {
    const ctx = await boot(dialect);
    // The Drizzle table behind the plugin's own, as `ctx.db` resolves it.
    const columns = ctx.db.table(marks);
    let inside = 0;

    await ctx.db.raw
      .transaction(async tx => {
        await tx.insert(columns).values({ id: "01", key: "a" });
        inside = (
          await tx
            .select({ key: columns.key } as never)
            .from(columns)
            .where(eq(columns.key, "a"))
        ).length;
        throw new Error("roll back");
      })
      .catch(() => undefined);

    expect(inside).toBe(1);
    expect(await stored(ctx)).toEqual([]);
  });

  it("hands the plugin what the work threw, as the same instance", async () => {
    const ctx = await boot(dialect);
    const refusal = new PluginRefusal("already linked");

    const caught = await ctx.db.raw
      .transaction(() => Promise.reject(refusal))
      .catch((error: unknown) => error);

    expect(caught).toBe(refusal);
  });
});
