// The editor's read of a document tells every configured language's real
// status, even while the language being edited holds a pending change.
//
// The editor reads with the working draft overlaid and the per-language
// overview attached (`?draft=true&translation-status=1`). The plausible broken
// implementation attaches the overview to the live document and then hands
// back the pending change's document in its place, so the overview is lost
// exactly when a change is held: the panel then counts no language at all.

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const ARTICLES = "overviewarticles";
const PREFS = "overviewprefs";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: ARTICLES,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
    singles: [
      defineSingle({
        slug: PREFS,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "siteName", localized: true })],
      }),
    ],
    localization: { locales: ["en", "de", "fr"], defaultLocale: "en" },
  });
  return current;
}

/** The read the editor makes of a document, as the REST route builds it. */
const editorRead = {
  overrideAccess: true,
  includeWorkingDraft: true,
  translationStatus: true,
  status: "all" as const,
  fallbackLocale: "none",
  locale: "en",
};

/** English and German live, French never started. */
const LIVE_OVERVIEW = {
  en: { translated: true, status: "published" },
  de: { translated: true, status: "published" },
  fr: { translated: false },
};

describe.each(getConfiguredTestDialects())(
  "the editor's read of a document holding a pending change (integration, %s)",
  dialect => {
    it("tells every language of a collection entry, the default included", async () => {
      const t = await boot(dialect);
      const entries = (
        t.getService("collectionsHandler") as CollectionsHandler
      ).getEntryService() as CollectionEntryService;
      const at = (entryId: string, locale: string) => ({
        collectionName: ARTICLES,
        entryId,
        locale,
        overrideAccess: true,
      });
      const created = await entries.createEntry(
        { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
        { headline: "Hello", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const german = await entries.updateEntry(at(id, "de"), {
        headline: "Hallo",
        status: "published",
        _overwrite: true,
      });
      expect(german.success, JSON.stringify(german)).toBe(true);

      // CONTROL: with nothing held, the editor's read tells every language.
      const before = await entries.getEntry({
        collectionName: ARTICLES,
        entryId: id,
        ...editorRead,
      });
      expect(
        (before.data as Record<string, unknown>)._translations
      ).toMatchObject(LIVE_OVERVIEW);

      // English holds a pending change: the read shows the change...
      const held = await entries.updateEntry(at(id, "en"), {
        headline: "Hello again",
        _overwrite: true,
      });
      expect(held.success, JSON.stringify(held)).toBe(true);
      const read = await entries.getEntry({
        collectionName: ARTICLES,
        entryId: id,
        ...editorRead,
      });
      const doc = read.data as Record<string, unknown>;
      expect(doc.headline).toBe("Hello again");
      expect(doc._isWorkingDraft).toBe(true);
      // ...and still tells every language as it stands.
      expect(doc._translations).toMatchObject(LIVE_OVERVIEW);
    });

    it("tells every language of a Single, the default included", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService");
      for (const [locale, siteName] of [
        ["en", "Hello"],
        ["de", "Hallo"],
      ] as const) {
        const live = await singles.update(
          PREFS,
          { siteName, status: "published", _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(live.success, JSON.stringify(live)).toBe(true);
      }
      const held = await singles.update(
        PREFS,
        { siteName: "Hello again", _overwrite: true },
        { locale: "en", overrideAccess: true }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);

      const read = await singles.get(PREFS, editorRead);
      const doc = ((read as { data?: unknown }).data ?? read) as Record<
        string,
        unknown
      >;
      expect(doc.siteName).toBe("Hello again");
      expect(doc._translations).toMatchObject(LIVE_OVERVIEW);
    });
  }
);
