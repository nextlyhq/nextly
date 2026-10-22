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
import {
  type NextlyLogger,
  setNextlyLogger,
} from "../../../observability/logger";
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
  setNextlyLogger(undefined);
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

    /** Linked work that waits a moment before it writes, as slow work would. */
    function writeLater(
      tx: PluginTransaction,
      key: string,
      fail?: Error
    ): Promise<unknown> {
      return linkedTransaction(tx, "test.write").run(async adapterTx => {
        await new Promise(resolve => setTimeout(resolve, 100));
        await adapterTx.insert("nextly_meta", {
          key,
          value: null,
          updatedAt: new Date(),
        });
        if (fail) throw fail;
      });
    }

    it("waits for linked work the callback started and did not await", async () => {
      const ctx = await boot();
      await ctx.db.transaction(async tx => {
        // Started, not awaited: the callback settles first.
        void writeLater(tx, "link-unawaited").catch(() => undefined);
      });
      expect(await stored("link-unawaited")).toBe(true);
    });

    it("rolls back when linked work the callback did not await fails", async () => {
      const ctx = await boot();
      const failure = new Error("the core write failed after inserting");
      await expect(
        ctx.db.transaction(async tx => {
          void writeLater(tx, "link-unawaited-failed", failure).catch(
            () => undefined
          );
        })
      ).rejects.toBe(failure);
      expect(await stored("link-unawaited-failed")).toBe(false);
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

    it("runs an effect after the commit, where the pool sees the transaction's writes", async () => {
      const ctx = await boot();
      const seen: Array<{ at: string; stored?: boolean }> = [];
      const result = await ctx.db.transaction(async tx => {
        await writeThrough(tx, "link-effect-committed");
        linkedTransaction(tx, "test.effect").afterCommit(async () => {
          // Read on the pool, not the transaction's connection: on PostgreSQL
          // and MySQL only a committed row is visible here.
          seen.push({
            at: "effect",
            stored: await stored("link-effect-committed"),
          });
        });
        seen.push({ at: "callback end" });
        return "the callback's result";
      });
      seen.push({ at: "resolved" });
      expect(result).toBe("the callback's result");
      expect(seen).toEqual([
        { at: "callback end" },
        { at: "effect", stored: true },
        { at: "resolved" },
      ]);
    });

    it("runs effects in the order they were registered", async () => {
      const ctx = await boot();
      const order: string[] = [];
      await ctx.db.transaction(async tx => {
        const link = linkedTransaction(tx, "test.effect");
        link.afterCommit(async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          order.push("first");
        });
        link.afterCommit(() => {
          order.push("second");
        });
      });
      expect(order).toEqual(["first", "second"]);
    });

    it("never runs an effect when the transaction rolls back", async () => {
      const ctx = await boot();
      const failure = new Error("the plugin's own work failed");
      let ran = false;
      await expect(
        ctx.db.transaction(async tx => {
          await writeThrough(tx, "link-effect-rolled-back");
          linkedTransaction(tx, "test.effect").afterCommit(() => {
            ran = true;
          });
          throw failure;
        })
      ).rejects.toBe(failure);
      expect(ran).toBe(false);
      expect(await stored("link-effect-rolled-back")).toBe(false);
    });

    it("logs an effect that fails, keeps the commit, and still runs the next effect", async () => {
      const ctx = await boot();
      const errors: object[] = [];
      const quiet = () => undefined;
      const logger: NextlyLogger = {
        error: payload => errors.push(payload),
        warn: quiet,
        info: quiet,
        debug: quiet,
      };
      setNextlyLogger(logger);
      let next = false;
      const result = await ctx.db.transaction(async tx => {
        await writeThrough(tx, "link-effect-failed");
        const link = linkedTransaction(tx, "test.effect");
        link.afterCommit(() => {
          throw new Error("the effect failed");
        });
        link.afterCommit(() => {
          next = true;
        });
        return "committed";
      });
      expect(result).toBe("committed");
      expect(await stored("link-effect-failed")).toBe(true);
      expect(next).toBe(true);
      expect(errors).toEqual([
        { kind: "after-commit-effect-failed", message: "the effect failed" },
      ]);
    });

    it("keeps the commit and runs the next effect when the logger itself throws", async () => {
      const ctx = await boot();
      const broken = () => {
        throw new Error("the logger is broken");
      };
      setNextlyLogger({
        error: broken,
        warn: broken,
        info: broken,
        debug: broken,
      });
      let next = false;
      const result = await ctx.db.transaction(async tx => {
        await writeThrough(tx, "link-logger-broken");
        const link = linkedTransaction(tx, "test.effect");
        link.afterCommit(() => {
          throw new Error("the effect failed");
        });
        link.afterCommit(() => {
          next = true;
        });
        return "committed";
      });
      expect(result).toBe("committed");
      expect(next).toBe(true);
      expect(await stored("link-logger-broken")).toBe(true);
    });

    it("refuses an effect once the transaction has finished", async () => {
      const ctx = await boot();
      let kept: PluginTransaction | undefined;
      await ctx.db.transaction(async tx => {
        kept = tx;
      });
      if (!kept) throw new Error("the transaction never ran");
      const link = linkedTransaction(kept, "test.effect");
      let caught: unknown;
      try {
        link.afterCommit(() => undefined);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NextlyError);
      expect(JSON.stringify(caught)).toMatch(/already finished/);
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
