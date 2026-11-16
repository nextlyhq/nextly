/**
 * `ctx.db.update` with `increment(n)`, on every dialect.
 *
 * What separates an add made by the database from a value read and written
 * back is concurrency: one at a time both give the same count, and updates
 * that overlap lose counts when the value is computed in the process. So the
 * updates here overlap, on the pool, and every one must count.
 */
import { eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";

import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { describeEachDialect } from "../../__tests__/helpers/dialect-matrix";
import { definePlugin, type PluginContext } from "../../plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../test-nextly";
import { increment } from "../increment";

const counters = defineTable(
  "counters",
  {
    id: col.id(),
    name: col.varchar(64),
    hits: col.integer(),
  },
  { indexes: [{ columns: ["name"], unique: true }] }
);

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Boot a plugin owning `counters`, and hand back its context. */
async function boot(dialect: TestDialect): Promise<PluginContext> {
  let captured: PluginContext | undefined;
  current = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "@test/increment",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { schema: { prefix: "inc", tables: [counters] } },
        init(ctx) {
          captured = ctx;
        },
      }),
    ],
  });
  if (captured === undefined) throw new Error("the plugin did not initialise");
  return captured;
}

async function hitsOf(ctx: PluginContext, name: string) {
  const row = await ctx.db
    .select(counters)
    .where(eq(ctx.db.table(counters).name, name))
    .first();
  return row?.hits;
}

describeEachDialect("increment in ctx.db.update", dialect => {
  it("counts every one of many updates made at once", async () => {
    const ctx = await boot(dialect);
    await ctx.db.insert(counters, { name: "page", hits: 0 });
    const named = eq(ctx.db.table(counters).name, "page");

    const changed = await Promise.all(
      Array.from({ length: 20 }, () =>
        ctx.db.update(counters, { hits: increment(1) }).where(named)
      )
    );

    expect(changed).toEqual(Array.from({ length: 20 }, () => 1));
    expect(await hitsOf(ctx, "page")).toBe(20);
  });

  it("adds the amount given, and subtracts a negative one", async () => {
    const ctx = await boot(dialect);
    await ctx.db.insert(counters, { name: "page", hits: 10 });
    const named = eq(ctx.db.table(counters).name, "page");

    await ctx.db.update(counters, { hits: increment(5) }).where(named);
    await ctx.db.update(counters, { hits: increment(-3) }).where(named);

    expect(await hitsOf(ctx, "page")).toBe(12);
  });

  it("changes no row where none matches, and says so", async () => {
    // What a counter's first count reads to know it must insert the row.
    const ctx = await boot(dialect);

    const changed = await ctx.db
      .update(counters, { hits: increment(1) })
      .where(eq(ctx.db.table(counters).name, "missing"));

    expect(changed).toBe(0);
    expect(await hitsOf(ctx, "missing")).toBeUndefined();
  });

  it("adds inside a transaction, on the transaction's own connection", async () => {
    const ctx = await boot(dialect);
    await ctx.db.insert(counters, { name: "page", hits: 1 });

    await ctx.db.transaction(async tx => {
      await tx
        .update(counters, { hits: increment(2) })
        .where(eq(tx.table(counters).name, "page"));
    });

    expect(await hitsOf(ctx, "page")).toBe(3);
  });
});
