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
  MAX_DURABLE_PAYLOAD_BYTES,
} from "../durable-events";
import { pluginEventsTables } from "../../../schemas/plugin-events";

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

/** A plain select through a table's schema, as Drizzle builds it. */
interface SchemaReadDb {
  select(fields: Record<string, unknown>): {
    from(table: unknown): PromiseLike<Array<{ createdAt: Date }>>;
  };
}

interface EventRow {
  id: string;
  owner: string;
  name: string;
  payload: string;
  createdAt: unknown;
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

    it("a payload of exactly the cap is recorded and read back whole", async () => {
      const { events, rows } = await boot();
      // `{"note":"…"}` is 11 bytes around the note: the whole JSON is the
      // cap to the byte, which every dialect's column must hold.
      const note = "x".repeat(MAX_DURABLE_PAYLOAD_BYTES - 11);
      expect(Buffer.byteLength(JSON.stringify({ note }), "utf8")).toBe(
        MAX_DURABLE_PAYLOAD_BYTES
      );
      await events.record("test-orders.paid", { note });
      const [row] = await rows();
      expect(JSON.parse(row!.payload)).toEqual({ note });
    });

    it("an event dated past 2038 is recorded and read back", async () => {
      const { adapter, rows } = await boot();
      // A whole second, as SQLite keeps it, on every dialect.
      const at = new Date("2040-06-01T12:34:56.000Z");
      const later = createDurableEventRecorder({
        owner: OWNER,
        durable: durableEventNames(EVENTS),
        adapter: () => adapter,
        now: () => at,
      });
      await later.record("test-orders.paid", { order: "o-7" });
      const [row] = await rows();
      // SQLite hands back the seconds it stores; the others a date.
      const created = row!.createdAt;
      const ms =
        typeof created === "number"
          ? created * 1000
          : new Date(created as string | Date).getTime();
      expect(ms).toBe(at.getTime());
      // Read through the table's own schema too, as the dispatcher reads it:
      // a column declared in another unit than the one written would misread
      // it by a factor of a thousand.
      const table = pluginEventsTables(adapter.dialect).nextlyPluginEvents;
      const [viaSchema] = await adapter.transaction(
        async tx =>
          await tx
            .getDrizzle<SchemaReadDb>()
            .select({ createdAt: table.createdAt })
            .from(table)
      );
      expect(viaSchema?.createdAt.getTime()).toBe(at.getTime());
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
