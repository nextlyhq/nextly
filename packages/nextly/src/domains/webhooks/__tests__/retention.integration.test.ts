/**
 * Retention through the real write path.
 *
 * The unit suite pins the engine against a fake adapter. This proves the whole
 * chain: config resolution, the wiring that hangs a pass off a content write,
 * and the delete itself against a real database — including that an install
 * with no webhooks configured, which therefore never runs the drain, still gets
 * its event ledger bounded.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { pruneWebhookData } from "../prune";
import { resolveWebhookRetentionConfig } from "../retention-config";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface EventRow {
  id: string;
  retentionClass: string;
  fannedOutAt: Date | number | null;
}

async function events(handle: TestNextly): Promise<EventRow[]> {
  return handle.adapter.select<EventRow>("nextly_events");
}

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
    ],
  });
  return current;
}

/** Mark an event fanned out and backdate it, as an aged, delivered row would be. */
async function ageEvent(
  handle: TestNextly,
  id: string,
  createdAt: Date,
  fannedOut: boolean,
  // Stated per case rather than inherited. The test harness enables the audit
  // seam, so a recorded row is audit-class and would be measured against the
  // long window — a case about outbox hygiene has to say so, or it reads as
  // testing one window while exercising another.
  retentionClass: "webhook" | "audit" = "webhook"
): Promise<void> {
  await handle.adapter.update(
    "nextly_events",
    {
      created_at: createdAt,
      fanned_out_at: fannedOut ? createdAt : null,
      retention_class: retentionClass,
    },
    { and: [{ column: "id", op: "=", value: id }] }
  );
}

const OLD = new Date("2020-01-01T00:00:00.000Z");

describe("webhook retention (integration)", () => {
  it("records an audit-class row while the audit seam is on", async () => {
    // The class follows from WHY the row was recorded, and the harness enables
    // the audit seam. Nothing needs a row beyond delivery is webhook-class; this
    // one is needed for history, so it takes the long window.
    const t = await boot();
    const handler = t.getService<CollectionsHandler>("collectionsHandler");
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "hello" }
    );

    const rows = await events(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].retentionClass).toBe("audit");
  });

  it("keeps an audit-class row at an age that evicts a webhook-class one", async () => {
    // The class is the ONLY difference: both rows are the same age, in the same
    // pass, under the same config. One is past the webhook window and inside the
    // audit window, so the short window evicts one and not the other. Aged to 60
    // days for exactly that reason — past 30, inside 90.
    const t = await boot();
    const handler = t.getService<CollectionsHandler>("collectionsHandler");
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "kept" }
    );
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "evicted" }
    );
    const [kept, evicted] = await events(t);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await ageEvent(t, kept.id, sixtyDaysAgo, true, "audit");
    await ageEvent(t, evicted.id, sixtyDaysAgo, true, "webhook");

    const result = await pruneWebhookData(
      { adapter: t.adapter },
      resolveWebhookRetentionConfig({})!
    );

    expect(result.events.webhook).toBe(1);
    const remaining = await events(t);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(kept.id);
  });

  it("prunes an aged, fanned-out event", async () => {
    const t = await boot();
    const handler = t.getService<CollectionsHandler>("collectionsHandler");
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "old" }
    );
    const [row] = await events(t);
    await ageEvent(t, row.id, OLD, true);

    const result = await pruneWebhookData(
      { adapter: t.adapter },
      resolveWebhookRetentionConfig({})!
    );

    expect(result.events.webhook).toBe(1);
    expect(await events(t)).toHaveLength(0);
  });

  it("leaves an aged, un-fanned-out event alone while an endpoint exists", async () => {
    // The row is old enough, but an endpoint could still receive it and the
    // drain has not run. Pruning here would discard an event a subscriber is
    // owed.
    const t = await boot();
    const handler = t.getService<CollectionsHandler>("collectionsHandler");
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "never fanned out" }
    );
    const [row] = await events(t);
    await ageEvent(t, row.id, OLD, false);
    await t.adapter.insert("nextly_webhooks", {
      id: "wh-waiting",
      name: "endpoint",
      url: "https://example.test/hook",
      enabled: true,
      event_types: ["entry.created"],
      secret_hash: [],
      secret_prefix: "whsec_y",
    });

    const result = await pruneWebhookData(
      { adapter: t.adapter },
      resolveWebhookRetentionConfig({})!
    );

    expect(result.events.webhook).toBe(0);
    expect(await events(t)).toHaveLength(1);
  });

  it("prunes an aged, un-fanned-out event when no endpoint exists", async () => {
    // The majority install: no webhooks, so no drain ever runs and
    // fanned_out_at stays NULL forever. Requiring it would leave the ledger
    // unbounded for exactly the case retention was built for.
    const t = await boot();
    const handler = t.getService<CollectionsHandler>("collectionsHandler");
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "nobody is listening" }
    );
    const [row] = await events(t);
    await ageEvent(t, row.id, OLD, false);

    const result = await pruneWebhookData(
      { adapter: t.adapter },
      resolveWebhookRetentionConfig({})!
    );

    expect(result.events.webhook).toBe(1);
    expect(await events(t)).toHaveLength(0);
  });

  it("keeps a recent event", async () => {
    const t = await boot();
    const handler = t.getService<CollectionsHandler>("collectionsHandler");
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "fresh" }
    );
    const [row] = await events(t);
    // Fanned out, but written just now: inside the window.
    await ageEvent(t, row.id, new Date(), true);

    await pruneWebhookData(
      { adapter: t.adapter },
      resolveWebhookRetentionConfig({})!
    );

    expect(await events(t)).toHaveLength(1);
  });

  it("keeps everything when retention is switched off", async () => {
    const t = await boot();
    const handler = t.getService<CollectionsHandler>("collectionsHandler");
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "kept" }
    );
    const [row] = await events(t);
    await ageEvent(t, row.id, OLD, true);

    // `false` disables retention wholesale, so there is no policy to run.
    expect(resolveWebhookRetentionConfig(false)).toBeNull();
    expect(await events(t)).toHaveLength(1);
  });

  it("respects the audit class's own, longer window", async () => {
    // A row the audit log depends on outlives one that only drove a webhook,
    // which is the whole reason the class exists.
    const t = await boot();
    const handler = t.getService<CollectionsHandler>("collectionsHandler");
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "audit" }
    );
    const [row] = await events(t);
    await ageEvent(t, row.id, OLD, true);
    await t.adapter.update(
      "nextly_events",
      { retention_class: "audit" },
      { and: [{ column: "id", op: "=", value: row.id }] }
    );

    // Short webhook window, unlimited audit window.
    const result = await pruneWebhookData(
      { adapter: t.adapter },
      resolveWebhookRetentionConfig({
        eventsMaxAgeMs: 1,
        auditEventsMaxAgeMs: false,
      })!
    );

    expect(result.events.audit).toBe(0);
    expect(await events(t)).toHaveLength(1);
  });

  it("spares an event whose delivery is still live, against a real adapter", async () => {
    // The unit suite drives this through a fake, which cannot catch a column
    // projection that silently returns undefined. Only a real row proves the
    // guard holds — and the delivery FK cascades, so a guard that failed would
    // take a pending delivery with the event and the drain would never retry it.
    const t = await boot();
    const handler = t.getService<CollectionsHandler>("collectionsHandler");
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "has a live delivery" }
    );
    const [row] = await events(t);
    await ageEvent(t, row.id, OLD, true);

    await t.adapter.insert("nextly_webhooks", {
      id: "wh-live",
      name: "endpoint",
      url: "https://example.test/hook",
      enabled: true,
      event_types: ["entry.created"],
      secret_hash: [],
      secret_prefix: "whsec_x",
    });
    await t.adapter.insert("nextly_webhook_deliveries", {
      id: "dl-live",
      webhook_id: "wh-live",
      event_id: row.id,
      status: "retrying",
      attempt_count: 1,
    });

    const result = await pruneWebhookData(
      { adapter: t.adapter },
      resolveWebhookRetentionConfig({})!
    );

    expect(result.events.webhook).toBe(0);
    expect(await events(t)).toHaveLength(1);
    const deliveries = await t.adapter.select("nextly_webhook_deliveries");
    expect(deliveries).toHaveLength(1);
  });

  it("bounds a pass to the configured batch budget", async () => {
    const t = await boot();
    const handler = t.getService<CollectionsHandler>("collectionsHandler");
    for (let i = 0; i < 5; i += 1) {
      await handler.createEntry(
        { collectionName: "posts", overrideAccess: true },
        { title: `post ${i}` }
      );
    }
    for (const row of await events(t)) {
      await ageEvent(t, row.id, OLD, true);
    }

    // One batch of two, then stop — a pass must stay short on a serverless
    // request rather than deleting an unbounded backlog in one go.
    const result = await pruneWebhookData(
      { adapter: t.adapter },
      resolveWebhookRetentionConfig({ batchSize: 2, maxBatchesPerRun: 1 })!
    );

    expect(result.events.webhook).toBe(2);
    expect(result.truncated).toBe(true);
    expect(await events(t)).toHaveLength(3);
  });
});
