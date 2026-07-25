/**
 * The per-collection webhook recording opt-out, end to end.
 *
 * Proves the privacy contract at the real write path: a collection that sets
 * `webhooks: false` records NO outbox event on create/update/delete, while a
 * normal collection records one per write. The opt-out is what keeps PII-bearing
 * content (form submissions carry ipAddress/userAgent) out of the delivery path.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface EventRow {
  resourceType: string;
  resourceId: string;
}

async function events(handle: TestNextly): Promise<EventRow[]> {
  return handle.adapter.select<EventRow>("nextly_events");
}

describe("webhook recording opt-out (integration)", () => {
  it("records no outbox event for a collection with webhooks:false, across create/update/delete", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "leads",
          webhooks: false,
          fields: [text({ name: "title" })],
        }),
        defineCollection({
          slug: "posts",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    // A normal collection records one event per write (baseline).
    const post = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "hello" }
    );
    const postId = (post.data as { id: string }).id;

    // The opted-out collection records nothing on create...
    const lead = await handler.createEntry(
      { collectionName: "leads", overrideAccess: true },
      { title: "secret" }
    );
    const leadId = (lead.data as { id: string }).id;
    // ...nor on update...
    await handler.updateEntry(
      { collectionName: "leads", entryId: leadId, overrideAccess: true },
      { title: "secret-2" }
    );
    // ...nor on delete.
    await handler.deleteEntry({
      collectionName: "leads",
      entryId: leadId,
      overrideAccess: true,
    });

    const rows = await events(current);
    // Only the single `posts` create is in the outbox; no `leads` event at all.
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceId).toBe(postId);
    expect(rows.some(r => r.resourceId === leadId)).toBe(false);
  });
});
