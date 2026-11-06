/**
 * `ctx.db.transaction(fn, { isolation: "snapshot" })` reads one moment, on
 * every dialect.
 *
 * A plugin that reads several facts to decide something (the usage indexes'
 * run and its progress) must see them as they stood together. At PostgreSQL's
 * default READ COMMITTED each statement sees whatever committed before it, so a
 * write committed between two reads shows up in the second. Only a real
 * connection pool shows whether it does, so this boots a plugin per dialect
 * and commits a row from another transaction between two reads of its table.
 *
 * The other transaction is started outside the snapshot's async flow, so on
 * SQLite it queues behind the snapshot as any other request's would, and on
 * PostgreSQL and MySQL it commits on a connection of its own while the
 * snapshot is still open.
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
import type { PluginTransactionOptions } from "../plugin-database";

const marks = defineTable("marks", { id: col.id(), key: col.shortText() });

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a snapshot transaction on ctx.db (%s)",
  dialect => {
    async function boot(): Promise<PluginContext> {
      let captured: PluginContext | undefined;
      current = await createTestNextly({
        dialect,
        plugins: [
          definePlugin({
            name: "@test/snapshot-tx",
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: { schema: { prefix: "stx", tables: [marks] } },
            init(ctx) {
              captured = ctx;
            },
          }),
        ],
      });
      if (!captured) throw new Error("the plugin's init did not run");
      return captured;
    }

    /**
     * Read the table twice inside one transaction opened with `options`,
     * while another transaction inserts a row between the two reads. Answers
     * the two counts, once the other write has landed.
     */
    async function readAroundAWrite(
      ctx: PluginContext,
      options: PluginTransactionOptions | undefined
    ): Promise<[number, number]> {
      await ctx.db.transaction(tx => tx.insert(marks, { key: "before" }));

      // Registered here, outside the transaction below, so the write runs in
      // this flow rather than the transaction's and cannot join it.
      let release!: () => void;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const write = gate.then(() =>
        ctx.db.transaction(tx => tx.insert(marks, { key: "between" }))
      );

      const counts = await ctx.db.transaction(async tx => {
        const first = (await tx.select(marks).all()).length;
        release();
        // SQLite runs one transaction at a time, so the write waits for this
        // one to end; elsewhere it commits now, on its own connection.
        if (dialect !== "sqlite") await write;
        const second = (await tx.select(marks).all()).length;
        return [first, second] as [number, number];
      }, options);
      await write;

      // The write did land, so a second read of 1 is the snapshot and not a
      // write that never happened.
      expect((await ctx.db.select(marks).all()).length).toBe(2);
      return counts;
    }

    it("does not see a row committed between its two reads", async () => {
      const ctx = await boot();
      expect(await readAroundAWrite(ctx, { isolation: "snapshot" })).toEqual([
        1, 1,
      ]);
    });

    it.runIf(dialect === "postgresql")(
      "CONTROL: an ordinary transaction on PostgreSQL does see it",
      async () => {
        // READ COMMITTED is PostgreSQL's default, so without the option the
        // second read sees the row. This is what makes the case above evidence
        // that the option changed the isolation, not that the write was late.
        const ctx = await boot();
        expect(await readAroundAWrite(ctx, undefined)).toEqual([1, 2]);
      }
    );

    it("refuses a write through its handle, and commits none", async () => {
      const ctx = await boot();
      const refused = await ctx.db
        .transaction(tx => tx.insert(marks, { key: "inside" }), {
          isolation: "snapshot",
        })
        .catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(NextlyError);
      expect((refused as NextlyError).logContext).toMatchObject({
        reason: "write-in-snapshot-transaction",
      });
      expect(await ctx.db.select(marks).all()).toEqual([]);
    });
  }
);
