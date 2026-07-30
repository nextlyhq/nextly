/**
 * The per-collection webhook recording opt-out, end to end.
 *
 * Proves the privacy contract at the real write path: a collection that sets
 * `webhooks: false` records NO outbox event on create/update/delete, while a
 * normal collection records one per write. The opt-out is what keeps PII-bearing
 * content (form submissions carry ipAddress/userAgent) out of the delivery path.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, group, password, text } from "../../../config";
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
    expect(lead.success).toBe(true);
    const leadId = (lead.data as { id: string }).id;
    // ...nor on update. The update still busts its cache tags, though: recording
    // is decoupled from revalidation, so an opted-out write that commits content
    // must still carry a revalidation intent (the tags derive from the write, not
    // the outbox event) — otherwise ISR consumers would serve the stale value.
    const updated = await handler.updateEntry(
      { collectionName: "leads", entryId: leadId, overrideAccess: true },
      { title: "secret-2" }
    );
    expect(updated.success).toBe(true);
    expect(updated.revalidationIntent).toBeDefined();
    // ...nor on delete. Asserting each write succeeded keeps the zero-event
    // check below from passing vacuously on a write that failed pre-recording.
    const deleted = await handler.deleteEntry({
      collectionName: "leads",
      entryId: leadId,
      overrideAccess: true,
    });
    expect(deleted.success).toBe(true);

    const rows = await events(current);
    // Only the single `posts` create is in the outbox; no `leads` event at all.
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceId).toBe(postId);
    expect(rows.some(r => r.resourceId === leadId)).toBe(false);
  });

  it("emits a curated, metadata-only event via webhooks.emit while suppressing entry.created and its PII", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "leads",
          // Suppress the PII-bearing entry.* events and instead emit a curated
          // form.submission.created carrying only the allowlisted `title`.
          webhooks: {
            record: false,
            emit: { event: "form.submission.created", fields: ["title"] },
          },
          fields: [text({ name: "title" }), text({ name: "secretAnswer" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const lead = await handler.createEntry(
      { collectionName: "leads", overrideAccess: true },
      { title: "Contact form", secretAnswer: "my private answer" }
    );
    expect(lead.success).toBe(true);
    const leadId = (lead.data as { id: string }).id;

    const rows = await current.adapter.select<{
      type: string;
      resourceKind: string;
      resourceId: string;
      payload: unknown;
    }>("nextly_events");

    // Exactly one event: the curated form.submission.created — never the
    // suppressed entry.created for the same write.
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("form.submission.created");
    expect(rows[0].resourceKind).toBe("form");
    expect(rows[0].resourceId).toBe(leadId);

    // The payload carries ONLY the allowlisted metadata — never the secret answer.
    const payload = (
      typeof rows[0].payload === "string"
        ? JSON.parse(rows[0].payload)
        : rows[0].payload
    ) as { data: Record<string, unknown> };
    expect(payload.data).toEqual({ title: "Contact form" });
    expect(JSON.stringify(rows[0])).not.toMatch(
      /secretAnswer|my private answer/
    );
  });

  it("strips a sensitive field nested inside a curated event's allowlisted subtree", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "leads",
          // Allowlist the whole `contact` group; the curated payload must still
          // drop its nested password (default-deny picks the subtree, then
          // sensitive-field stripping removes the secret inside it).
          webhooks: {
            record: false,
            emit: { event: "form.submission.created", fields: ["contact"] },
          },
          fields: [
            group({
              name: "contact",
              fields: [text({ name: "name" }), password({ name: "secret" })],
            }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const lead = await handler.createEntry(
      { collectionName: "leads", overrideAccess: true },
      { contact: { name: "Ada", secret: "Sup3r-Secret-Pw!" } }
    );
    expect(lead.success).toBe(true);

    const rows = await current.adapter.select<{
      type: string;
      payload: unknown;
    }>("nextly_events");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("form.submission.created");
    const payload = (
      typeof rows[0].payload === "string"
        ? JSON.parse(rows[0].payload)
        : rows[0].payload
    ) as { data: { contact?: Record<string, unknown> } };
    // The allowlisted group ships its safe field but never the nested password.
    expect(payload.data.contact?.name).toBe("Ada");
    expect(payload.data.contact ?? {}).not.toHaveProperty("secret");
    expect(JSON.stringify(rows[0])).not.toMatch(/Sup3r-Secret-Pw/);
  });
});
