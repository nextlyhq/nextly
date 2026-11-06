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
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
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
import { WebhookEndpointRegistry } from "../endpoint-registry";
import { fanOutDueEvents } from "../fan-out";
import type { WebhookDeliveryQueryService } from "../services/webhook-delivery-query-service";
import type { WebhookEndpointService } from "../services/webhook-endpoint-service";
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

/** Register an endpoint, as the admin's form does, and return its id. */
async function endpoint(
  t: TestNextly,
  eventTypes: WebhookEventSubscription[]
): Promise<string> {
  const service = t.getService<WebhookEndpointService>(
    "webhookEndpointService"
  );
  const { endpoint: created } = await service.createEndpoint(
    { name: eventTypes.join(","), url: PUBLIC_URL, eventTypes },
    null
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

/** One fan-out pass, through a registry built fresh so it reads every endpoint as stored. */
function fanOut(t: TestNextly) {
  const registry = new WebhookEndpointRegistry(t.adapter);
  return fanOutDueEvents({
    db: t.adapter,
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
      await fanOut(t);

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
      await fanOut(t);

      expect((await deliveredIds(t)).get(paid)).toEqual(["ord_committed"]);
      expect((await events(t)).map(row => row.type)).toEqual([PAID]);
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
      await fanOut(t);

      expect((await deliveredIds(t)).get(scoped)).toEqual([
        String((entry as { id: unknown }).id),
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
      await fanOut(t);

      const { items } = await t
        .getService<WebhookDeliveryQueryService>("webhookDeliveryQueryService")
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
