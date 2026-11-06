/**
 * Recording durable events, on every dialect: in the plugin's transaction,
 * which they commit and roll back with; in a transaction of their own when
 * none is open; and inside a transaction the calling flow holds, which they
 * join. Each is a row in `nextly_plugin_events`, apart from the webhook
 * outbox.
 *
 * @module domains/plugin-events/__tests__/durable-events.integration.test
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

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
import {
  createDurableEventRecorder,
  durableEventNames,
} from "../durable-events";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const OWNER = "@test/orders";
const EVENTS = [
  { name: "test-orders.paid", durable: true as const },
  { name: "test-orders.viewed" },
];

interface EventRow {
  id: string;
  owner: string;
  name: string;
  payload: string;
  fannedOutAt: unknown;
  finishedAt: unknown;
}

describe.each(getConfiguredTestDialects())(
  "recording durable events (%s)",
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
      const events = createDurableEventRecorder({
        owner: OWNER,
        durable: durableEventNames(EVENTS),
        adapter: () => adapter,
      });
      const rows = () => adapter.select<EventRow>("nextly_plugin_events", {});
      return { ctx, events, rows, adapter };
    }

    it("a durable event commits and rolls back with the work that emitted it", async () => {
      const { ctx, events, rows } = await boot();
      const failed = new Error("the order could not be saved");
      await expect(
        ctx.db.transaction(async tx => {
          await events.record("test-orders.paid", { order: "o-1" }, { tx });
          throw failed;
        })
      ).rejects.toBe(failed);
      expect(await rows()).toEqual([]);

      let recorded: { id: string } | undefined;
      await ctx.db.transaction(async tx => {
        recorded = await events.record(
          "test-orders.paid",
          { order: "o-2", amount: 10 },
          { tx }
        );
      });
      const [row] = await rows();
      expect(await rows()).toHaveLength(1);
      expect(row).toMatchObject({
        id: recorded?.id,
        owner: OWNER,
        name: "test-orders.paid",
      });
      expect(JSON.parse(row!.payload)).toEqual({ order: "o-2", amount: 10 });
      // Not yet dispatched, and not finished.
      expect(row!.fannedOutAt ?? null).toBeNull();
      expect(row!.finishedAt ?? null).toBeNull();
    });

    it("an event recorded outside a transaction commits in one of its own", async () => {
      const { events, rows } = await boot();
      const { id } = await events.record("test-orders.paid", { order: "o-3" });
      expect((await rows()).map(row => row.id)).toEqual([id]);
    });

    it("an event recorded while the calling flow holds a transaction joins it", async () => {
      const { events, rows, adapter } = await boot();
      const failed = new Error("the outer work failed");
      // No handle passed: the event is part of the transaction the flow has
      // open, so it rolls back with it.
      // The adapter hands back its own error for a failed transaction, with
      // the cause's message.
      await expect(
        adapter.transaction(async () => {
          await events.record("test-orders.paid", { order: "o-4" });
          throw failed;
        })
      ).rejects.toThrow(failed.message);
      expect(await rows()).toEqual([]);

      await adapter.transaction(async () => {
        await events.record("test-orders.paid", { order: "o-5" });
      });
      expect(await rows()).toHaveLength(1);
    });

    it("the booted database refuses a second delivery for one event and subscriber", async () => {
      const { events, adapter } = await boot();
      const { id } = await events.record("test-orders.paid", { order: "o-6" });
      const at = new Date();
      const delivery = (deliveryId: string, subscriberKey: string) =>
        adapter.transaction(tx =>
          tx.insert("nextly_plugin_event_deliveries", {
            id: deliveryId,
            eventId: id,
            subscriber: "@test/loyalty:points",
            subscriberKey,
            status: "pending",
            attemptCount: 0,
            nextAttemptAt: at,
            createdAt: at,
          })
        );
      await delivery("d-1", "a".repeat(64));
      // Whichever way the database was made, at boot or by a migration, it
      // holds one delivery per event and subscriber itself.
      await expect(delivery("d-2", "a".repeat(64))).rejects.toThrow();
      await delivery("d-3", "b".repeat(64));
    });
  }
);
