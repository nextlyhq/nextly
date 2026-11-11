/**
 * A plugin's event is delivered once the work that emitted it commits, on
 * every dialect: emitted with the plugin's transaction, or inside one the
 * calling flow holds, it waits for the outermost commit, and is never
 * delivered for work that rolled back or an attempt that was retried.
 * Outside any transaction, as from a job or a route, it is delivered at once.
 *
 * @module plugins/__tests__/events-after-commit.integration.test
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { container } from "../../di/container";
import { defineJob, type JobRegistry } from "../../domains/jobs/job-registry";
import { runJobsPass } from "../../domains/jobs/jobs-runner";
import { getEventBus } from "../../events/event-bus";
import { createDynamicHandlers } from "../../routeHandler";
import { definePlugin, type PluginContext } from "../plugin-context";
import type { PluginRouteContext } from "../routes/route-types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

let current: TestNextly | undefined;
let unlisten: (() => void) | undefined;
afterEach(async () => {
  unlisten?.();
  unlisten = undefined;
  await current?.destroy();
  current = undefined;
});

// Unscoped, so its routes answer under one path segment.
const OWNER = "test-orders";
const PAID = "test-orders.paid";
const JOB = "test-orders:announce";
const ORIGIN = "http://localhost";

describe.each(getConfiguredTestDialects())(
  "a plugin's events after commit (%s)",
  (dialect: TestDialect) => {
    async function boot() {
      let ctx: PluginContext | undefined;
      const plugin = definePlugin({
        name: OWNER,
        version: "1.0.0",
        nextly: ">=0.0.0",
        init(context) {
          ctx = context;
        },
        contributes: {
          events: [{ name: PAID }],
          jobs: [
            defineJob({
              slug: JOB,
              handler: async () => {
                ctx?.events.emit(PAID, { from: "job" });
              },
            }),
          ],
          routes: [
            {
              method: "POST",
              path: "/announce",
              public: true,
              handler: (_req: Request, routeCtx: PluginRouteContext) => {
                routeCtx.events.emit(PAID, { from: "route" });
                return Response.json({ ok: true });
              },
            },
          ],
        },
      });
      current = await createTestNextly(
        dialect === "sqlite"
          ? { plugins: [plugin] }
          : { dialect, plugins: [plugin] }
      );
      const adapter = current.adapter as unknown as DrizzleAdapter;
      // A PostgreSQL or MySQL leg that silently booted SQLite would prove
      // nothing about those databases.
      expect(adapter.dialect).toBe(dialect);
      if (!ctx) throw new Error("the plugin's init did not run");
      const heard: unknown[] = [];
      const listen = (envelope: { payload: unknown }) => {
        heard.push(envelope.payload);
      };
      getEventBus().on(PAID, listen);
      unlisten = () => getEventBus().off(PAID, listen);
      return { ctx, adapter, heard };
    }

    it("an event emitted with the plugin's transaction is delivered once it commits, never if it rolls back", async () => {
      const { ctx, heard } = await boot();
      const failed = new Error("the order could not be saved");
      await expect(
        ctx.db.transaction(async tx => {
          ctx.events.emit(PAID, { order: "o-1" }, { tx });
          throw failed;
        })
      ).rejects.toBe(failed);
      expect(heard).toEqual([]);

      await ctx.db.transaction(async tx => {
        ctx.events.emit(PAID, { order: "o-2" }, { tx });
        expect(heard).toEqual([]);
      });
      expect(heard).toEqual([{ order: "o-2" }]);
    });

    it("an event emitted inside a transaction the flow holds waits for the outermost commit", async () => {
      const { ctx, adapter, heard } = await boot();
      await adapter.transaction(async () => {
        await adapter.transaction(async () => {
          ctx.events.emit(PAID, { order: "o-3" });
        });
        // The inner one is done, the outer one is not.
        expect(heard).toEqual([]);
      });
      expect(heard).toEqual([{ order: "o-3" }]);

      const failed = new Error("the outer work failed");
      await expect(
        adapter.transaction(async () => {
          ctx.events.emit(PAID, { order: "o-4" });
          throw failed;
        })
      ).rejects.toThrow(failed.message);
      expect(heard).toEqual([{ order: "o-3" }]);

      // Emitted after that rollback, with no transaction open, it is this
      // code's own event, not the undone work's: delivered at once.
      ctx.events.emit(PAID, { order: "o-5" });
      expect(heard).toEqual([{ order: "o-3" }, { order: "o-5" }]);
    });

    it("an event emitted with a transaction's handle waits for that transaction, from any flow", async () => {
      const { ctx, heard } = await boot();
      let release!: () => void;
      const released = new Promise<void>(resolve => {
        release = resolve;
      });
      let handle: Parameters<Parameters<typeof ctx.db.transaction>[0]>[0];
      let opened!: () => void;
      const isOpen = new Promise<void>(resolve => {
        opened = resolve;
      });
      const running = ctx.db.transaction(async tx => {
        handle = tx;
        opened();
        await released;
      });
      await isOpen;
      // From this flow, which holds no transaction, with the open one's
      // handle, under a context of its own the listener must still see:
      // held by that transaction, delivered in the emitter's context.
      const emitter = new AsyncLocalStorage<string>();
      const seen: Array<string | undefined> = [];
      const watch = () => {
        seen.push(emitter.getStore());
      };
      getEventBus().on(PAID, watch);
      try {
        emitter.run("the emitting request", () =>
          ctx.events.emit(PAID, { order: "o-6" }, { tx: handle! })
        );
        expect(heard).toEqual([]);
        release();
        await running;
      } finally {
        getEventBus().off(PAID, watch);
      }
      expect(heard).toEqual([{ order: "o-6" }]);
      expect(seen).toEqual(["the emitting request"]);
    });

    it("a retried attempt's event is delivered once", async () => {
      const { ctx, adapter, heard } = await boot();
      const busy = new Error("try again");
      let attempts = 0;
      await adapter.transaction(
        async () => {
          attempts += 1;
          ctx.events.emit(PAID, { attempt: attempts });
          if (attempts === 1) throw busy;
        },
        { retryCount: 1, retryWhen: error => error === busy }
      );
      expect(attempts).toBe(2);
      expect(heard).toEqual([{ attempt: 2 }]);
    });

    it.skipIf(dialect === "mysql")(
      "an inner rollback drops its event and keeps the outer one's",
      async () => {
        const { ctx, adapter, heard } = await boot();
        await adapter.transaction(async () => {
          ctx.events.emit(PAID, { part: "outer" });
          await expect(
            adapter.transaction(async () => {
              ctx.events.emit(PAID, { part: "inner" });
              throw new Error("the inner part failed");
            })
          ).rejects.toThrow("the inner part failed");
        });
        expect(heard).toEqual([{ part: "outer" }]);
      }
    );

    it("outside a transaction, an event emitted from a job and from a route is delivered at once", async () => {
      const { ctx, adapter, heard } = await boot();
      // Straight from the plugin's own code.
      ctx.events.emit(PAID, { from: "init" });
      expect(heard).toEqual([{ from: "init" }]);

      await ctx.services.jobs.queue({ task: JOB, input: null } as never);
      await runJobsPass(adapter, container.get<JobRegistry>("jobRegistry"), {
        maxDurationMs: 10_000,
      });
      expect(heard).toContainEqual({ from: "job" });

      const handlers = createDynamicHandlers();
      const res = await handlers.POST(
        new Request(`${ORIGIN}/api/plugins/test-orders/announce`, {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/json" },
          body: "{}",
        }),
        {
          params: Promise.resolve({
            params: ["plugins", "test-orders", "announce"],
          }),
        }
      );
      expect(res.status, await res.clone().text()).toBe(200);
      expect(heard).toContainEqual({ from: "route" });
    });

    it("an event emitted with the handle of a transaction that has ended is refused", async () => {
      const { ctx, heard } = await boot();
      let kept: Parameters<Parameters<typeof ctx.db.transaction>[0]>[0];
      await ctx.db.transaction(async tx => {
        kept = tx;
      });
      expect(() =>
        ctx.events.emit(PAID, { order: "o-7" }, { tx: kept! })
      ).toThrow(
        expect.objectContaining({
          logContext: { reason: "plugin-transaction-finished" },
        })
      );
      // The refusal says what to do instead.
      expect(() =>
        ctx.events.emit(PAID, { order: "o-7" }, { tx: kept! })
      ).toThrow(
        expect.objectContaining({
          publicData: {
            errors: [
              expect.objectContaining({
                message: expect.stringContaining("emit without `tx`"),
              }),
            ],
          },
        })
      );
      expect(heard).toEqual([]);
    });

    it("a reserved or foreign event name is refused before anything is held", async () => {
      const { ctx, heard } = await boot();
      await ctx.db.transaction(async tx => {
        expect(() =>
          ctx.events.emit("collection.posts.created", { id: "x" }, { tx })
        ).toThrow();
        expect(() =>
          ctx.events.emit("other-plugin.paid", { id: "x" }, { tx })
        ).toThrow();
      });
      expect(heard).toEqual([]);
    });
  }
);
