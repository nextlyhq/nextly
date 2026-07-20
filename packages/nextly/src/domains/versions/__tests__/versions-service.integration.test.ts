/**
 * The public read surface: metadata-only listing (snapshots never travel with a
 * list) and single-version fetch with a typed not-found error.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { VersionsService } from "../versions-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function seed(): Promise<{ id: string; handle: TestNextly }> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "posts",
        versions: true,
        fields: [text({ name: "title" })],
      }),
    ],
  });
  const handler = current.getService<CollectionsHandler>("collectionsHandler");
  const created = await handler.createEntry(
    { collectionName: "posts", overrideAccess: true },
    { title: "v1" }
  );
  const id = (created.data as { id: string }).id;
  for (const title of ["v2", "v3"]) {
    await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { title }
    );
  }
  return { id, handle: current };
}

describe("VersionsService (integration)", () => {
  it("lists versions newest-first without loading snapshots", async () => {
    const { id, handle } = await seed();
    const versions = handle.getService<VersionsService>("versionsService");

    const rows = await versions.list({
      scopeKind: "collection",
      scopeSlug: "posts",
      entryId: id,
    });

    expect(rows.map(r => r.versionNo)).toEqual([3, 2, 1]);
    // Metadata only: the snapshot column must never be projected into a list.
    expect(rows.every(r => !("snapshot" in r))).toBe(true);
  });

  it("honours limit and cursor for keyset pagination", async () => {
    const { id, handle } = await seed();
    const versions = handle.getService<VersionsService>("versionsService");
    const ref = {
      scopeKind: "collection" as const,
      scopeSlug: "posts",
      entryId: id,
    };

    const firstPage = await versions.list(ref, { limit: 2 });
    expect(firstPage.map(r => r.versionNo)).toEqual([3, 2]);

    const nextPage = await versions.list(ref, { limit: 2, cursor: 2 });
    expect(nextPage.map(r => r.versionNo)).toEqual([1]);
  });

  it("gets a single version including its snapshot", async () => {
    const { id, handle } = await seed();
    const versions = handle.getService<VersionsService>("versionsService");

    const version = await versions.get(
      { scopeKind: "collection", scopeSlug: "posts", entryId: id },
      1
    );

    expect(version.versionNo).toBe(1);
    expect((version.snapshot as { title?: string }).title).toBe("v1");
  });

  it("rejects cursor paging combined with autosave rows", async () => {
    // Autosave rows carry a NULL versionNo, so they can never satisfy
    // `versionNo < cursor`. Returning a quietly short page would be worse than
    // refusing the combination.
    const { id, handle } = await seed();
    const versions = handle.getService<VersionsService>("versionsService");

    await expect(
      versions.list(
        { scopeKind: "collection", scopeSlug: "posts", entryId: id },
        { cursor: 3, includeAutosave: true }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("throws a not-found error for a missing version", async () => {
    const { id, handle } = await seed();
    const versions = handle.getService<VersionsService>("versionsService");

    await expect(
      versions.get(
        { scopeKind: "collection", scopeSlug: "posts", entryId: id },
        99
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
