/**
 * End-to-end proof that collection status transitions emit the lifecycle
 * webhook events (`entry.published` / `entry.unpublished` / `entry.status_changed`)
 * into the outbox, inside the write transaction. The `nextly_events` row carries
 * the event type in `type` and the full delivery envelope (with the new
 * `statusChange`) in `payload`.
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
  type: string;
  payload: unknown;
}

async function events(handle: TestNextly): Promise<EventRow[]> {
  return handle.adapter.select<EventRow>("nextly_events");
}

/** Envelope JSON, tolerant of a driver that returns `payload` as text or object. */
function envelopeOf(row: EventRow): Record<string, unknown> {
  return typeof row.payload === "string"
    ? (JSON.parse(row.payload) as Record<string, unknown>)
    : (row.payload as Record<string, unknown>);
}

describe("collection status webhook events (integration)", () => {
  it("create-as-published emits entry.created + entry.published, no status_changed", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const res = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "hello", status: "published" }
    );
    expect(res.success).toBe(true);

    const rows = await events(current);
    const types = rows.map(r => r.type).sort();
    expect(types).toEqual(["entry.created", "entry.published"]);
    expect(types).not.toContain("entry.status_changed");

    const published = rows.find(r => r.type === "entry.published")!;
    expect(envelopeOf(published).statusChange).toEqual({
      from: null,
      to: "published",
    });
  });
});
