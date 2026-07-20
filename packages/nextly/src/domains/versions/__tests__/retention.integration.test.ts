/**
 * Retention enforcement through the real write path: the cap is applied in the
 * same transaction as the version insert, so a document never accumulates more
 * durable versions than configured.
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

type VersionRow = {
  scopeSlug: string;
  entryId: string;
  versionNo: number;
  status: string;
};

async function versionsFor(handle: TestNextly, slug: string) {
  const rows = await handle.adapter.select<VersionRow>("nextly_versions");
  return rows
    .filter(r => r.scopeSlug === slug)
    .sort((a, b) => a.versionNo - b.versionNo);
}

describe("version retention (integration)", () => {
  it("keeps only maxPerDoc durable versions, pruning oldest first", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: { maxPerDoc: 3 },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "v1" }
    );
    const id = (created.data as { id: string }).id;

    for (const title of ["v2", "v3", "v4", "v5"]) {
      await handler.updateEntry(
        { collectionName: "posts", entryId: id, overrideAccess: true },
        { title }
      );
    }

    const rows = await versionsFor(current, "posts");
    expect(rows).toHaveLength(3);
    // The three newest survive; 1 and 2 were pruned.
    expect(rows.map(r => r.versionNo)).toEqual([3, 4, 5]);
  });

  it("keeps every version when maxPerDoc is false", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: { maxPerDoc: false },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "v1" }
    );
    const id = (created.data as { id: string }).id;
    for (const title of ["v2", "v3", "v4"]) {
      await handler.updateEntry(
        { collectionName: "posts", entryId: id, overrideAccess: true },
        { title }
      );
    }

    expect(await versionsFor(current, "posts")).toHaveLength(4);
  });

  it("prunes per document, not across the collection", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: { maxPerDoc: 2 },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const a = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "a1" }
    );
    const b = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "b1" }
    );
    const aId = (a.data as { id: string }).id;
    const bId = (b.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId: aId, overrideAccess: true },
      { title: "a2" }
    );
    await handler.updateEntry(
      { collectionName: "posts", entryId: aId, overrideAccess: true },
      { title: "a3" }
    );

    const rows = await versionsFor(current, "posts");
    // Pruning is scoped per document: b is untouched by a's churn.
    expect(rows.filter(r => r.entryId === aId)).toHaveLength(2);
    expect(rows.filter(r => r.entryId === bId)).toHaveLength(1);
  });
});
