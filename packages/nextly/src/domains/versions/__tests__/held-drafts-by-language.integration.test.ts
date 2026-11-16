/**
 * A held edit to a document that keeps any value per language is held under
 * the language it was made in, collections and Singles alike.
 *
 * A component's values are kept per language whether or not the document
 * embedding it is translated. Under per-language storage every document's
 * held edit is keyed by its language, so an untranslated document with a
 * translated component holds each language's component edit in that
 * language's draft. Without it, such a document keeps no held draft at all:
 * a save goes live, since one draft with no language would hold several
 * languages' component edits.
 *
 * A version's language is decided by one rule on every path: a version that
 * carries a component was read in a language, empty component or not.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  text,
} from "../../../config";
import { getVersionDiffForDocument } from "../../../dispatcher/handlers/versions-methods";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { VersionsDbApi } from "../db-api";
import { VersionsRepository } from "../versions-repository";

/** Untranslated, embedding the translated `NOTE`. */
const NOTES = "hdnotes";
/** Untranslated, embedding the untranslated `SEO`. */
const PAGES = "hdpages";
/** An untranslated Single embedding the translated `NOTE`. */
const SITE = "hdsite";
/** Translated: a translated `title` and a shared `code`. */
const ARTICLES = "hdarticles";
/** Untranslated, with the untranslated `SEO` inside a named group. */
const BOXED = "hdboxed";
const NOTE = "hdnote";
const SEO = "hdseo";

const superAdmin = { id: "tester", roles: ["super-admin"] };

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

async function boot(
  dialect: TestDialect,
  perLanguageStorage: boolean
): Promise<TestNextly> {
  handle = await createTestNextly({
    dialect,
    perLanguageStorage,
    fieldGroups: [
      defineFieldGroup({
        slug: NOTE,
        localized: true,
        fields: [text({ name: "words" })],
      }),
      defineFieldGroup({ slug: SEO, fields: [text({ name: "metaTitle" })] }),
    ],
    collections: [
      defineCollection({
        slug: NOTES,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "banner", component: NOTE }),
        ],
      }),
      defineCollection({
        slug: BOXED,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          group({
            name: "box",
            fields: [fieldGroup({ name: "seo", component: SEO })],
          }),
        ],
      }),
      defineCollection({
        slug: ARTICLES,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          text({ name: "code", localized: false }),
        ],
      }),
      defineCollection({
        slug: PAGES,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "seo", component: SEO }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: SITE,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "banner", component: NOTE }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return handle;
}

const entriesOf = (t: TestNextly) =>
  (
    t.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;

const singlesOf = (t: TestNextly) =>
  t.getService("singleEntryService") as unknown as {
    update(
      slug: string,
      data: Record<string, unknown>,
      options: Record<string, unknown>
    ): Promise<{ success: boolean }>;
    get(
      slug: string,
      options: Record<string, unknown>
    ): Promise<{ success: boolean; data?: Record<string, unknown> | null }>;
    publishAllLocales(
      slug: string,
      options: Record<string, unknown>
    ): Promise<{ success: boolean }>;
  };

/** The document's held drafts, by language (`shared` for none). */
async function heldIn(entryId: string): Promise<string[]> {
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
  return rows.map(row => row.locale ?? "shared").sort();
}

/** The languages the document's recorded versions are kept under, oldest first. */
async function versionLanguages(entryId: string): Promise<(string | null)[]> {
  const rows = await handle!.adapter.select<{
    versionNo: number | null;
    locale: string | null;
  }>("nextly_versions", {
    where: { and: [{ column: "entryId", op: "=", value: entryId }] },
  });
  return rows
    .filter(row => row.versionNo !== null)
    .sort((a, b) => (a.versionNo ?? 0) - (b.versionNo ?? 0))
    .map(row => row.locale);
}

/** A collection document, saved and judged as an editor's save is. */
function collectionDoc(entries: CollectionEntryService, slug: string) {
  return {
    async create(data: Record<string, unknown>): Promise<string> {
      const created = await entries.createEntry(
        { collectionName: slug, overrideAccess: true, locale: "en" },
        data
      );
      expect(created.success, JSON.stringify(created)).toBe(true);
      return (created.data as { id: string }).id;
    },
    async save(id: string, locale: string, data: Record<string, unknown>) {
      const saved = await entries.updateEntry(
        { collectionName: slug, entryId: id, overrideAccess: true, locale },
        { ...data, _overwrite: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
    },
    async words(id: string, locale: string): Promise<unknown> {
      const read = await entries.getEntry({
        collectionName: slug,
        entryId: id,
        overrideAccess: true,
        locale,
      });
      expect(read.success, JSON.stringify(read)).toBe(true);
      return (
        (read.data as Record<string, unknown>).banner as {
          words?: unknown;
        } | null
      )?.words;
    },
    async publishEveryLanguage(id: string) {
      const published = await entries.publishAllLocales({
        collectionName: slug,
        entryId: id,
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(published.success, JSON.stringify(published)).toBe(true);
    },
  };
}

describe.each(getConfiguredTestDialects())(
  "a held edit is held under its language (integration, %s)",
  dialect => {
    describe("under per-language storage", () => {
      it("holds a component edit in each language's own draft, and publishes each to its own row", async () => {
        const notes = collectionDoc(
          entriesOf(await boot(dialect, true)),
          NOTES
        );
        const id = await notes.create({
          title: "Notes",
          banner: { words: "en words" },
          status: "published",
        });
        await notes.save(id, "es", {
          banner: { words: "es words" },
          status: "published",
        });

        await notes.save(id, "en", { banner: { words: "en 2" } });
        await notes.save(id, "es", { banner: { words: "es 2" } });

        // Held: nothing live moved, and each edit is in its language's draft.
        expect(await notes.words(id, "en")).toBe("en words");
        expect(await notes.words(id, "es")).toBe("es words");
        expect(await heldIn(id)).toEqual(["en", "es"]);

        await notes.publishEveryLanguage(id);

        expect(await notes.words(id, "en")).toBe("en 2");
        expect(await notes.words(id, "es")).toBe("es 2");
        expect(await heldIn(id)).toEqual([]);
      }, 90_000);

      it("holds a Single's component edit in each language's own draft, and publishes each to its own row", async () => {
        const singles = singlesOf(await boot(dialect, true));
        const save = async (locale: string, data: Record<string, unknown>) => {
          const saved = await singles.update(
            SITE,
            { ...data, _overwrite: true },
            { locale, overrideAccess: true }
          );
          expect(saved.success, JSON.stringify(saved)).toBe(true);
        };
        const words = async (locale: string) => {
          const read = await singles.get(SITE, {
            locale,
            overrideAccess: true,
          });
          expect(read.success, JSON.stringify(read)).toBe(true);
          return (
            (read.data as Record<string, unknown>).banner as {
              words?: unknown;
            } | null
          )?.words;
        };
        await save("en", {
          title: "Site",
          banner: { words: "en words" },
          status: "published",
        });
        await save("es", {
          banner: { words: "es words" },
          status: "published",
        });
        const siteId = (
          (await singles.get(SITE, { overrideAccess: true })).data as {
            id: string;
          }
        ).id;

        await save("en", { banner: { words: "en 2" } });
        await save("es", { banner: { words: "es 2" } });

        expect(await words("en")).toBe("en words");
        expect(await words("es")).toBe("es words");
        expect(await heldIn(siteId)).toEqual(["en", "es"]);

        const published = await singles.publishAllLocales(SITE, {
          data: { _overwrite: true },
          overrideAccess: true,
        });
        expect(published.success, JSON.stringify(published)).toBe(true);
        expect(await words("en")).toBe("en 2");
        expect(await words("es")).toBe("es 2");
      }, 90_000);
    });

    describe("without per-language storage", () => {
      // One held draft with no language would hold both languages' component
      // edits, so a save of such a document goes live in its own language.
      it("puts each language's component edit in its own row", async () => {
        const notes = collectionDoc(
          entriesOf(await boot(dialect, false)),
          NOTES
        );
        const id = await notes.create({
          title: "Notes",
          banner: { words: "en words" },
          status: "published",
        });
        await notes.save(id, "es", {
          banner: { words: "es words" },
          status: "published",
        });

        await notes.save(id, "en", { banner: { words: "en 2" } });
        await notes.save(id, "es", { banner: { words: "es 2" } });
        await notes.publishEveryLanguage(id);

        expect(await notes.words(id, "en")).toBe("en 2");
        expect(await notes.words(id, "es")).toBe("es 2");
        // Saved live, so nothing was held.
        expect(await heldIn(id)).toEqual([]);
      }, 90_000);

      // Such a collection held one draft with no language before the rule
      // refused it, so nothing says which language its component values
      // were read in. That draft is read-only: still shown and discardable,
      // while a save, a publish of one language and a publish of every
      // language are refused and leave it, and every row, as they were.
      it("keeps a draft held before the rule read-only until it is discarded", async () => {
        const t = await boot(dialect, false);
        const entries = entriesOf(t);
        const notes = collectionDoc(entries, NOTES);
        const id = await notes.create({
          title: "Notes",
          banner: { words: "en words" },
          status: "published",
        });
        const live = await entries.getEntry({
          collectionName: NOTES,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        });
        await new VersionsRepository(
          t.adapter as unknown as VersionsDbApi
        ).upsertWorkingDraft({
          ref: { scopeKind: "collection", scopeSlug: NOTES, entryId: id },
          locale: null,
          snapshot: {
            ...(live.data as Record<string, unknown>),
            title: "Held before",
            // A component value held from a read in Spanish.
            banner: { words: "es held" },
          },
        });
        const editorTitle = async () =>
          (
            (
              await entries.getEntry({
                collectionName: NOTES,
                entryId: id,
                overrideAccess: true,
                locale: "en",
                includeWorkingDraft: true,
                status: "all",
              })
            ).data as Record<string, unknown>
          ).title;
        expect(await editorTitle()).toBe("Held before");

        const refused = await entries.updateEntry(
          {
            collectionName: NOTES,
            entryId: id,
            overrideAccess: true,
            locale: "en",
          },
          { title: "Saved over it", _overwrite: true }
        );
        expect(refused.success).toBe(false);
        expect(refused.statusCode).toBe(409);
        expect(await heldIn(id)).toEqual(["shared"]);
        expect(await editorTitle()).toBe("Held before");

        // A publish of one language would fold the held component value
        // into that language's row, whichever language it was read in.
        const publishedOne = await entries.updateEntry(
          {
            collectionName: NOTES,
            entryId: id,
            overrideAccess: true,
            locale: "en",
          },
          { status: "published", _overwrite: true }
        );
        expect(publishedOne.success).toBe(false);
        expect(publishedOne.statusCode).toBe(409);
        expect(await notes.words(id, "en")).toBe("en words");

        // A publish of every language would consume it with nothing of it
        // written.
        const publishedEvery = await entries.publishAllLocales({
          collectionName: NOTES,
          entryId: id,
          overrideAccess: true,
          data: { _overwrite: true },
        });
        expect(publishedEvery.success).toBe(false);
        expect(publishedEvery.statusCode).toBe(409);
        expect(await heldIn(id)).toEqual(["shared"]);
        expect(await notes.words(id, "en")).toBe("en words");
        expect(await editorTitle()).toBe("Held before");

        await entries.discardWorkingDraft({
          collectionName: NOTES,
          entryId: id,
          version: { _overwrite: true },
        });
        expect(await heldIn(id)).toEqual([]);
        expect(await editorTitle()).toBe("Notes");
      }, 90_000);

      // A component inside a group is read in a language as one at the top
      // level is, so its versions are recorded under that language too.
      it("records a held save of a document with a component inside a group under its language", async () => {
        const boxed = collectionDoc(
          entriesOf(await boot(dialect, false)),
          BOXED
        );
        const id = await boxed.create({ title: "Box", status: "published" });
        await boxed.save(id, "en", { title: "Box 2", status: "published" });
        await boxed.save(id, "en", { title: "Box 3" });

        const languages = await versionLanguages(id);
        expect(languages.length).toBeGreaterThanOrEqual(3);
        expect(new Set(languages)).toEqual(new Set(["en"]));
      }, 90_000);

      // A second held edit of a field the first already changed is a change
      // of its own: it is recorded and is what the draft holds, a translated
      // field as well as a shared one.
      it.each([
        { field: "title", first: "Again", second: "Changed" },
        { field: "code", first: "A-1", second: "A-2" },
      ])(
        "holds a second edit of $field after a first",
        async ({ field, first, second }) => {
          const entries = entriesOf(await boot(dialect, false));
          const articles = collectionDoc(entries, ARTICLES);
          const id = await articles.create({ title: "Live", code: "L" });
          await articles.save(id, "en", { status: "published" });
          await articles.save(id, "en", { [field]: first });
          const afterFirst = (await versionLanguages(id)).length;

          await articles.save(id, "en", { [field]: second });

          expect((await versionLanguages(id)).length).toBe(afterFirst + 1);
          const draft = await entries.getEntry({
            collectionName: ARTICLES,
            entryId: id,
            overrideAccess: true,
            locale: "en",
            includeWorkingDraft: true,
            status: "all",
          });
          expect(draft.success, JSON.stringify(draft)).toBe(true);
          expect((draft.data as Record<string, unknown>)[field]).toBe(second);
        },
        90_000
      );

      // An empty component was still read in a language, so a held save is
      // recorded under it as the publishes before it were, and the draft is
      // found as that language's.
      it("records a held save of a document with an empty component under its language", async () => {
        await boot(dialect, false);
        const pages = collectionDoc(entriesOf(handle!), PAGES);
        const id = await pages.create({ title: "Page", status: "published" });
        await pages.save(id, "en", { title: "Page 2", status: "published" });
        await pages.save(id, "en", { title: "Page 3" });

        const languages = await versionLanguages(id);
        expect(languages.length).toBeGreaterThanOrEqual(3);
        expect(new Set(languages)).toEqual(new Set(["en"]));

        const draftNo = languages.length;
        const diff = await getVersionDiffForDocument({
          scopeKind: "collection",
          slug: PAGES,
          entryId: id,
          user: superAdmin,
          locale: "en",
          to: draftNo - 1,
          baseline: "draft",
        });
        expect(diff).toMatchObject({
          from: draftNo,
          baseline: { name: "draft", versionNo: draftNo },
        });
      }, 90_000);
    });
  }
);
