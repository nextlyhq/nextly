/**
 * Pending changes work per language.
 *
 * A localized document is a set of variants with their own lifecycle state, not
 * one document with one state. Editing the Spanish translation of a published
 * page holds the Spanish edit and leaves English alone; publishing Spanish
 * publishes Spanish. Until this worked, "Nextly has drafts" was a claim that
 * failed on the first multilingual site, because the split refused any
 * localized collection outright.
 *
 * Every "unaffected" assertion is paired with a positive one in the same case.
 * "English is untouched" is satisfied just as well by a system that stores no
 * pending change at all, so each case also proves the Spanish one exists.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../../services/collections-handler";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const COLLECTION = "langposts";

async function boot(): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    collections: [
      defineCollection({
        slug: COLLECTION,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" }), text({ name: "body" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return (
    handle.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

/** A document published in both languages. */
async function publishBoth(entries: CollectionEntryService): Promise<string> {
  const created = await entries.createEntry(
    { collectionName: COLLECTION, overrideAccess: true, locale: "en" },
    { title: "en title", body: "en body", status: "published" }
  );
  const id = (created.data as { id: string }).id;
  await entries.updateEntry(
    {
      collectionName: COLLECTION,
      entryId: id,
      overrideAccess: true,
      locale: "es",
    },
    { title: "es title", body: "es body", status: "published" }
  );
  return id;
}

/** Pending changes for a document, by the language they are keyed under. */
async function pendingLocales(entryId: string): Promise<string[]> {
  const rows = await handle!.adapter.select<{ locale: string | null }>(
    "nextly_versions",
    {
      where: {
        and: [
          { column: "entryId", op: "=", value: entryId },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NULL" },
          { column: "status", op: "=", value: "draft" },
        ],
      },
    }
  );
  return rows.map(r => r.locale ?? "(none)").sort();
}

async function readDraftBody(
  entries: CollectionEntryService,
  id: string,
  locale: string
): Promise<unknown> {
  const res = await entries.getEntry({
    collectionName: COLLECTION,
    entryId: id,
    overrideAccess: true,
    locale,
    includeWorkingDraft: true,
  });
  return (res.data as { body?: unknown } | null)?.body;
}

async function readBody(
  entries: CollectionEntryService,
  id: string,
  locale: string
): Promise<unknown> {
  const res = await entries.getEntry({
    collectionName: COLLECTION,
    entryId: id,
    overrideAccess: true,
    locale,
  });
  return (res.data as { body?: unknown } | null)?.body;
}

describe("pending changes per language (integration)", () => {
  it("holds a Spanish edit under Spanish and leaves English alone", async () => {
    const entries = await boot();
    const id = await publishBoth(entries);

    await entries.updateEntry(
      {
        collectionName: COLLECTION,
        entryId: id,
        overrideAccess: true,
        locale: "es",
      },
      { body: "es edited" }
    );

    // The positive half: the pending change exists, keyed under Spanish.
    expect(await pendingLocales(id)).toEqual(["es"]);
    // The negative half, which alone would prove nothing.
    expect(await readBody(entries, id, "en")).toBe("en body");
  });

  it("keeps two languages' pending changes apart", async () => {
    const entries = await boot();
    const id = await publishBoth(entries);

    await entries.updateEntry(
      {
        collectionName: COLLECTION,
        entryId: id,
        overrideAccess: true,
        locale: "es",
      },
      { body: "es edited" }
    );
    await entries.updateEntry(
      {
        collectionName: COLLECTION,
        entryId: id,
        overrideAccess: true,
        locale: "en",
      },
      { body: "en edited" }
    );

    expect(await pendingLocales(id)).toEqual(["en", "es"]);
    // Neither live translation moved.
    expect(await readBody(entries, id, "es")).toBe("es body");
    expect(await readBody(entries, id, "en")).toBe("en body");
  });

  it("publishes the language being published, and only that one", async () => {
    const entries = await boot();
    const id = await publishBoth(entries);

    await entries.updateEntry(
      {
        collectionName: COLLECTION,
        entryId: id,
        overrideAccess: true,
        locale: "es",
      },
      { body: "es edited" }
    );
    await entries.updateEntry(
      {
        collectionName: COLLECTION,
        entryId: id,
        overrideAccess: true,
        locale: "en",
      },
      { body: "en edited" }
    );

    const published = await entries.updateEntry(
      {
        collectionName: COLLECTION,
        entryId: id,
        overrideAccess: true,
        locale: "es",
      },
      { status: "published" }
    );
    // Assert the operation SUCCEEDED before asserting its effects: a soft
    // failure would otherwise read as "the promote did nothing".
    expect({
      success: published.success,
      message: published.message,
    }).toEqual({ success: true, message: expect.any(String) });

    // Spanish went live and its pending change is gone; English is still
    // pending and its live content is unchanged.
    expect(await readBody(entries, id, "es")).toBe("es edited");
    expect(await pendingLocales(id)).toEqual(["en"]);
    expect(await readBody(entries, id, "en")).toBe("en body");
  });

  it("holds an edit that names no language, under the default", async () => {
    // The admin omits `?locale=` when editing the default language, so this is
    // the ordinary path rather than an edge case. A localized document whose
    // request names no locale still lands somewhere — the default language —
    // and its pending change has to key there too. Treating "unnamed" as
    // "unknown" refuses the hold and puts the edit straight on the live site,
    // which is the opposite of what the author asked for.
    const entries = await boot();
    const id = await publishBoth(entries);

    const res = await entries.updateEntry(
      { collectionName: COLLECTION, entryId: id, overrideAccess: true },
      { body: "edited with no locale named" }
    );
    expect(res.success).toBe(true);

    expect(await pendingLocales(id)).toEqual(["en"]);
    expect(await readBody(entries, id, "en")).toBe("en body");
  });

  it("shows the pending change to an editor, per language", async () => {
    // Holding the edit is only half the feature. An author who saves and then
    // sees their own words replaced by the published ones has been told the
    // save did nothing. The draft view has to return the pending content for
    // the language being edited — and only that language.
    const entries = await boot();
    const id = await publishBoth(entries);

    await entries.updateEntry(
      {
        collectionName: COLLECTION,
        entryId: id,
        overrideAccess: true,
        locale: "es",
      },
      { body: "es pending" }
    );

    expect(await readDraftBody(entries, id, "es")).toBe("es pending");
    // English has nothing pending, so its draft view is the published content —
    // without this the assertion above would pass against an overlay that
    // returned the pending values for every language.
    expect(await readDraftBody(entries, id, "en")).toBe("en body");
    // And a plain read still shows the public content.
    expect(await readBody(entries, id, "es")).toBe("es body");
  });
});
