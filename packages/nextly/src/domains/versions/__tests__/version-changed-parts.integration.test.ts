/**
 * A version records which languages it changed and whether it changed the
 * shared part, so that what is kept of a document's history can be judged
 * part by part.
 *
 * Under per-language storage a document has one shared part and a part per
 * language. Each publish below puts a different set of them live, and the
 * version it records must name exactly that set: one language, several, the
 * shared part alone, and the shared part with a language. A held save records
 * the one part it wrote.
 *
 * Every case asserts both values, since "no language" alone is also what a
 * version recorded before these columns existed reads as.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, number, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

const POSTS = "partversions";
const SITE = "partversionsite";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

async function boot(dialect: TestDialect): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    dialect,
    perLanguageStorage: true,
    collections: [
      defineCollection({
        slug: POSTS,
        localized: true,
        status: true,
        versions: { drafts: true },
        // Translatable: `title`. Shared: `views`.
        fields: [text({ name: "title" }), number({ name: "views" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: SITE,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        // Translatable: `title`. Shared: `views`.
        fields: [text({ name: "title" }), number({ name: "views" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return (
    handle.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

/** The Single service of the instance `boot` started. */
function singlesOf(): SingleEntryService {
  return handle!.getService("singleEntryService");
}

/** Writes `data` to the Single in `locale`, as an editor's save does. */
async function saveSingle(
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  const saved = await singlesOf().update(
    SITE,
    { ...data, _overwrite: true },
    { locale, overrideAccess: true }
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

/** The Single published in English and Spanish; answers its id. */
async function singlePublishedInBoth(): Promise<string> {
  await saveSingle("en", { title: "en title", views: 10, status: "published" });
  await saveSingle("es", { title: "es title", status: "published" });
  const read = await singlesOf().get(SITE, {
    locale: "en",
    overrideAccess: true,
  });
  expect(read.success, JSON.stringify(read)).toBe(true);
  return (read.data as { id: string }).id;
}

/** Writes `data` to the entry in `locale`, as an editor's save does. */
async function save(
  entries: CollectionEntryService,
  id: string,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  const saved = await entries.updateEntry(
    { collectionName: POSTS, entryId: id, overrideAccess: true, locale },
    { ...data, _overwrite: true }
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

/** A document published in English and Spanish. */
async function publishedInBoth(
  entries: CollectionEntryService
): Promise<string> {
  const created = await entries.createEntry(
    { collectionName: POSTS, overrideAccess: true, locale: "en" },
    { title: "en title", views: 10, status: "published" }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  const id = (created.data as { id: string }).id;
  await save(entries, id, "es", { title: "es title", status: "published" });
  return id;
}

async function publishParts(
  entries: CollectionEntryService,
  id: string,
  parts: { locales: string[]; shared?: boolean }
): Promise<void> {
  const published = await entries.publishParts(
    {
      collectionName: POSTS,
      entryId: id,
      overrideAccess: true,
      data: { _overwrite: true },
    },
    { direction: "publish", ...parts }
  );
  expect(published.success, JSON.stringify(published)).toBe(true);
}

interface ChangedParts {
  locales: string[] | null;
  shared: boolean | null;
}

type StoredRow = {
  versionNo: number | null;
  locale: string | null;
  isAutosave: unknown;
  changedLocales?: unknown;
  sharedChanged?: unknown;
};

/** The parts a stored version row names, read as each dialect returns them. */
function partsOf(row: StoredRow | undefined): ChangedParts {
  const locales =
    typeof row?.changedLocales === "string"
      ? (JSON.parse(row.changedLocales) as string[])
      : (row?.changedLocales as string[] | null | undefined);
  const shared = row?.sharedChanged;
  return {
    locales: locales == null ? null : [...locales].sort(),
    // SQLite and MySQL return a boolean as 0 or 1.
    shared: shared == null ? null : shared === true || shared === 1,
  };
}

async function rowsOf(id: string): Promise<StoredRow[]> {
  return handle!.adapter.select<StoredRow>("nextly_versions", {
    where: { and: [{ column: "entryId", op: "=", value: id }] },
  });
}

/** The parts the entry's newest numbered version names. */
async function newestVersionParts(id: string): Promise<ChangedParts> {
  const newest = (await rowsOf(id))
    .filter(row => row.versionNo !== null)
    .sort((a, b) => Number(b.versionNo) - Number(a.versionNo))[0];
  return partsOf(newest);
}

/** The parts the entry's held draft in `slot` names (`null` is the shared draft). */
async function heldDraftParts(
  id: string,
  slot: string | null
): Promise<ChangedParts> {
  const held = (await rowsOf(id)).find(
    row => row.versionNo === null && row.locale === slot && !row.isAutosave
  );
  return partsOf(held);
}

describe.each(getConfiguredTestDialects())(
  "the parts a version records (%s)",
  dialect => {
    it("names the language and the shared part a first publish puts live", async () => {
      const entries = await boot(dialect);
      const created = await entries.createEntry(
        { collectionName: POSTS, overrideAccess: true, locale: "en" },
        { title: "en title", views: 10, status: "published" }
      );
      expect(created.success, JSON.stringify(created)).toBe(true);

      expect(
        await newestVersionParts((created.data as { id: string }).id)
      ).toEqual({ locales: ["en"], shared: true });
    }, 90_000);

    it("names one language, and not the shared part, for a publish of that language", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries);
      await save(entries, id, "es", { title: "es 2" });

      await publishParts(entries, id, { locales: ["es"] });

      expect(await newestVersionParts(id)).toEqual({
        locales: ["es"],
        shared: false,
      });
    }, 90_000);

    it("names one language for a publish made by saving in it", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries);
      await save(entries, id, "es", { title: "es 2" });

      await save(entries, id, "es", { status: "published" });

      expect(await newestVersionParts(id)).toEqual({
        locales: ["es"],
        shared: false,
      });
    }, 90_000);

    it("names every language a publish of several puts live", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries);
      await save(entries, id, "en", { title: "en 2" });
      await save(entries, id, "es", { title: "es 2" });

      await publishParts(entries, id, { locales: ["en", "es"] });

      expect(await newestVersionParts(id)).toEqual({
        locales: ["en", "es"],
        shared: false,
      });
    }, 90_000);

    it("names only the shared part for a publish of the shared part alone", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries);
      await save(entries, id, "es", { views: 40 });

      await publishParts(entries, id, { locales: [], shared: true });

      expect(await newestVersionParts(id)).toEqual({
        locales: [],
        shared: true,
      });
    }, 90_000);

    it("names the shared part with the language published beside it", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries);
      await save(entries, id, "es", { title: "es 2", views: 40 });

      await publishParts(entries, id, { locales: ["es"], shared: true });

      expect(await newestVersionParts(id)).toEqual({
        locales: ["es"],
        shared: true,
      });
    }, 90_000);

    it("names every language and the shared part for a publish of all of them", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries);
      await save(entries, id, "en", { title: "en 2" });
      await save(entries, id, "es", { title: "es 2", views: 60 });

      const published = await entries.publishAllLocales({
        data: { _overwrite: true },
        collectionName: POSTS,
        entryId: id,
        overrideAccess: true,
      });
      expect(published.success, JSON.stringify(published)).toBe(true);

      expect(await newestVersionParts(id)).toEqual({
        locales: ["en", "es"],
        shared: true,
      });
    }, 90_000);

    // A version names what changed: a language a publish of every language
    // had nothing pending in stays as it was, so it is not named.
    it("leaves out a language a publish of all of them had nothing to put live in", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries);
      await save(entries, id, "es", { title: "es 2", views: 60 });

      const published = await entries.publishAllLocales({
        data: { _overwrite: true },
        collectionName: POSTS,
        entryId: id,
        overrideAccess: true,
      });
      expect(published.success, JSON.stringify(published)).toBe(true);

      expect(await newestVersionParts(id)).toEqual({
        locales: ["es"],
        shared: true,
      });
    }, 90_000);

    it("names the one part a held save wrote", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries);

      await save(entries, id, "es", { title: "es 2", views: 40 });

      expect(await heldDraftParts(id, "es")).toEqual({
        locales: ["es"],
        shared: false,
      });
      expect(await heldDraftParts(id, null)).toEqual({
        locales: [],
        shared: true,
      });
    }, 90_000);

    it("names the shared part with the language for a Single published by saving in it", async () => {
      await boot(dialect);
      const id = await singlePublishedInBoth();
      await saveSingle("es", { title: "es 2", views: 40 });

      await saveSingle("es", { status: "published" });

      expect(await newestVersionParts(id)).toEqual({
        locales: ["es"],
        shared: true,
      });
    }, 90_000);

    it("names the language and the shared part whose pending changes a publish of every language of a Single puts live", async () => {
      await boot(dialect);
      const id = await singlePublishedInBoth();
      await saveSingle("es", { title: "es 2", views: 60 });

      const published = await singlesOf().publishAllLocales(SITE, {
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(published.success, JSON.stringify(published)).toBe(true);

      expect(await newestVersionParts(id)).toEqual({
        locales: ["es"],
        shared: true,
      });
    }, 90_000);
  }
);
