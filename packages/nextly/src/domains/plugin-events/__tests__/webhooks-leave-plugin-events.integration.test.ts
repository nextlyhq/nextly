/**
 * The webhook outbox and plugins' durable events are separate stores, on every
 * dialect: webhook fan-out, delivery and retention never touch a plugin event
 * or its deliveries, and dispatching and pruning plugin events never touch the
 * webhook outbox. Each side's rows are old enough, and finished, that a sweep
 * reaching the wrong table would remove them.
 *
 * @module domains/plugin-events/__tests__/webhooks-leave-plugin-events.integration.test
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import {
  bootTwoInstances,
  type TwoInstances,
} from "../../../plugins/__tests__/helpers/two-instances";
import { definePlugin } from "../../../plugins/plugin-context";
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";
import {
  runWebhookDrain,
  type WebhookDrainDatabase,
} from "../../webhooks/drain-runner";
import {
  WebhookEndpointRegistry,
  type WebhookEndpointReader,
} from "../../webhooks/endpoint-registry";
import { buildEnvelope } from "../../webhooks/envelope";
import { pruneWebhookData } from "../../webhooks/prune";
import { recordEvent } from "../../webhooks/record-event";
import { resolveWebhookRetentionConfig } from "../../webhooks/retention-config";
import { dispatchDurableEvents } from "../dispatch";
import {
  createDurableEventRecorder,
  durableEventNames,
} from "../durable-events";
import { prunePluginEvents } from "../prune";
import { createDurableSubscribers } from "../subscribers";

let current: TwoInstances | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const OWNER = "@test/orders";
const PAID = "test-orders.paid";
const EVENTS = [{ name: PAID, durable: true as const }];
/** A whole second, as SQLite keeps it. */
const T0 = new Date("2026-10-15T00:00:00.000Z");
const DAY = 24 * 3600 * 1000;
/** Long after every row here is past every window. */
const LATER = new Date(T0.getTime() + 400 * DAY);

describe.each(getConfiguredTestDialects())(
  "webhooks and plugin events (%s)",
  dialect => {
    it("webhook fan-out and prune never touch plugin events, and the reverse", async () => {
      current = await bootTwoInstances(dialect, {
        plugins: [
          definePlugin({
            name: OWNER,
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: { events: EVENTS },
          }),
        ],
      });
      const db = current.first.adapter as unknown as DrizzleAdapter;
      expect(db.dialect).toBe(dialect);
      const count = async (table: string) =>
        (await db.select<{ id: string }>(table, { columns: ["id"] })).length;

      // A plugin event delivered and finished at T0.
      const events = createDurableEventRecorder({
        owner: OWNER,
        durable: durableEventNames(EVENTS),
        adapter: () => db,
        now: () => T0,
      });
      const subscribers = createDurableSubscribers();
      subscribers.register("@test/email", PAID, "receipt", () => {});
      await events.record(PAID, { order: "o-1" });
      // A webhook event from the same moment.
      await db.transaction(tx =>
        recordEvent(tx, {
          envelope: buildEnvelope({
            id: "evt_leave",
            type: "entry.updated",
            timestamp: T0,
            resource: { kind: "entry", collection: "posts", id: "p1" },
            data: { id: "p1" },
          }),
        })
      );

      // The webhook side: fan-out, delivery and the tightest retention, on
      // the same adapter, as the container hands the drain its own.
      const raw: unknown = current.first.adapter;
      await runWebhookDrain(
        raw as WebhookDrainDatabase,
        new WebhookEndpointRegistry(raw as WebhookEndpointReader),
        {
          now: () => LATER,
          decryptSecret: secret => secret,
        }
      );
      const tightest = resolveWebhookRetentionConfig({
        eventsMaxAgeMs: 1000,
        auditEventsMaxAgeMs: 1000,
        deliveriesMaxAgeMs: 1000,
      });
      expect(tightest).not.toBeNull();
      await pruneWebhookData({ adapter: db, now: () => LATER }, tightest!);
      expect(await count("nextly_events")).toBe(0);
      expect(await count("nextly_plugin_events")).toBe(1);

      // The plugin side, on a fresh webhook event: dispatch, which finishes
      // the plugin event, then its prune long after.
      await db.transaction(tx =>
        recordEvent(tx, {
          envelope: buildEnvelope({
            id: "evt_stays",
            type: "entry.updated",
            timestamp: T0,
            resource: { kind: "entry", collection: "posts", id: "p2" },
            data: { id: "p2" },
          }),
        })
      );
      expect(
        await dispatchDurableEvents({ adapter: db, subscribers, now: () => T0 })
      ).toMatchObject({ fannedOut: 1, delivered: 1 });
      expect(await count("nextly_plugin_event_deliveries")).toBe(1);
      expect(await prunePluginEvents(db, LATER)).toMatchObject({ removed: 1 });
      expect(await count("nextly_plugin_events")).toBe(0);
      expect(await count("nextly_plugin_event_deliveries")).toBe(0);
      expect(await count("nextly_events")).toBe(1);
    });
  }
);
