/**
 * Endpoint-gated outbox recording, end to end. With no enabled endpoint and the
 * audit seam off, a content write records nothing; creating an endpoint (or
 * enabling audit) resumes recording. Proves the perf/privacy contract at the
 * real write path.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { WebhookEndpointRegistry } from "../endpoint-registry";
import { setWebhookAuditEnabled } from "../recording-activation";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function eventCount(handle: TestNextly): Promise<number> {
  const rows = await handle.adapter.select<{ id: string }>("nextly_events");
  return rows.length;
}

async function makePost(handle: TestNextly): Promise<void> {
  const handler = handle.getService<CollectionsHandler>("collectionsHandler");
  await handler.createEntry(
    { collectionName: "posts", overrideAccess: true },
    { title: "hi" }
  );
}

async function seedEnabledEndpoint(handle: TestNextly): Promise<void> {
  await handle.adapter.insert("nextly_webhooks", {
    id: "w1",
    name: "w1",
    url: "https://example.com/w1",
    enabled: true,
    event_types: ["entry.created"],
    filter: null,
    headers: null,
    secret_hash: [],
    secret_prefix: "whsec_",
    field_allowlist: null,
    created_by: null,
    created_at: new Date("2020-01-01T00:00:00.000Z"),
    updated_at: new Date("2020-01-01T00:00:00.000Z"),
  });
  // The gate reads the registry's cached list; force a reload so the just-seeded
  // row is visible, exactly as the CRUD surface does on create.
  handle
    .getService<WebhookEndpointRegistry>("webhookEndpointRegistry")
    .invalidate();
}

describe("endpoint-gated outbox recording (integration)", () => {
  it("records nothing when there is no endpoint and audit is off", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      ],
    });
    // The harness defaults audit on so machinery tests are endpoint-independent;
    // this suite tests the gate, so turn it off.
    setWebhookAuditEnabled(false);
    await makePost(current);
    expect(await eventCount(current)).toBe(0);
  });

  it("records once an enabled endpoint exists", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      ],
    });
    setWebhookAuditEnabled(false);
    await seedEnabledEndpoint(current);
    await makePost(current);
    expect(await eventCount(current)).toBe(1);
  });

  it("records with no endpoint when the audit seam is on", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      ],
    });
    setWebhookAuditEnabled(true);
    await makePost(current);
    expect(await eventCount(current)).toBe(1);
  });

  it("stops recording after the last endpoint is disabled", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      ],
    });
    setWebhookAuditEnabled(false);
    await seedEnabledEndpoint(current);
    await makePost(current);
    expect(await eventCount(current)).toBe(1);

    // Disable the endpoint (SQLite stores booleans as 0/1) and invalidate, as a
    // disable through the CRUD surface would.
    await current.adapter.executeQuery(
      "UPDATE nextly_webhooks SET enabled = 0"
    );
    current
      .getService<WebhookEndpointRegistry>("webhookEndpointRegistry")
      .invalidate();
    await makePost(current);
    expect(await eventCount(current)).toBe(1); // no new row recorded
  });
});
