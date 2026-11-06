/**
 * A plugin records an event of a webhook type it declared, and it is fanned
 * out to the endpoints subscribed to it, on every configured dialect.
 *
 * Recorded on its own or inside the plugin's `ctx.db.transaction`, where it is
 * committed with the plugin's writes and gone if they roll back. A type the
 * plugin did not declare, another plugin's or core's, is refused by name
 * before anything is written. It reaches an endpoint subscribed to its type or
 * to `*`, and no other: not one subscribed to other types, and not one scoped
 * to a collection, even a collection whose slug is the plugin's own.
 *
 * Each absence is asserted beside a delivery made in the same test, so a
 * fan-out that delivered nothing at all would fail here rather than pass.
 *
 * @module domains/webhooks/__tests__/plugin-record.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";
import { container } from "../../../di/container";
import { NextlyError } from "../../../errors/nextly-error";
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
  WebhookEndpointRegistry,
  type WebhookEndpointReader,
} from "../endpoint-registry";
import type { WebhookFastDrainScheduler } from "../after-drain";
import { fanOutDueEvents, type FanOutDatabase } from "../fan-out";
import type { FilterSpec, WebhookEventSubscription } from "../types";

const PAID = "shop.order.paid";
const REFUNDED = "shop.order.refunded";
const BILLING_TYPE = "billing.invoice.paid";

// An address literal, so the endpoint's URL check resolves no hostname.
// Nothing is ever connected to: deliveries are read as rows, never attempted.
const PUBLIC_URL = "https://93.184.216.34/hooks";

let current: TestNextly | undefined;
let shop: PluginContext | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  shop = undefined;
});

/**
 * Boots with the `shop` plugin, which declares two types, the `billing`
 * plugin, which declares one of its own, and a collection slugged as the
 * `shop` plugin is.
 */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({ slug: "shop", fields: [text({ name: "title" })] }),
    ],
    plugins: [
      definePlugin({
        name: "shop",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          webhookEvents: [{ type: PAID }, { type: REFUNDED }],
        },
        init(ctx: PluginContext) {
          shop = ctx;
        },
      }),
      definePlugin({
        name: "billing",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { webhookEvents: [{ type: BILLING_TYPE }] },
      }),
    ],
  });
  return current;
}

function plugin(): PluginContext {
  if (!shop) throw new Error("the shop plugin did not initialise");
  return shop;
}

/**
 * Register an endpoint, as the admin's form does, and return its id.
 *
 * Dated well before the events the test records: an endpoint receives only
 * events from after it was created, and MySQL keeps `created_at` to the whole
 * second, rounded, so one created a moment before an event can read as
 * created after it.
 */
async function endpoint(
  t: TestNextly,
  eventTypes: WebhookEventSubscription[]
): Promise<string> {
  const service = t.getService("webhookEndpointService");
  const { endpoint: created } = await service.createEndpoint(
    { name: eventTypes.join(","), url: PUBLIC_URL, eventTypes },
    null
  );
  await t.adapter.update(
    "nextly_webhooks",
    { created_at: new Date("2020-01-01T00:00:00.000Z") },
    { and: [{ column: "id", op: "=", value: created.id }] }
  );
  return created.id;
}

/**
 * Scope an endpoint to collections. No service writes a filter, so it is
 * stored directly, as JSON text every dialect's JSON column accepts.
 */
async function scopeTo(
  t: TestNextly,
  id: string,
  collections: string[]
): Promise<void> {
  const filter: FilterSpec = { version: 1, collections };
  await t.adapter.update(
    "nextly_webhooks",
    { filter: JSON.stringify(filter) },
    { and: [{ column: "id", op: "=", value: id }] }
  );
}

/**
 * One fan-out pass, as the drain makes it, through a registry built fresh so
 * it reads every endpoint as stored. The adapter is read from the container
 * under the surfaces the drain types it as, as its registration does.
 */
function fanOut() {
  const registry = new WebhookEndpointRegistry(
    container.get<WebhookEndpointReader>("adapter")
  );
  return fanOutDueEvents({
    db: container.get<FanOutDatabase>("adapter"),
    loadEndpoints: () => registry.getEnabledEndpoints(),
  });
}

interface EventRow {
  id: string;
  type: string;
  payload: unknown;
}

interface DeliveryRow {
  webhookId: string;
  eventId: string;
}

/** The envelope as stored; JSON text on SQLite, a value elsewhere. */
function envelopeOf(row: EventRow): {
  type: string;
  data: unknown;
  changedFields: string[];
  resource: { id?: string };
} {
  return typeof row.payload === "string"
    ? JSON.parse(row.payload)
    : (row.payload as never);
}

async function events(t: TestNextly): Promise<EventRow[]> {
  return t.adapter.select<EventRow>("nextly_events");
}

/** The resource id of each event delivered to each endpoint, by endpoint. */
async function deliveredIds(t: TestNextly): Promise<Map<string, string[]>> {
  const byEvent = new Map(
    (await events(t)).map(row => [row.id, envelopeOf(row).resource.id ?? ""])
  );
  const delivered = new Map<string, string[]>();
  for (const row of await t.adapter.select<DeliveryRow>(
    "nextly_webhook_deliveries"
  )) {
    const ids = delivered.get(row.webhookId) ?? [];
    ids.push(byEvent.get(row.eventId) ?? `unknown:${row.eventId}`);
    delivered.set(row.webhookId, ids.sort());
  }
  return delivered;
}

/** The refusal `work` rejects with, or a failure when it resolves. */
async function refusalOf(work: Promise<unknown>): Promise<NextlyError> {
  const error: unknown = await work.then(
    () => new Error("the record was not refused"),
    (thrown: unknown) => thrown
  );
  expect(error).toBeInstanceOf(NextlyError);
  return error as NextlyError;
}

describe.each(getConfiguredTestDialects())(
  "a plugin's recorded webhook event (%s)",
  dialect => {
    it("is fanned out to an endpoint subscribed to its type or to *, and to no other", async () => {
      const t = await boot(dialect);
      const paid = await endpoint(t, [PAID]);
      const wildcard = await endpoint(t, ["*"]);
      const refunded = await endpoint(t, [REFUNDED]);
      const entries = await endpoint(t, ["entry.created"]);

      await plugin().webhooks.record({
        type: PAID,
        id: "ord_1",
        data: { total: 42 },
      });
      await fanOut();

      const delivered = await deliveredIds(t);
      expect(delivered.get(paid)).toEqual(["ord_1"]);
      expect(delivered.get(wildcard)).toEqual(["ord_1"]);
      expect(delivered.has(refunded)).toBe(false);
      expect(delivered.has(entries)).toBe(false);
      const [event] = await events(t);
      expect(event).toBeDefined();
      expect(envelopeOf(event as EventRow)).toMatchObject({
        type: PAID,
        data: { total: 42 },
        resource: { id: "ord_1" },
      });
    });

    it("is committed with the plugin's transaction, and never delivered when it rolls back", async () => {
      const t = await boot(dialect);
      const paid = await endpoint(t, [PAID]);
      const failure = new Error("the plugin's own work failed");

      await expect(
        plugin().db.transaction(async tx => {
          await plugin().webhooks.record({
            type: PAID,
            id: "ord_rolled_back",
            data: {},
            tx,
          });
          throw failure;
        })
      ).rejects.toBe(failure);
      await plugin().db.transaction(async tx => {
        await plugin().webhooks.record({
          type: PAID,
          id: "ord_committed",
          data: {},
          tx,
        });
      });
      await fanOut();

      expect((await deliveredIds(t)).get(paid)).toEqual(["ord_committed"]);
      expect((await events(t)).map(row => row.type)).toEqual([PAID]);
    });

    it("refuses a record without the transaction's handle while the plugin's transaction is open", async () => {
      // A record that names no transaction runs in one of its own, so made
      // inside the plugin's it is refused rather than left to commit on its
      // own or not; the committed record after it is the control.
      const t = await boot(dialect);
      const paid = await endpoint(t, [PAID]);

      await expect(
        plugin().db.transaction(async () => {
          await plugin().webhooks.record({
            type: PAID,
            id: "ord_untied",
            data: {},
          });
        })
      ).rejects.toBeInstanceOf(NextlyError);
      await plugin().webhooks.record({
        type: PAID,
        id: "ord_on_its_own",
        data: {},
      });
      await fanOut();

      expect((await deliveredIds(t)).get(paid)).toEqual(["ord_on_its_own"]);
    });

    it("never reaches an endpoint scoped to a collection slugged as the plugin is", async () => {
      // The scoped endpoint receives the collection's own entry, so its
      // filter is live, and still never receives the plugin's event.
      const t = await boot(dialect);
      const scoped = await endpoint(t, ["*"]);
      await scopeTo(t, scoped, ["shop"]);

      await plugin().webhooks.record({ type: PAID, id: "ord_1", data: {} });
      const entry = await t.nextly.create({
        collection: "shop",
        data: { title: "A shop entry" },
      });
      await fanOut();

      expect((await deliveredIds(t)).get(scoped)).toEqual([
        String(entry.item.id),
      ]);
    });

    it("refuses a type the plugin did not declare, naming it, and writes nothing", async () => {
      const t = await boot(dialect);
      await endpoint(t, ["*"]);

      for (const type of ["shop.order.lost", BILLING_TYPE, "entry.created"]) {
        const refusal = await refusalOf(
          plugin().webhooks.record({ type, id: "ord_1", data: {} })
        );
        expect(refusal.logContext, type).toMatchObject({
          plugin: "shop",
          type,
        });
      }
      // Refused inside a transaction too, before its write, so the plugin's
      // transaction is not the one that discards it.
      await plugin().db.transaction(async tx => {
        await refusalOf(
          plugin().webhooks.record({
            type: BILLING_TYPE,
            id: "ord_1",
            data: {},
            tx,
          })
        );
      });
      await plugin().webhooks.record({ type: PAID, id: "ord_2", data: {} });

      expect((await events(t)).map(row => row.type)).toEqual([PAID]);
    });

    it("offers the fast drain once a recorded event commits, and never for a rolled-back one", async () => {
      // Core's write paths offer it after their event commits, so a plugin's
      // event is delivered as promptly as theirs rather than waiting for the
      // scheduled drain.
      const t = await boot(dialect);
      await endpoint(t, [PAID]);
      const offer = vi.spyOn(
        container.get<WebhookFastDrainScheduler>("webhookFastDrainScheduler"),
        "offer"
      );

      await expect(
        plugin().db.transaction(async tx => {
          await plugin().webhooks.record({
            type: PAID,
            id: "ord_rolled_back",
            data: {},
            tx,
          });
          throw new Error("the plugin's own work failed");
        })
      ).rejects.toThrow();
      expect(offer).not.toHaveBeenCalled();

      await plugin().db.transaction(async tx => {
        await plugin().webhooks.record({
          type: PAID,
          id: "ord_committed",
          data: {},
          tx,
        });
        // Held until the commit, so it has not been offered yet.
        expect(offer).not.toHaveBeenCalled();
      });
      expect(offer).toHaveBeenCalledTimes(1);

      await plugin().webhooks.record({ type: PAID, id: "ord_2", data: {} });
      expect(offer).toHaveBeenCalledTimes(2);
    });

    it("refuses an id longer than every dialect keeps, naming the field, and writes nothing", async () => {
      const t = await boot(dialect);
      await endpoint(t, ["*"]);

      const refusal = await refusalOf(
        plugin().webhooks.record({ type: PAID, id: "x".repeat(192), data: {} })
      );
      expect(
        (refusal.publicData as { errors?: Array<{ path?: string }> })?.errors
      ).toEqual([expect.objectContaining({ path: "id" })]);
      // The widest id kept is accepted, on every dialect alike.
      await plugin().webhooks.record({
        type: PAID,
        id: "y".repeat(191),
        data: {},
      });

      expect((await events(t)).map(row => envelopeOf(row).resource.id)).toEqual(
        ["y".repeat(191)]
      );
    });

    it("sends data as JSON: what JSON drops is dropped before the changed fields are worked out, and what it cannot hold is refused", async () => {
      const t = await boot(dialect);
      await endpoint(t, ["*"]);
      const cyclic: Record<string, unknown> = { name: "loop" };
      cyclic.self = cyclic;

      for (const [field, event] of [
        ["data", { data: { total: 10n } }],
        ["data", { data: cyclic }],
        ["previous", { data: {}, previous: { total: 10n } }],
        // An object whose own `toJSON` makes it no JSON object at all.
        ["data", { data: { toJSON: () => undefined } }],
        ["data", { data: { toJSON: () => ["not", "an", "object"] } }],
      ] as const) {
        const refusal = await refusalOf(
          plugin().webhooks.record({ type: PAID, id: "ord_1", ...event })
        );
        expect(
          (refusal.publicData as { errors?: Array<{ path?: string }> })?.errors,
          field
        ).toEqual([expect.objectContaining({ path: field })]);
      }
      expect(await events(t)).toEqual([]);

      await plugin().webhooks.record({
        type: PAID,
        id: "ord_2",
        data: { total: 42, note: undefined },
      });
      const [event] = await events(t);
      expect(event).toBeDefined();
      expect(envelopeOf(event as EventRow)).toMatchObject({
        data: { total: 42 },
        changedFields: ["total"],
      });
    });
  }
);

// Longer than the 20 characters `resource_kind` holds on PostgreSQL and
// MySQL, so the slug can only round-trip through the scope column, which is
// where it is kept.
const LONG_PLUGIN = "@acme/storefront-subscriptions";
const LONG_SLUG = "acme-storefront-subscriptions";
const RENEWAL = `${LONG_SLUG}.renewal.due`;

describe.each(getConfiguredTestDialects())(
  "a plugin's recorded webhook event in the delivery log (%s)",
  dialect => {
    it("is read back as the plugin's, with a slug over 20 characters, and never as a collection", async () => {
      let context: PluginContext | undefined;
      current = await createTestNextly({
        dialect,
        plugins: [
          definePlugin({
            name: LONG_PLUGIN,
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: { webhookEvents: [{ type: RENEWAL }] },
            init(ctx: PluginContext) {
              context = ctx;
            },
          }),
        ],
      });
      const t = current;
      if (!context) throw new Error("the plugin did not initialise");
      const subscribed = await endpoint(t, [RENEWAL]);

      await context.webhooks.record({
        type: RENEWAL,
        id: "sub_1",
        data: { plan: "yearly" },
      });
      await fanOut();

      const { items } = await t
        .getService("webhookDeliveryQueryService")
        .listDeliveries(subscribed, { page: 1, limit: 10 });
      expect(items.map(item => [item.eventType, item.resource])).toEqual([
        [
          RENEWAL,
          {
            kind: "plugin",
            plugin: LONG_SLUG,
            collection: null,
            id: "sub_1",
            locale: null,
          },
        ],
      ]);
    });
  }
);
