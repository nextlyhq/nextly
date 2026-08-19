/**
 * Deleting a document removes EVERY language's pending change.
 *
 * Discarding a pending change and deleting the document it belongs to are two
 * different questions. Discard is one language's; delete is all of them. A
 * delete that removed only the unlocalized row would leave every other
 * language's draft behind, pointing at a row that no longer exists — invisible,
 * because nothing reads a draft for a document that is gone, right up until a
 * new document reuses the id or a retention sweep trips over it.
 *
 * The drafts are stored straight through the repository, which has always been
 * per-locale; only its callers were not. That is what lets this prove the
 * delete side before the write side is threaded through.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { VersionsRepository, type VersionRef } from "../versions-repository";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const COLLECTION = "orphanposts";

async function boot(): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    collections: [
      defineCollection({
        slug: COLLECTION,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return (
    handle.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

async function draftRowCount(entryId: string): Promise<number> {
  const rows = await handle!.adapter.select<{ id: string }>("nextly_versions", {
    where: {
      and: [
        { column: "entryId", op: "=", value: entryId },
        { column: "isAutosave", op: "=", value: false },
        { column: "versionNo", op: "IS NULL" },
        { column: "status", op: "=", value: "draft" },
      ],
    },
  });
  return rows.length;
}

/** Two pending changes for one document, in two different languages. */
async function seedTwoLanguages(entryId: string): Promise<void> {
  const repo = new VersionsRepository(handle!.adapter);
  const ref: VersionRef = {
    scopeKind: "collection",
    scopeSlug: COLLECTION,
    entryId,
  };
  await repo.upsertWorkingDraft({
    ref,
    locale: "en",
    snapshot: { title: "pending en" },
    createdBy: "u1",
  });
  await repo.upsertWorkingDraft({
    ref,
    locale: "es",
    snapshot: { title: "pending es" },
    createdBy: "u1",
  });
  // The fixture has to have worked, or "nothing was left behind" is trivially
  // true and this suite proves nothing.
  expect(await draftRowCount(entryId)).toBe(2);
}

describe("deleting a document removes every language's pending change", () => {
  it("through deleteEntry", async () => {
    const entries = await boot();
    const created = await entries.createEntry(
      { collectionName: COLLECTION, overrideAccess: true },
      { title: "live", status: "published" }
    );
    const id = (created.data as { id: string }).id;
    await seedTwoLanguages(id);

    await entries.deleteEntry({
      collectionName: COLLECTION,
      entryId: id,
      overrideAccess: true,
    });

    expect(await draftRowCount(id)).toBe(0);
  });

  it("through deleteEntryInTransaction", async () => {
    const entries = await boot();
    const created = await entries.createEntry(
      { collectionName: COLLECTION, overrideAccess: true },
      { title: "live", status: "published" }
    );
    const id = (created.data as { id: string }).id;
    await seedTwoLanguages(id);

    await handle!.adapter.transaction(tx =>
      entries.deleteEntryInTransaction(tx as never, {
        collectionName: COLLECTION,
        entryId: id,
      })
    );

    expect(await draftRowCount(id)).toBe(0);
  });
});
