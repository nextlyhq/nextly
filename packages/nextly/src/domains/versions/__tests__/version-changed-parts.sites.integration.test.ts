/**
 * Every write that records a version row, and the parts that row names.
 *
 * One table: each row sets a document up, makes one write, and names the
 * `{ locales, shared }` the row that write records must hold. The rule each
 * expectation is read from:
 *
 * - a publish (or a takedown) names the parts it put live (or took down);
 * - a held save names the part it wrote, and a working draft's row the part
 *   its slot holds;
 * - a save in place names the language where it wrote a translated value, a
 *   component or that language's status, and the shared part where it wrote
 *   a shared value or the document's own status;
 * - a create names the shared row it begins and the language it wrote in;
 * - the snapshot a restore takes of what it replaces names no part;
 * - an autosave is a recovery point and names nothing (NULL);
 * - a discard records no version at all.
 *
 * Kept by part (`perLanguageStorage`) unless a row says `whole`, where a
 * document keeps one draft per language holding the whole document.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  number,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

/** Translatable: `title`. Shared: `views`. */
const POSTS = "sitesposts";
/** No translatable field of its own; only its component is kept per language. */
const BANNERED = "sitesbanners";
const BANNER = "sitesbanner";
/** Translatable: `title`. Shared: `views`. */
const SITE = "sitessite";
/** As `SITE`, with a translatable default its first read seeds. */
const SEEDED = "sitesseeded";

let handle: TestNextly | undefined;
afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

type Storage = "parts" | "whole";

async function boot(dialect: TestDialect, storage: Storage): Promise<void> {
  handle = await createTestNextly({
    dialect,
    perLanguageStorage: storage === "parts",
    collections: [
      defineCollection({
        slug: POSTS,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" }), number({ name: "views" })],
      }),
      defineCollection({
        slug: BANNERED,
        status: true,
        versions: { drafts: true },
        fields: [
          number({ name: "views" }),
          fieldGroup({ name: "banner", component: BANNER }),
        ],
      }),
    ],
    fieldGroups: [
      defineFieldGroup({
        slug: BANNER,
        localized: true,
        fields: [text({ name: "words" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: SITE,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [text({ name: "title" }), number({ name: "views" })],
      }),
      defineSingle({
        slug: SEEDED,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "title", defaultValue: "Untitled" }),
          number({ name: "views" }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
}

function entries(): CollectionEntryService {
  return (
    handle!.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

function singles(): SingleEntryService {
  return handle!.getService("singleEntryService");
}

function ok(result: { success: boolean }): void {
  expect(result.success, JSON.stringify(result)).toBe(true);
}

async function create(
  slug: string,
  locale: string,
  data: Record<string, unknown>
): Promise<string> {
  const created = await entries().createEntry(
    { collectionName: slug, overrideAccess: true, locale },
    data
  );
  ok(created);
  return (created.data as { id: string }).id;
}

async function save(
  slug: string,
  id: string,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  ok(
    await entries().updateEntry(
      { collectionName: slug, entryId: id, overrideAccess: true, locale },
      { ...data, _overwrite: true }
    )
  );
}

/** A post in English and Spanish, never published: saves go in place. */
async function draftPost(): Promise<string> {
  const id = await create(POSTS, "en", {
    title: "en title",
    views: 10,
    status: "draft",
  });
  await save(POSTS, id, "es", { title: "es title" });
  return id;
}

/** A post published in English and Spanish: saves without a status are held. */
async function publishedPost(): Promise<string> {
  const id = await create(POSTS, "en", {
    title: "en title",
    views: 10,
    status: "published",
  });
  await save(POSTS, id, "es", { title: "es title", status: "published" });
  return id;
}

/** A banner post with a Spanish component; published when `live`. */
async function bannerPost(live: boolean): Promise<string> {
  const id = await create(BANNERED, "en", {
    views: 1,
    banner: { words: "hello" },
    status: live ? "published" : "draft",
  });
  await save(BANNERED, id, "es", {
    banner: { words: "hola" },
    ...(live ? { status: "published" } : {}),
  });
  return id;
}

async function saveSingle(
  slug: string,
  locale: string,
  data: Record<string, unknown>
): Promise<string> {
  const saved = await singles().update(
    slug,
    { ...data, _overwrite: true },
    { locale, overrideAccess: true }
  );
  ok(saved);
  return (saved.data as { id: string }).id;
}

/** The Single in English and Spanish, published when `live`. */
async function site(live: boolean): Promise<string> {
  const status = live ? "published" : "draft";
  await saveSingle(SITE, "en", { title: "en title", views: 10, status });
  return saveSingle(SITE, "es", { title: "es title", status });
}

async function publishParts(
  id: string,
  parts: { locales: string[]; shared?: boolean },
  direction: "publish" | "unpublish" = "publish"
): Promise<void> {
  ok(
    await entries().publishParts(
      {
        collectionName: POSTS,
        entryId: id,
        overrideAccess: true,
        data: { _overwrite: true },
      },
      { direction, ...parts }
    )
  );
}

function everyLanguage(id: string, slug = POSTS) {
  return {
    collectionName: slug,
    entryId: id,
    overrideAccess: true,
    data: { _overwrite: true },
  };
}

async function rewrite(
  id: string,
  field: string,
  value: unknown,
  locale?: string
): Promise<void> {
  const read = await entries().getEntry({
    collectionName: POSTS,
    entryId: id,
    overrideAccess: true,
    ...(locale ? { locale } : {}),
  });
  ok(read);
  await entries().rewriteField({
    request: {
      collection: POSTS,
      id,
      field,
      ...(locale ? { locale } : {}),
      expectedVersion: (read.data as { _rev: string })._rev,
      set: { value },
      reason: "Renamed",
    },
    overrideAccess: true,
  });
}

type StoredRow = {
  versionNo: number | null;
  locale: string | null;
  isAutosave: unknown;
  changedLocales?: unknown;
  sharedChanged?: unknown;
};

interface Parts {
  locales: string[] | null;
  shared: boolean | null;
}

function partsOf(row: StoredRow | undefined): Parts {
  expect(row, "the row the write was to record").toBeDefined();
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

async function numbered(id: string): Promise<StoredRow[]> {
  return (await rowsOf(id))
    .filter(row => row.versionNo !== null)
    .sort((a, b) => Number(b.versionNo) - Number(a.versionNo));
}

/** Which row of the document a case reads. */
type Read =
  | "newest"
  | "before newest"
  | "first"
  | "autosave"
  | { draft: string | null };

async function readParts(id: string, read: Read): Promise<Parts> {
  if (read === "newest") return partsOf((await numbered(id))[0]);
  if (read === "before newest") return partsOf((await numbered(id))[1]);
  if (read === "first") return partsOf((await numbered(id)).at(-1));
  const rows = await rowsOf(id);
  if (read === "autosave") {
    return partsOf(rows.find(row => Boolean(row.isAutosave)));
  }
  return partsOf(
    rows.find(
      row =>
        row.versionNo === null && row.locale === read.draft && !row.isAutosave
    )
  );
}

interface Case {
  name: string;
  storage?: Storage;
  /** Sets the document up and makes the write; answers the document's id. */
  run(): Promise<string>;
  read?: Read;
  expected: Parts;
}

const p = (locales: string[], shared: boolean): Parts => ({ locales, shared });

const CASES: Case[] = [
  // Creates.
  {
    name: "create, published, default language",
    run: () =>
      create(POSTS, "en", { title: "t", views: 1, status: "published" }),
    expected: p(["en"], true),
  },
  {
    name: "create, draft, non-default language",
    run: () => create(POSTS, "es", { title: "t", views: 1, status: "draft" }),
    expected: p(["es"], true),
  },
  {
    name: "create in a caller's transaction",
    run: async () => {
      const created = await handle!.adapter.transaction(tx =>
        entries().createEntryInTransaction(
          tx,
          { collectionName: POSTS, overrideAccess: true },
          { title: "t", views: 1 }
        )
      );
      ok(created);
      return (created.data as { id: string }).id;
    },
    expected: p(["en"], true),
  },
  {
    name: "create, component-only translations",
    run: () => create(BANNERED, "es", { views: 1, banner: { words: "hola" } }),
    expected: p(["es"], true),
  },
  {
    name: "Single default row, seeded with a translated default",
    run: async () => {
      const read = await singles().get(SEEDED, {
        locale: "en",
        overrideAccess: true,
      });
      ok(read);
      return (read.data as { id: string }).id;
    },
    read: "first",
    expected: p(["en"], true),
  },
  {
    // A Single kept per language seeds its default language's translation
    // row on its first read, values or none, so that language is written.
    name: "Single default row, no translated default given",
    run: async () => {
      const read = await singles().get(SITE, {
        locale: "en",
        overrideAccess: true,
      });
      ok(read);
      return (read.data as { id: string }).id;
    },
    read: "first",
    expected: p(["en"], true),
  },

  // Saves in place.
  {
    name: "in place, translated value, non-default language",
    run: async () => {
      const id = await draftPost();
      await save(POSTS, id, "es", { title: "es 2" });
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "in place, shared value, non-default language",
    run: async () => {
      const id = await draftPost();
      await save(POSTS, id, "es", { views: 40 });
      return id;
    },
    expected: p([], true),
  },
  {
    name: "in place, status only, non-default language",
    run: async () => {
      const id = await draftPost();
      await save(POSTS, id, "es", { status: "published" });
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "in place, status only, default language",
    run: async () => {
      const id = await draftPost();
      await save(POSTS, id, "en", { status: "published" });
      return id;
    },
    expected: p(["en"], true),
  },
  {
    name: "unpublish by saving, non-default language",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { status: "draft" });
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "unpublish by saving, default language",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "en", { status: "draft" });
      return id;
    },
    expected: p(["en"], true),
  },
  {
    name: "in place in a caller's transaction, shared value",
    run: async () => {
      const id = await draftPost();
      ok(
        await handle!.adapter.transaction(tx =>
          entries().updateEntryInTransaction(
            tx,
            { collectionName: POSTS, entryId: id, overrideAccess: true },
            { views: 41, _overwrite: true }
          )
        )
      );
      return id;
    },
    expected: p([], true),
  },
  {
    name: "in place in a caller's transaction, translated value",
    run: async () => {
      const id = await draftPost();
      ok(
        await handle!.adapter.transaction(tx =>
          entries().updateEntryInTransaction(
            tx,
            { collectionName: POSTS, entryId: id, overrideAccess: true },
            { title: "en 2", _overwrite: true }
          )
        )
      );
      return id;
    },
    expected: p(["en"], false),
  },
  {
    name: "in place in a caller's transaction, status only",
    run: async () => {
      const id = await draftPost();
      ok(
        await handle!.adapter.transaction(tx =>
          entries().updateEntryInTransaction(
            tx,
            { collectionName: POSTS, entryId: id, overrideAccess: true },
            { status: "published", _overwrite: true }
          )
        )
      );
      return id;
    },
    expected: p(["en"], true),
  },
  {
    name: "in place, component only, non-default language",
    run: async () => {
      const id = await bannerPost(false);
      await save(BANNERED, id, "es", { banner: { words: "hola 2" } });
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "in place, shared value of a component-only document",
    run: async () => {
      const id = await bannerPost(false);
      await save(BANNERED, id, "es", { views: 7 });
      return id;
    },
    expected: p([], true),
  },

  // Held saves, and the working drafts they write.
  {
    name: "held save, translated value",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2" });
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "held save, shared value",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { views: 40 });
      return id;
    },
    expected: p([], true),
  },
  {
    name: "held save, a language's draft row",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2", views: 40 });
      return id;
    },
    read: { draft: "es" },
    expected: p(["es"], false),
  },
  {
    name: "held save, the shared draft row",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2", views: 40 });
      return id;
    },
    read: { draft: null },
    expected: p([], true),
  },
  {
    name: "held save, component only",
    run: async () => {
      const id = await bannerPost(true);
      await save(BANNERED, id, "es", { banner: { words: "hola 2" } });
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "autosave",
    run: async () => {
      const id = await publishedPost();
      await handle!.getService("versionsService").autosave({
        ref: { scopeKind: "collection", scopeSlug: POSTS, entryId: id },
        status: "draft",
        snapshot: { title: "typing" },
        locale: "es",
        createdBy: null,
      });
      return id;
    },
    read: "autosave",
    expected: { locales: null, shared: null },
  },

  // Publishes and takedowns.
  {
    name: "publish by saving, translated value pending",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2" });
      await save(POSTS, id, "es", { status: "published" });
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "publish by saving, translated and shared values pending",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2", views: 40 });
      await save(POSTS, id, "es", { status: "published" });
      return id;
    },
    expected: p(["es"], true),
  },
  {
    name: "publish by saving the default language, shared value pending",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "en", { views: 40 });
      await save(POSTS, id, "en", { status: "published" });
      return id;
    },
    expected: p(["en"], true),
  },
  {
    name: "publish by saving, component pending",
    run: async () => {
      const id = await bannerPost(true);
      await save(BANNERED, id, "es", { banner: { words: "hola 2" } });
      await save(BANNERED, id, "es", { status: "published" });
      return id;
    },
    // A collection with no translations of its own keeps one status, the
    // document's, on its shared row: a save that names it writes it.
    expected: p(["es"], true),
  },
  {
    name: "chosen parts, one language",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2" });
      await publishParts(id, { locales: ["es"] });
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "chosen parts, the shared part alone",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { views: 40 });
      await publishParts(id, { locales: [], shared: true });
      return id;
    },
    expected: p([], true),
  },
  {
    name: "chosen parts, unpublish one language",
    run: async () => {
      const id = await publishedPost();
      await publishParts(id, { locales: ["es"] }, "unpublish");
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "publish every language, translated and shared values pending",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2", views: 60 });
      ok(await entries().publishAllLocales(everyLanguage(id)));
      return id;
    },
    expected: p(["es"], true),
  },
  {
    name: "publish every language, component pending",
    run: async () => {
      const id = await bannerPost(true);
      await save(BANNERED, id, "es", { banner: { words: "hola 2" } });
      ok(await entries().publishAllLocales(everyLanguage(id, BANNERED)));
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "unpublish every language",
    run: async () => {
      const id = await publishedPost();
      ok(await entries().unpublishAllLocales(everyLanguage(id)));
      return id;
    },
    expected: p(["en", "es"], true),
  },

  // Restores, rewrites and taking live values.
  {
    name: "restore, its own version",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2", status: "published" });
      ok(
        await (
          handle!.getService("collectionsHandler") as CollectionsHandler
        ).updateEntry(
          {
            collectionName: POSTS,
            entryId: id,
            overrideAccess: true,
            locale: "es",
            sourceVersionNo: 1,
            requireHeldDraft: true,
          },
          { title: "es title", _overwrite: true }
        )
      );
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "restore, the snapshot of what it replaced",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2", status: "published" });
      ok(
        await (
          handle!.getService("collectionsHandler") as CollectionsHandler
        ).updateEntry(
          {
            collectionName: POSTS,
            entryId: id,
            overrideAccess: true,
            locale: "es",
            sourceVersionNo: 1,
            requireHeldDraft: true,
          },
          { title: "es title", _overwrite: true }
        )
      );
      return id;
    },
    read: "before newest",
    expected: p([], false),
  },
  {
    name: "field rewrite in place, translated field",
    run: async () => {
      const id = await publishedPost();
      await rewrite(id, "title", "renamed", "es");
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "field rewrite in place, shared field",
    run: async () => {
      const id = await publishedPost();
      await rewrite(id, "views", 99);
      return id;
    },
    expected: p([], true),
  },
  {
    name: "field rewrite of a held draft, translated field",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2" });
      await rewrite(id, "title", "renamed", "es");
      return id;
    },
    expected: p(["es"], false),
  },

  // A Single.
  {
    name: "Single in place, translated value",
    run: async () => {
      const id = await site(false);
      await saveSingle(SITE, "es", { title: "es 2" });
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "Single in place, shared value",
    run: async () => {
      const id = await site(false);
      await saveSingle(SITE, "es", { views: 40 });
      return id;
    },
    expected: p([], true),
  },
  {
    name: "Single in place, status only, non-default language",
    run: async () => {
      const id = await site(false);
      await saveSingle(SITE, "es", { status: "published" });
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "Single in place, status only, default language",
    run: async () => {
      const id = await site(false);
      await saveSingle(SITE, "en", { status: "published" });
      return id;
    },
    expected: p(["en"], true),
  },
  {
    name: "Single held save, translated value",
    run: async () => {
      const id = await site(true);
      await saveSingle(SITE, "es", { title: "es 2" });
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "Single publish by saving, translated and shared values pending",
    run: async () => {
      const id = await site(true);
      await saveSingle(SITE, "es", { title: "es 2", views: 40 });
      await saveSingle(SITE, "es", { status: "published" });
      return id;
    },
    expected: p(["es"], true),
  },
  {
    name: "Single publish every language, translated value pending",
    run: async () => {
      const id = await site(true);
      await saveSingle(SITE, "es", { title: "es 2" });
      ok(
        await singles().publishAllLocales(SITE, {
          overrideAccess: true,
          data: { _overwrite: true },
        })
      );
      return id;
    },
    expected: p(["es"], false),
  },

  // Without per-language storage: one draft per language, of the whole
  // document.
  {
    name: "whole: create",
    storage: "whole",
    run: () =>
      create(POSTS, "en", { title: "t", views: 1, status: "published" }),
    expected: p(["en"], true),
  },
  {
    name: "whole: held save, translated value",
    storage: "whole",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2" });
      return id;
    },
    expected: p(["es"], false),
  },
  {
    name: "whole: the language's draft row holds the whole document",
    storage: "whole",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2" });
      return id;
    },
    read: { draft: "es" },
    expected: p(["es"], true),
  },
  {
    name: "whole: in place, shared value",
    storage: "whole",
    run: async () => {
      const id = await draftPost();
      await save(POSTS, id, "es", { views: 40 });
      return id;
    },
    expected: p([], true),
  },
  {
    name: "whole: publish by saving, translated value pending",
    storage: "whole",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2" });
      await save(POSTS, id, "es", { status: "published" });
      return id;
    },
    // The whole document goes live from the draft, its shared values
    // included, so the shared part is put live too.
    expected: p(["es"], true),
  },
  {
    name: "whole: taking live shared values into a pending change",
    storage: "whole",
    run: async () => {
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2" });
      await save(POSTS, id, "en", { views: 20, status: "published" });
      const taken = await entries().takeLiveSharedValues({
        collectionName: POSTS,
        entryId: id,
        overrideAccess: true,
        locale: "es",
        version: { _overwrite: true },
      });
      expect(taken.success, JSON.stringify(taken)).toBe(true);
      return id;
    },
    expected: p([], true),
  },
];

describe.each(getConfiguredTestDialects())(
  "the parts every write records (%s)",
  dialect => {
    it.each(CASES.map(c => [c.name, c] as const))(
      "%s",
      async (_name, c) => {
        await boot(dialect, c.storage ?? "parts");
        const id = await c.run();
        expect(await readParts(id, c.read ?? "newest")).toEqual(c.expected);
      },
      90_000
    );

    it("records no version for a discard of a working draft", async () => {
      await boot(dialect, "parts");
      const id = await publishedPost();
      await save(POSTS, id, "es", { title: "es 2" });
      const before = (await numbered(id))[0]?.versionNo;
      await entries().discardWorkingDraft({
        collectionName: POSTS,
        entryId: id,
        locale: "es",
        version: { _overwrite: true },
      });
      expect((await numbered(id))[0]?.versionNo).toBe(before);
    }, 90_000);
  }
);
