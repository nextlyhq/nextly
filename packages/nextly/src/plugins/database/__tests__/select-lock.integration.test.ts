/**
 * `ctx.db.select(...).lock(mode)`, on every dialect.
 *
 * What separates a locking read from a plain one is what a second
 * transaction sees while the first is open: on PostgreSQL and MySQL a write
 * to a row read `update` waits for the reader's transaction to end, and on
 * MySQL a locking read sees a row committed after the transaction's first
 * read, which a plain read there does not. SQLite runs one writer at a time,
 * so there the read must only answer as a plain read does.
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
        name: "@test/select-lock",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { schema: { prefix: "lck", tables: [counters] } },
        init(ctx) {
          captured = ctx;
        },
      }),
    ],
  });
  if (captured === undefined) throw new Error("the plugin did not initialise");
  return captured;
}

/** A promise settled from outside, and whether it has settled. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>(resolve => {
    open = resolve;
  });
  return { open, opened };
}

describeEachDialect("a locking read in ctx.db.select", dialect => {
  it("reads the rows a plain read reads", async () => {
    const ctx = await boot(dialect);
    await ctx.db.insert(counters, [
      { name: "a", hits: 1 },
      { name: "b", hits: 2 },
    ]);

    const read = await ctx.db.transaction(tx =>
      tx
        .select(counters)
        .where(eq(tx.table(counters).name, "b"))
        .lock("update")
        .all()
    );

    expect(read.map(row => [row.name, row.hits])).toEqual([["b", 2]]);
  });

  it("is refused in a snapshot transaction, which is read-only", async () => {
    const ctx = await boot(dialect);

    await expect(
      ctx.db.transaction(tx => tx.select(counters).lock("share").all(), {
        isolation: "snapshot",
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  if (dialect === "sqlite") return;

  it("keeps another transaction's write waiting until the reader's ends", async () => {
    const ctx = await boot(dialect);
    await ctx.db.insert(counters, { name: "page", hits: 0 });
    const named = eq(ctx.db.table(counters).name, "page");
    const held = gate();
    const release = gate();
    const order: string[] = [];

    const reader = ctx.db.transaction(async tx => {
      await tx
        .select(counters)
        .where(eq(tx.table(counters).name, "page"))
        .lock("update")
        .all();
      held.open();
      await release.opened;
      order.push("reader ends");
    });
    await held.opened;
    const writer = ctx.db
      .update(counters, { hits: increment(1) })
      .where(named)
      .then(() => order.push("write lands"));
    // Long enough for an unlocked write to land first.
    await new Promise(resolve => setTimeout(resolve, 300));
    release.open();
    await Promise.all([reader, writer]);

    expect(order).toEqual(["reader ends", "write lands"]);
  });

  it("sees a row committed after the transaction's first read", async () => {
    // A plain read on MySQL would answer from the snapshot the first read
    // took, and miss the row.
    const ctx = await boot(dialect);
    await ctx.db.insert(counters, { name: "first", hits: 0 });

    const firstRead = gate();
    const committed = gate();
    const reading = ctx.db.transaction(async tx => {
      await tx.select(counters).all();
      firstRead.open();
      await committed.opened;
      const plain = await tx.select(counters).all();
      const locked = await tx.select(counters).lock("share").all();
      return { plain: plain.length, locked: locked.length };
    });
    // Committed by another flow, on a connection of its own.
    await firstRead.opened;
    await ctx.db.insert(counters, { name: "later", hits: 1 });
    committed.open();
    const seen = await reading;

    expect(seen.locked).toBe(2);
    // What the lock is for: on MySQL a plain read misses the row.
    if (dialect === "mysql") expect(seen.plain).toBe(1);
  });
});
