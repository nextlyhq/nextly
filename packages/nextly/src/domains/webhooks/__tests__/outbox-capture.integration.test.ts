/**
 * Outbox capture on collection writes.
 *
 * Proves the mutation seam appends a `nextly_events` row for a content change:
 * the event carries the assembled read-shape document, secret fields never
 * reach the payload, and the row is written for versioned and non-versioned
 * collections alike (webhooks are independent of versioning).
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, password, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { recordMutationEvent } from "../record-mutation-event";
import type { WebhookEvent } from "../types";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A `nextly_events` row as read back (Drizzle camelCases the columns). */
interface EventRow {
  id: string;
  type: string;
  resourceKind: string;
  resourceCollection: string | null;
  resourceId: string | null;
  payload: unknown;
  actorType: string | null;
  actorId: string | null;
}

/**
 * The stored envelope. The payload is written as a JSON string for cross-dialect
 * safety and comes back through the column's json codec, which parses it on some
 * dialects and not others — so accept either.
 */
function envelopeOf(row: EventRow): WebhookEvent {
  return (
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
  ) as WebhookEvent;
}

async function events(handle: TestNextly): Promise<EventRow[]> {
  return handle.adapter.select<EventRow>("nextly_events");
}

describe("webhook outbox capture (integration)", () => {
  it("records entry.created carrying the assembled document when versioning is OFF", async () => {
    // Versioning off is the case that regressed before: the document assembly
    // used to live inside the versioning branch, so nothing was available to
    // build an envelope from.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "hello" }
    );
    const id = (created.data as { id: string }).id;

    const rows = await events(current);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("entry.created");
    expect(rows[0].resourceKind).toBe("entry");
    expect(rows[0].resourceCollection).toBe("posts");
    expect(rows[0].resourceId).toBe(id);

    const envelope = envelopeOf(rows[0]);
    expect(envelope.data.title).toBe("hello");
    // Create has no prior state, and every present key counts as changed.
    expect(envelope.previous).toBeNull();
    expect(envelope.changedFields).toContain("title");
    expect(envelope.resource).toMatchObject({
      kind: "entry",
      collection: "posts",
    });
  });

  it("records the event for a versioned collection too (one assembly, both consumers)", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "v1" }
    );

    const rows = await events(current);
    expect(rows).toHaveLength(1);
    expect(envelopeOf(rows[0]).data.title).toBe("v1");
    // The version snapshot still lands alongside it.
    const versions = await current.adapter.select("nextly_versions");
    expect(versions).toHaveLength(1);
  });

  it("never ships a secret field in the payload", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "accounts",
          fields: [text({ name: "title" }), password({ name: "secret" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    await handler.createEntry(
      { collectionName: "accounts", overrideAccess: true },
      { title: "acct", secret: "SuperSecret123!" }
    );

    const rows = await events(current);
    expect(rows).toHaveLength(1);
    const envelope = envelopeOf(rows[0]);
    expect(envelope.data.title).toBe("acct");
    // Neither the value nor the field name survives into the envelope.
    expect(envelope.data).not.toHaveProperty("secret");
    expect(envelope.changedFields).not.toContain("secret");
    expect(JSON.stringify(envelope)).not.toContain("SuperSecret123!");
  });

  it("attributes the event to the acting identity, including an API key", async () => {
    // An API-key write must attribute to the key itself, not to the user that
    // owns it: durable history that says "a person did this" when a token did
    // is worse than no attribution.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    await handler.createEntry(
      {
        collectionName: "posts",
        overrideAccess: true,
        actor: { type: "apiKey", id: "key_abc" },
      },
      { title: "by key" }
    );

    const rows = await events(current);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorType).toBe("apiKey");
    expect(rows[0].actorId).toBe("key_abc");
    expect(envelopeOf(rows[0]).actor).toEqual({
      type: "apiKey",
      id: "key_abc",
    });
  });

  it("writes the event inside the caller's transaction, so a rollback drops it", async () => {
    // The outbox guarantee: an event must never outlive the change it describes,
    // or a webhook fires for something that never happened. Recording through the
    // caller's transaction handle is what enforces that, so roll one back and
    // assert the event went with it.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      ],
    });

    await expect(
      current.adapter.transaction(async tx => {
        await recordMutationEvent(tx, {
          type: "entry.created",
          resource: { kind: "entry", collection: "posts", id: "entry-1" },
          data: { title: "rolled back" },
          fields: [{ name: "title", type: "text" }],
        });
        throw new Error("force rollback");
      })
    ).rejects.toThrow("force rollback");

    expect(await events(current)).toHaveLength(0);
  });
});
