/**
 * The prompt dispatch a committed durable event offers, on every dialect: a
 * committed event is delivered as soon as `after()` runs, with no jobs run;
 * one that rolled back offers nothing; a kick and the scheduled sweep at once
 * deliver once, since both go through the same lease-claimed dispatch.
 *
 * @module domains/plugin-events/__tests__/kick.integration.test
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import {
  bootTwoInstances,
  type TwoInstances,
} from "../../../plugins/__tests__/helpers/two-instances";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { dispatchDurableEvents } from "../dispatch";
import {
  createDurableEventRecorder,
  durableEventNames,
} from "../durable-events";
import { DurableEventsKick } from "../kick";
import { createDurableSubscribers } from "../subscribers";

let single: TestNextly | undefined;
let pair: TwoInstances | undefined;
afterEach(async () => {
  await single?.destroy();
  single = undefined;
  await pair?.destroy();
  pair = undefined;
});

const OWNER = "@test/orders";
const PAID = "test-orders.paid";
const EVENTS = [{ name: PAID, durable: true as const }];

/** An `after()` that keeps each callback until the test runs them. */
function heldAfter() {
  const callbacks: Array<() => void | Promise<void>> = [];
  return {
    callbacks,
    load: () => (callback: () => void | Promise<void>) => {
      callbacks.push(callback);
    },
    runAll: () => Promise.all(callbacks.splice(0).map(callback => callback())),
  };
}

describe.each(getConfiguredTestDialects())(
  "the prompt dispatch of durable events (%s)",
  (dialect: TestDialect) => {
    async function boot() {
      let ctx: PluginContext | undefined;
      const plugin = definePlugin({
        name: OWNER,
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { events: EVENTS },
        init(context) {
          ctx = context;
        },
      });
      single = await createTestNextly(
        dialect === "sqlite"
          ? { plugins: [plugin] }
          : { dialect, plugins: [plugin] }
      );
      const adapter = single.adapter as unknown as DrizzleAdapter;
      expect(adapter.dialect).toBe(dialect);
      if (!ctx) throw new Error("the plugin's init did not run");
      const delivered: string[] = [];
      const subscribers = createDurableSubscribers();
      subscribers.register("@test/email", PAID, "receipt", event => {
        delivered.push(event.id);
      });
      const after = heldAfter();
      const kick = new DurableEventsKick({
        adapter: () => adapter,
        subscribers: () => subscribers,
        loadAfter: after.load,
      });
      const events = createDurableEventRecorder({
        owner: OWNER,
        durable: durableEventNames(EVENTS),
        adapter: () => adapter,
        kick: () => kick,
      });
      return { ctx, adapter, events, after, delivered };
    }

    it("a committed event is delivered once after() runs, with no jobs run", async () => {
      const { ctx, adapter, events, after, delivered } = await boot();

      // In a transaction of its own.
      const own = await events.record(PAID, { order: "o-1" });
      expect(after.callbacks).toHaveLength(1);
      expect(delivered).toEqual([]);
      await after.runAll();
      expect(delivered).toEqual([own.id]);

      // In the plugin's transaction: offered only once it commits.
      let inPlugin: { id: string } | undefined;
      await ctx.db.transaction(async tx => {
        inPlugin = await events.record(PAID, { order: "o-2" }, { tx });
        expect(after.callbacks).toHaveLength(0);
      });
      expect(after.callbacks).toHaveLength(1);
      await after.runAll();
      expect(delivered).toEqual([own.id, inPlugin?.id]);

      // In a transaction the calling flow holds: offered once it commits.
      let inFlow: { id: string } | undefined;
      await adapter.transaction(async () => {
        inFlow = await events.record(PAID, { order: "o-3" });
        expect(after.callbacks).toHaveLength(0);
      });
      expect(after.callbacks).toHaveLength(1);
      await after.runAll();
      expect(delivered).toEqual([own.id, inPlugin?.id, inFlow?.id]);
    });

    it("an event whose transaction rolled back offers nothing", async () => {
      const { ctx, adapter, events, after } = await boot();
      const failed = new Error("the order could not be saved");
      await expect(
        ctx.db.transaction(async tx => {
          await events.record(PAID, { order: "o-4" }, { tx });
          throw failed;
        })
      ).rejects.toBe(failed);
      await expect(
        adapter.transaction(async () => {
          await events.record(PAID, { order: "o-5" });
          throw failed;
        })
      ).rejects.toThrow(failed.message);
      expect(after.callbacks).toHaveLength(0);
    });

    it("a kick and the sweep at once deliver once", async () => {
      pair = await bootTwoInstances(dialect, {
        plugins: [
          definePlugin({
            name: OWNER,
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: { events: EVENTS },
          }),
        ],
      });
      const first = pair.first.adapter as unknown as DrizzleAdapter;
      const second = pair.second;
      expect(first.dialect).toBe(dialect);
      const runs: string[] = [];
      const subscribers = createDurableSubscribers();
      subscribers.register("@test/email", PAID, "receipt", event => {
        runs.push(event.id);
      });
      const after = heldAfter();
      const kick = new DurableEventsKick({
        adapter: () => first,
        subscribers: () => subscribers,
        loadAfter: after.load,
      });
      const events = createDurableEventRecorder({
        owner: OWNER,
        durable: durableEventNames(EVENTS),
        adapter: () => first,
        kick: () => kick,
      });
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push((await events.record(PAID, { order: `o-${i}` })).id);
      }
      // The kicks on one connection, the sweep on the other, at once.
      await Promise.all([
        after.runAll(),
        dispatchDurableEvents({ adapter: second, subscribers }),
      ]);
      expect([...runs].sort()).toEqual([...ids].sort());
    });
  }
);
