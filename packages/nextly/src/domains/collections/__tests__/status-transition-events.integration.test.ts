/**
 * Status lifecycle events fired by the write path.
 *
 * The `transitionStatus` seam adds a general `document.statusTransition` event
 * (for workflows) while preserving the specific `published` / `statusChanged`
 * events existing subscribers rely on. These tests pin both the new event and
 * the preserved behavior (no `statusChanged` on create-as-published).
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

const DOC_EVENTS = [
  "document.published",
  "document.statusChanged",
  "document.statusTransition",
] as const;

function recordEvents(handle: TestNextly): string[] {
  const seen: string[] = [];
  for (const name of DOC_EVENTS) {
    handle.events.on(name, () => seen.push(name));
  }
  return seen;
}

describe("document status-transition events (integration)", () => {
  it("create-as-published emits published + statusTransition, never statusChanged", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const seen = recordEvents(current);
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "x", status: "published" }
    );

    expect(seen).toContain("document.published");
    expect(seen).toContain("document.statusTransition");
    expect(seen).not.toContain("document.statusChanged");
  });

  it("create-as-draft emits no status events", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const seen = recordEvents(current);
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "x", status: "draft" }
    );

    expect(seen).toEqual([]);
  });

  it("update draft->published emits statusChanged + published + statusTransition", async () => {
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
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "x", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    const seen = recordEvents(current);
    await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { status: "published" }
    );

    expect(seen).toContain("document.statusChanged");
    expect(seen).toContain("document.published");
    expect(seen).toContain("document.statusTransition");
  });
});
