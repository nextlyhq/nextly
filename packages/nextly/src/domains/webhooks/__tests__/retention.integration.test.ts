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
  fannedOut: boolean
): Promise<void> {
  await handle.adapter.update(
    "nextly_events",
    {
      created_at: createdAt,
      fanned_out_at: fannedOut ? createdAt : null,
    },
    { and: [{ column: "id", op: "=", value: id }] }
  );
}

const OLD = new Date("2020-01-01T00:00:00.000Z");

describe("webhook retention (integration)", () => {
  it("writes events with the webhook retention class by default", async () => {
    // Audit-class rows only appear once the audit log exists; until then every
    // row takes the short window.
    const t = await boot();
    const handler = t.getService<CollectionsHandler>("collectionsHandler");
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "hello" }
    );

    const rows = await events(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].retentionClass).toBe("webhook");
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

  it("leaves an aged event alone while its fan-out has not run", async () => {
    // The row is old enough, but nothing has delivered it. Pruning here would
    // discard an event no subscriber ever saw.
    const t = await boot();
    const handler = t.getService<CollectionsHandler>("collectionsHandler");
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "never fanned out" }
    );
    const [row] = await events(t);
    await ageEvent(t, row.id, OLD, false);

    const result = await pruneWebhookData(
      { adapter: t.adapter },
      resolveWebhookRetentionConfig({})!
    );

    expect(result.events.webhook).toBe(0);
    expect(await events(t)).toHaveLength(1);
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
