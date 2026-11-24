/**
 * An entry of a collection that is not translated, under the storage every
 * installation now has: its translatable fields kept in its per-language
 * table, and its held edits kept by part (`part-drafts`).
 *
 * - A live update answers with the whole entry. The update reads the main row
 *   back, which holds no title any more, so the answer lays the language's
 *   values over it.
 * - A discard removes the entry's whole pending change. Its held edit is kept
 *   under no language (the shared draft), beside the default language's
 *   draft, and a discard that removed only the language's left it pending.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../../__tests__/fixtures/permission-holders";
import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import { defineCollection, number, text } from "../../../../config";
import {
  asCaller,
  sessionCaller,
} from "../../../../dispatcher/__tests__/request-caller";
import { discardWorkingDraftForDocument } from "../../../../dispatcher/handlers/versions-methods";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";

perLanguageStorageSuite();

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const COLLECTION = "posts";
const TABLE = "dc_posts";

/** A drafts-enabled collection with a translatable and a shared field. */
async function boot(): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    collections: [
      defineCollection({
        slug: COLLECTION,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [text({ name: "title" }), number({ name: "rank" })],
      }),
    ],
  });
  return handle
    .getService("collectionsHandler")
    .getEntryService() as CollectionEntryService;
}

const trusted = { collectionName: COLLECTION, overrideAccess: true };

/** A published entry, by id. */
async function published(entries: CollectionEntryService): Promise<string> {
  await entries.createEntry(trusted, {
    title: "live",
    rank: 1,
    status: "published",
  });
  const [row] = await handle!.adapter.select<{ id: string }>(TABLE);
  return row.id;
}

/** The languages the entry's working drafts are kept under, `""` for none. */
async function draftSlots(id: string): Promise<string[]> {
  const rows = await handle!.adapter.select<{ locale: string | null }>(
    "nextly_versions",
    {
      where: {
        and: [
          { column: "entryId", op: "=", value: id },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NULL" },
          { column: "status", op: "=", value: "draft" },
        ],
      },
    }
  );
  return rows.map(row => row.locale ?? "").sort();
}

describe("an untranslated entry kept per language (integration)", () => {
  it("answers a live update with the translatable values it did not write", async () => {
    const entries = await boot();
    const id = await published(entries);

    const res = await entries.updateEntry(
      { ...trusted, entryId: id },
      { rank: 2, status: "published", _overwrite: true }
    );

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ title: "live", rank: 2 });
  });

  it("removes the entry's whole held edit on a discard", async () => {
    const entries = await boot();
    await userWhoMay(handle!, "editor-1", "read", [COLLECTION]);
    await grantTo(handle!, "editor-1", "update", [COLLECTION]);
    const id = await published(entries);
    await entries.updateEntry(
      { ...trusted, entryId: id },
      { rank: 2, title: "edited-in-draft", _overwrite: true }
    );
    // POPULATION CONTROL: the held edit is the shared draft, kept under no
    // language, which a discard of the default language's alone leaves.
    expect(await draftSlots(id)).toContain("");

    const discarded = await asCaller(
      sessionCaller({ userId: "editor-1" }),
      () =>
        discardWorkingDraftForDocument({
          scopeKind: "collection",
          slug: COLLECTION,
          entryId: id,
          user: { id: "editor-1" },
          version: { _overwrite: true },
          params: { collectionName: COLLECTION, entryId: id },
        })
    );

    expect(await draftSlots(id)).toEqual([]);
    expect(discarded).toMatchObject({ title: "live", rank: 1 });
  });
});
