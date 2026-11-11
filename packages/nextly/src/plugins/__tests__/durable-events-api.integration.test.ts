/**
 * A plugin's durable events through its own `ctx.events`, on every dialect:
 * `emitDurable` records an event with the work that emitted it, by the rule
 * `emit` follows (the plugin's transaction, else the one the calling flow
 * holds, else one of its own), and `onDurable` subscribers receive it, each
 * once, on a jobs run. An inner rollback drops its durable event and keeps
 * the outer one's. A committed event offers the prompt dispatch; one that
 * rolled back does not.
 *
 * @module plugins/__tests__/durable-events-api.integration.test
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../di/container";
import { defineJob, type JobRegistry } from "../../domains/jobs/job-registry";
import { runJobsPass } from "../../domains/jobs/jobs-runner";
import { getDurableEventsKick } from "../../domains/plugin-events/kick";
import { getDurableSubscribers } from "../../domains/plugin-events/subscribers";
import { createDynamicHandlers } from "../../routeHandler";
import { clearPluginSubscriptions } from "../subscription-tracker";
import { definePlugin, type PluginContext } from "../plugin-context";
import type { PluginRouteContext } from "../routes/route-types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  // The process's subscribers outlive an instance: each test starts clean.
  getDurableSubscribers().removeOwner(ORDERS);
  getDurableSubscribers().removeOwner(LOYALTY);
  vi.restoreAllMocks();
});

// Unscoped, so the routes answer under one path segment.
const ORDERS = "test-orders";
const LOYALTY = "test-loyalty";
const PAID = "test-orders.paid";
const VIEWED = "test-orders.viewed";
const JOB = "test-orders:announce";
const ORIGIN = "http://localhost";

interface EventRow {
  id: string;
  name: string;
  payload: string;
}

describe.each(getConfiguredTestDialects())(
  "a plugin's durable events (%s)",
  (dialect: TestDialect) => {
    async function boot() {
      let orders: PluginContext | undefined;
      const delivered: string[] = [];
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [
          definePlugin({
            name: ORDERS,
            version: "1.0.0",
            nextly: ">=0.0.0",
            init(context) {
              orders = context;
            },
            contributes: {
              events: [{ name: PAID, durable: true }, { name: VIEWED }],
              jobs: [
                defineJob({
                  slug: JOB,
                  handler: async () => {
                    await orders?.events.emitDurable(PAID, { from: "job" });
                  },
                }),
              ],
              routes: [
                {
                  method: "POST",
                  path: "/announce",
                  public: true,
                  handler: async (_req: Request, ctx: PluginRouteContext) => {
                    await ctx.events.emitDurable(PAID, { from: "route" });
                    return Response.json({ ok: true });
                  },
                },
              ],
            },
          }),
          definePlugin({
            name: LOYALTY,
            version: "1.0.0",
            nextly: ">=0.0.0",
            init(context) {
              context.events.onDurable(PAID, "award", event => {
                delivered.push(`award:${event.id}:${event.attempt}`);
              });
              context.events.onDurable(PAID, "receipt", event => {
                delivered.push(`receipt:${event.id}:${event.attempt}`);
              });
            },
          }),
        ],
      });
      const adapter = current.adapter as unknown as DrizzleAdapter;
      // A PostgreSQL or MySQL leg that silently booted SQLite would prove
      // nothing about those databases.
      expect(adapter.dialect).toBe(dialect);
      if (!orders) throw new Error("the plugin's init did not run");
      const rows = () => adapter.select<EventRow>("nextly_plugin_events", {});
      const pass = () =>
        runJobsPass(adapter, container.get<JobRegistry>("jobRegistry"), {
          maxDurationMs: 10_000,
        });
      return { orders, adapter, rows, pass, delivered };
    }

    it("an event emitted with the plugin's transaction commits and rolls back with it, and each subscriber gets it once", async () => {
      const { orders, rows, pass, delivered } = await boot();
      const failed = new Error("the order could not be saved");
      await expect(
        orders.db.transaction(async tx => {
          await orders.events.emitDurable(PAID, { order: "o-1" }, { tx });
          throw failed;
        })
      ).rejects.toBe(failed);
      expect(await rows()).toEqual([]);

      let recorded: { id: string } | undefined;
      await orders.db.transaction(async tx => {
        recorded = await orders.events.emitDurable(
          PAID,
          { order: "o-2" },
          { tx }
        );
      });
      expect((await rows()).map(row => row.id)).toEqual([recorded?.id]);

      await pass();
      await pass();
      expect([...delivered].sort()).toEqual(
        [`award:${recorded?.id}:1`, `receipt:${recorded?.id}:1`].sort()
      );
    });

    it("an event emitted inside a transaction the flow holds commits and rolls back with it", async () => {
      const { orders, adapter, rows } = await boot();
      const failed = new Error("the outer work failed");
      await expect(
        adapter.transaction(async () => {
          await orders.events.emitDurable(PAID, { order: "o-3" });
          throw failed;
        })
      ).rejects.toThrow(failed.message);
      expect(await rows()).toEqual([]);
      await adapter.transaction(async () => {
        await orders.events.emitDurable(PAID, { order: "o-4" });
      });
      expect(await rows()).toHaveLength(1);
    });

    it.skipIf(dialect === "mysql")(
      "an inner rollback drops its durable event and keeps the outer one's",
      async () => {
        const { orders, adapter, rows } = await boot();
        await adapter.transaction(async () => {
          await orders.events.emitDurable(PAID, { part: "outer" });
          await expect(
            adapter.transaction(async () => {
              await orders.events.emitDurable(PAID, { part: "inner" });
              throw new Error("the inner part failed");
            })
          ).rejects.toThrow("the inner part failed");
        });
        expect((await rows()).map(row => JSON.parse(row.payload))).toEqual([
          { part: "outer" },
        ]);
      }
    );

    it("an event emitted outside a transaction, from a job and from a route, is recorded and delivered", async () => {
      const { orders, rows, pass, delivered } = await boot();
      await orders.services.jobs.queue({ task: JOB, input: null } as never);
      await pass();
      const res = await createDynamicHandlers().POST(
        new Request(`${ORIGIN}/api/plugins/${ORDERS}/announce`, {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/json" },
          body: "{}",
        }),
        { params: Promise.resolve({ params: ["plugins", ORDERS, "announce"] }) }
      );
      expect(res.status, await res.clone().text()).toBe(200);
      const recorded = await rows();
      // In no promised order: the two rows may share a timestamp.
      expect(
        recorded
          .map(row => (JSON.parse(row.payload) as { from: string }).from)
          .sort()
      ).toEqual(["job", "route"]);
      await pass();
      await pass();
      expect(delivered).toHaveLength(4);
    });

    it("an event emitted with a transaction's handle, from another flow, rolls back with that transaction", async () => {
      const { orders, rows } = await boot();
      let handle: Parameters<Parameters<typeof orders.db.transaction>[0]>[0];
      let opened!: () => void;
      const isOpen = new Promise<void>(resolve => {
        opened = resolve;
      });
      let release!: () => void;
      const released = new Promise<void>(resolve => {
        release = resolve;
      });
      const failed = new Error("the order could not be saved");
      const running = orders.db.transaction(async tx => {
        handle = tx;
        opened();
        await released;
        throw failed;
      });
      await isOpen;
      // From this flow, which holds no transaction, into the open one.
      await orders.events.emitDurable(PAID, { order: "o-8" }, { tx: handle! });
      release();
      await expect(running).rejects.toBe(failed);
      expect(await rows()).toEqual([]);
    });

    it("a plugin torn down for a re-registration stops running, and is still owed what is dispatched meanwhile", async () => {
      const { orders, adapter, pass, delivered } = await boot();
      clearPluginSubscriptions(LOYALTY);
      expect(getDurableSubscribers().handlerOf(`${LOYALTY}:award`)).toBe(
        undefined
      );
      // Dispatched in the gap before the plugin registers again: the event
      // is owed to both of its subscribers, not finished without them.
      const { id } = await orders.events.emitDurable(PAID, { order: "o-10" });
      await pass();
      expect(delivered).toEqual([]);
      const owed = await adapter.select<{ subscriber: string }>(
        "nextly_plugin_event_deliveries",
        {}
      );
      expect(owed.map(row => row.subscriber).sort()).toEqual([
        `${LOYALTY}:award`,
        `${LOYALTY}:receipt`,
      ]);
      const [event] = await adapter.select<{ id: string; finishedAt: unknown }>(
        "nextly_plugin_events",
        {}
      );
      expect(event?.id).toBe(id);
      expect(event?.finishedAt ?? null).toBeNull();
    });

    it("an emit its transaction's callback did not wait for is recorded, and its commit offers the prompt dispatch", async () => {
      const { orders, rows } = await boot();
      const offer = vi.spyOn(getDurableEventsKick(), "offer");
      let emitted: Promise<{ id: string }> | undefined;
      await orders.db.transaction(async tx => {
        // Not awaited: the transaction ends as soon as the write lands.
        emitted = orders.events.emitDurable(PAID, { order: "o-11" }, { tx });
      });
      const recorded = await emitted;
      expect((await rows()).map(row => row.id)).toEqual([recorded?.id]);
      expect(offer).toHaveBeenCalledTimes(1);
    });

    it("a committed durable event offers the prompt dispatch, and one that rolled back does not", async () => {
      const { orders } = await boot();
      const offer = vi.spyOn(getDurableEventsKick(), "offer");
      await expect(
        orders.db.transaction(async tx => {
          await orders.events.emitDurable(PAID, { order: "o-5" }, { tx });
          throw new Error("rolled back");
        })
      ).rejects.toThrow("rolled back");
      expect(offer).not.toHaveBeenCalled();
      await orders.db.transaction(async tx => {
        await orders.events.emitDurable(PAID, { order: "o-6" }, { tx });
        expect(offer).not.toHaveBeenCalled();
      });
      expect(offer).toHaveBeenCalledTimes(1);
    });

    it("emitDurable refuses an event not declared durable, before writing", async () => {
      const { orders, rows } = await boot();
      await expect(
        orders.events.emitDurable(VIEWED, { order: "o-7" })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(await rows()).toEqual([]);
    });

    it("onDurable refuses a second subscriber of the same name", async () => {
      const { orders } = await boot();
      orders.events.onDurable(PAID, "audit", () => {});
      expect(() => orders.events.onDurable(PAID, "audit", () => {})).toThrow(
        /already has a durable subscriber named "audit"/
      );
    });
  }
);
