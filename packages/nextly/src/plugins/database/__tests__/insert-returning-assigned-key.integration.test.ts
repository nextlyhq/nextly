/**
 * `ctx.db.insertReturning` on a table whose key the database assigns
 * (`col.serial()`), on every dialect.
 *
 * The key is chosen during the insert, so the row can only be read back by a
 * key the insert itself reports. The question that separates a correct read
 * from a plausible broken one is concurrency: "the row with the highest key",
 * or a second statement asking for the last id on a pooled connection, gives
 * the right answer one insert at a time and the wrong row when inserts
 * overlap. So the inserts here overlap, and each must get back its own row.
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

const tickets = defineTable("tickets", {
  seq: col.serial(),
  label: col.shortText(),
});

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Boot a plugin owning `tickets`, and hand back its context. */
async function boot(dialect: TestDialect): Promise<PluginContext> {
  let captured: PluginContext | undefined;
  current = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "@test/serial-returning",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { schema: { prefix: "srl", tables: [tickets] } },
        init(ctx) {
          captured = ctx;
        },
      }),
    ],
  });
  if (captured === undefined) throw new Error("the plugin did not initialise");
  return captured;
}

describeEachDialect(
  "insertReturning on a table whose key the database assigns",
  dialect => {
    it("returns the inserted row, with the key the database chose", async () => {
      const ctx = await boot(dialect);
      const row = await ctx.db.insertReturning(tickets, { label: "first" });

      expect(row.label).toBe("first");
      expect(Number.isInteger(row.seq)).toBe(true);
      // The key it returned is the row's: read by it, the row is this one.
      const stored = await ctx.db
        .select(tickets)
        .where(eq(ctx.db.table(tickets).seq, row.seq))
        .first();
      expect(stored?.label).toBe("first");
    });

    it("returns each of many overlapping inserts its own row", async () => {
      const ctx = await boot(dialect);
      const labels = Array.from({ length: 20 }, (_, at) => `t${String(at)}`);

      const rows = await Promise.all(
        labels.map(label => ctx.db.insertReturning(tickets, { label }))
      );

      // Each call got the row it inserted, not a neighbour's.
      expect(rows.map(row => row.label)).toEqual(labels);
      expect(new Set(rows.map(row => row.seq)).size).toBe(labels.length);
      // And each key holds that row in the database.
      for (const row of rows) {
        const stored = await ctx.db
          .select(tickets)
          .where(eq(ctx.db.table(tickets).seq, row.seq))
          .first();
        expect(stored?.label).toBe(row.label);
      }
    });
  }
);
