/**
 * Wiring test for automatic version capture on update.
 *
 * Proves that `updateEntry` (collections) and the single `update` path each
 * record a new `nextly_versions` snapshot inside the write transaction when the
 * schema opts into versioning, that the version number increments per document,
 * and that the snapshot reflects the updated values.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type VersionRow = {
  scopeKind: string;
  scopeSlug: string;
  entryId: string;
  versionNo: number;
  status: string;
  snapshot: unknown;
};

async function versions(handle: TestNextly, slug: string) {
  const rows = await handle.adapter.select<VersionRow>("nextly_versions");
  return rows
    .filter(r => r.scopeSlug === slug)
    .sort((a, b) => a.versionNo - b.versionNo);
}

describe("version capture on update (integration)", () => {
  it("captures a new version on each collection update (versionNo increments)", async () => {
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

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "v1" }
    );
    const id = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { title: "v2" }
    );

    const rows = await versions(current, "posts");
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.versionNo)).toEqual([1, 2]);
    // The second version snapshots the updated document.
    expect((rows[1].snapshot as { title?: string }).title).toBe("v2");
    expect(rows.every(r => r.entryId === id)).toBe(true);
  });

  it("captures a version on a single update when versioning is enabled", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "settings",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    await singles.update(
      "settings",
      { title: "hello" },
      { overrideAccess: true }
    );

    const rows = await versions(current, "settings");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const latest = rows[rows.length - 1];
    expect(latest.scopeKind).toBe("single");
    expect((latest.snapshot as { title?: string }).title).toBe("hello");
  });

  it("records no version when the schema does not opt in", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "notes",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "notes", overrideAccess: true },
      { title: "a" }
    );
    const id = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: "notes", entryId: id, overrideAccess: true },
      { title: "b" }
    );

    expect(await versions(current, "notes")).toHaveLength(0);
  });
});
