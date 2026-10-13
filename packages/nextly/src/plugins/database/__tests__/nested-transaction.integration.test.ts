/**
 * The handle `ctx.db.transaction` passes its work refuses a nested
 * `transaction`, on every dialect.
 *
 * `PluginTransaction` leaves `transaction` out of the type, but a plugin
 * written in JavaScript can still call it. On PostgreSQL and MySQL the call
 * used to open a second transaction on another pooled connection: its work
 * committed on its own, outside the outer transaction and blind to that
 * transaction's uncommitted writes. Only a real connection pool shows that,
 * so this boots a plugin per dialect and writes into its own table.
 */
import { afterEach, describe, expect, it } from "vitest";

import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { NextlyError } from "../../../errors/nextly-error";
import { definePlugin, type PluginContext } from "../../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../test-nextly";
import type { PluginDatabase } from "../plugin-database";

const marks = defineTable("marks", { id: col.id(), key: col.shortText() });

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a nested transaction on the handle ctx.db.transaction passes (%s)",
  dialect => {
    async function boot(): Promise<PluginContext> {
      let captured: PluginContext | undefined;
      current = await createTestNextly({
        dialect,
        plugins: [
          definePlugin({
            name: "@test/nested-tx",
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: { schema: { prefix: "ntx", tables: [marks] } },
            init(ctx) {
              captured = ctx;
            },
          }),
        ],
      });
      if (!captured) throw new Error("the plugin's init did not run");
      return captured;
    }

    it("is refused, runs none of its work, and leaves the outer one whole", async () => {
      const ctx = await boot();
      let nestedRan = false;

      const caught = await ctx.db.transaction(async tx => {
        await tx.insert(marks, { key: "outer" });
        // The call a JavaScript plugin can make: the method exists on the
        // object even though the type omits it.
        return (tx as unknown as PluginDatabase)
          .transaction(async inner => {
            nestedRan = true;
            await inner.insert(marks, { key: "nested" });
          })
          .catch((error: unknown) => error);
      });

      expect(caught).toBeInstanceOf(NextlyError);
      expect((caught as NextlyError).logContext).toMatchObject({
        reason: "nested-plugin-transaction",
      });
      expect(nestedRan).toBe(false);
      const stored = (await ctx.db.select(marks).all()).map(row => row.key);
      expect(stored).toEqual(["outer"]);
    });
  }
);
