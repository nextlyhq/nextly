/**
 * Core code a plugin hands its transaction handle writes inside that
 * transaction, on every dialect.
 *
 * `ctx.db.transaction` gives its callback a restricted surface; the link
 * resolves that surface to the adapter transaction behind it, so a core write
 * made through it commits or rolls back with the plugin's own work. On
 * PostgreSQL and MySQL a write that missed the link would run on another
 * pooled connection and commit on its own, which only a real pool shows, so
 * this boots a plugin per dialect. Anything but a live handle is refused.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { definePlugin, type PluginContext } from "../../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../test-nextly";
import type { PluginTransaction } from "../plugin-database";
import { linkedTransaction } from "../plugin-transaction-link";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a core write through a plugin's transaction handle (%s)",
  dialect => {
    async function boot(): Promise<PluginContext> {
      let captured: PluginContext | undefined;
      current = await createTestNextly({
        dialect,
        plugins: [
          definePlugin({
            name: "@test/transaction-link",
            version: "1.0.0",
            nextly: ">=0.0.0",
            init(ctx) {
              captured = ctx;
            },
          }),
        ],
      });
      if (!captured) throw new Error("the plugin's init did not run");
      return captured;
    }

    /** Write one `nextly_meta` row through the link, as a core helper would. */
    function writeThrough(
      tx: PluginTransaction,
      key: string
    ): Promise<unknown> {
      return linkedTransaction(tx, "test.write").run(adapterTx =>
        adapterTx.insert("nextly_meta", {
          key,
          value: null,
          updatedAt: new Date(),
        })
      );
    }

    async function stored(key: string): Promise<boolean> {
      const adapter = current?.adapter as unknown as DrizzleAdapter;
      const rows = await adapter.select("nextly_meta", {
        where: { and: [{ column: "key", op: "=", value: key }] },
      });
      return rows.length > 0;
    }

    it("rolls back with the plugin's transaction", async () => {
      const ctx = await boot();
      const failure = new Error("the plugin's own work failed");
      await expect(
        ctx.db.transaction(async tx => {
          await writeThrough(tx, "link-rolled-back");
          throw failure;
        })
      ).rejects.toBe(failure);
      expect(await stored("link-rolled-back")).toBe(false);
    });

    it("commits with the plugin's transaction", async () => {
      const ctx = await boot();
      await ctx.db.transaction(async tx => {
        await writeThrough(tx, "link-committed");
      });
      expect(await stored("link-committed")).toBe(true);
    });

    it("refuses a handle whose transaction has finished, and writes nothing", async () => {
      const ctx = await boot();
      let kept: PluginTransaction | undefined;
      await ctx.db.transaction(async tx => {
        kept = tx;
      });
      if (!kept) throw new Error("the transaction never ran");
      await expect(writeThrough(kept, "link-after-end")).rejects.toThrow();
      expect(await stored("link-after-end")).toBe(false);
    });

    it("refuses anything but a handle ctx.db.transaction passed its callback", async () => {
      const ctx = await boot();
      for (const handle of [ctx.db, ctx.db.raw, {}, null]) {
        let caught: unknown;
        try {
          linkedTransaction(handle, "test.write");
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(NextlyError);
        expect(JSON.stringify(caught)).toMatch(/ctx\.db\.transaction/);
      }
    });
  }
);
