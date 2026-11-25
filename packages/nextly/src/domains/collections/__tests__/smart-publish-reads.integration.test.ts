/**
 * What the editor's publish reads, against what the publish then does, on every dialect.
 *
 * The editor publishes in one click when nothing beyond the language on screen changes, and
 * otherwise lists each language and the shared fields as choices, each in the publish service's
 * own words. Those decisions read three answers: the service's description of publishing every
 * language (which other languages hold changes, and what each would do), the editor read's
 * `_sharedChangesPending`, and the translation overview's per-field `outOfDate` (the notice after a
 * one-click publish). This file holds each answer to what the publish does:
 * - the description of publishing every language says, for each language, what describing and
 *   publishing that language as chosen says and does;
 * - the request the choice makes is done exactly as it was described;
 * - a pending edit to a source field leaves its translations up to date, and publishing it is what
 *   puts them out of date, field by field, so the notice read after a publish names only what that
 *   publish did.
 *
 * The plausible broken answers: a description of every language that disagrees with the
 * description of one language chosen (the dialog's unchosen rows would promise what the server
 * will not do), a shared pending change not reported to the language on screen (one click would
 * put it live unannounced), and an overview that moves on a pending save (the notice would blame
 * a publish for what a save did) or not at all.
 *
 * A hook that changes a shared field on a save of one language's text is why the editor stores its
 * unsaved work before it decides: only the stored state shows that change, and it does.
 *
 * A first publish taking the shared part with it, which the choice shows as fixed, is held by
 * `publish-parts.integration.test.ts` ("puts Spanish live before English, with the shared part,
 * and says the shared part was added").
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { LocaleTranslationMeta } from "../../i18n/companion-join";

const STORIES = "stories";
/** A hook of its own sets the shared tagline from the title. */
const HOOKED = "hooked_stories";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

async function boot(dialect: TestDialect): Promise<CollectionsHandler> {
  handle = await createTestNextly({
    dialect,
    perLanguageStorage: true,
    localization: { locales: ["en", "es", "fr"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: STORIES,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          // Translated.
          text({ name: "title" }),
          text({ name: "summary" }),
          // Shared by every language.
          text({ name: "tagline", localized: false }),
        ],
      }),
      defineCollection({
        slug: HOOKED,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          text({ name: "tagline", localized: false }),
        ],
        hooks: {
          beforeChange: [
            ({ data }) => {
              const { title } = data as { title?: unknown };
              return typeof title === "string"
                ? { ...data, tagline: `About ${title}` }
                : data;
            },
          ],
        },
      }),
    ],
  });
  return handle.getService("collectionsHandler") as CollectionsHandler;
}

/** A save in `locale`, as a person in the editor: it replaces what is stored. */
async function save(
  stories: CollectionsHandler,
  id: string,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  const saved = await stories.updateEntry(
    {
      collectionName: STORIES,
      entryId: id,
      overrideAccess: true,
      locale,
      user: { id: "ann" },
    },
    { ...data, _overwrite: true }
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

/** The editor's read in `locale`: the pending change in place of the live one. */
async function editorRead(
  stories: CollectionsHandler,
  id: string,
  locale: string
): Promise<Record<string, unknown>> {
  const res = await stories.getEntry({
    collectionName: STORIES,
    entryId: id,
    overrideAccess: true,
    locale,
    includeWorkingDraft: true,
    status: "all",
  });
  expect(res.success, JSON.stringify(res)).toBe(true);
  return res.data as Record<string, unknown>;
}

/** What a reader of `locale` is served. */
async function liveRead(
  stories: CollectionsHandler,
  id: string,
  locale: string
): Promise<Record<string, unknown>> {
  const res = await stories.getEntry({
    collectionName: STORIES,
    entryId: id,
    overrideAccess: true,
    locale,
    status: "published",
  });
  expect(res.success, JSON.stringify(res)).toBe(true);
  return res.data as Record<string, unknown>;
}

/** The translation overview the editor reads beside the entry. */
async function overviewOf(
  stories: CollectionsHandler,
  id: string
): Promise<Record<string, LocaleTranslationMeta>> {
  const res = await stories.getEntry({
    collectionName: STORIES,
    entryId: id,
    overrideAccess: true,
    translationStatus: true,
  });
  expect(res.success, JSON.stringify(res)).toBe(true);
  return (res.data as Record<string, unknown>)._translations as Record<
    string,
    LocaleTranslationMeta
  >;
}

/** The publish service asked what a publish of these parts would do, changing nothing. */
async function describePublish(
  id: string,
  locales: readonly string[] | "all",
  shared?: boolean
) {
  const described = await handle!.nextly.publish({
    collection: STORIES,
    id,
    locales: locales === "all" ? "all" : [...locales],
    ...(shared === undefined ? {} : { shared }),
    describe: true,
  });
  return described.item;
}

/** The same publish, done. */
async function publish(
  id: string,
  locales: readonly string[],
  shared: boolean
) {
  const applied = await handle!.nextly.publish({
    collection: STORIES,
    id,
    locales: [...locales],
    shared,
    data: { _overwrite: true },
  });
  return applied.item;
}

/** A story live in English and Spanish, Spanish translated from English; French not started. */
async function liveInEnglishAndSpanish(
  stories: CollectionsHandler
): Promise<string> {
  const created = await stories.createEntry(
    {
      collectionName: STORIES,
      overrideAccess: true,
      locale: "en",
      user: { id: "ann" },
    },
    {
      title: "Hello",
      summary: "Short",
      tagline: "Shared",
      status: "published",
    }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  const id = (created.data as { id: string }).id;
  await save(stories, id, "es", {
    title: "Hola",
    summary: "Corto",
    status: "published",
  });
  return id;
}

describe.each(getConfiguredTestDialects())(
  "what the editor's publish reads, against what the publish does (%s)",
  dialect => {
    it("describes English alone holding a change, and puts Spanish out of date only once English's edit is published", async () => {
      const stories = await boot(dialect);
      const id = await liveInEnglishAndSpanish(stories);
      // The editor edits English's title and saves it: a pending change, not live.
      await save(stories, id, "en", { title: "Hello again" });

      // What the one-click decision reads: no shared change, and no other language holding one.
      const editor = await editorRead(stories, id, "en");
      expect(editor.title).toBe("Hello again");
      expect(editor._sharedChangesPending).toBe(false);
      expect((await describePublish(id, "all")).languages).toEqual([
        { locale: "en", outcome: "goes-live-with-pending-change" },
        { locale: "es", outcome: "stays-published" },
        { locale: "fr", outcome: "shows-fallback", fallback: "en" },
      ]);

      // The pending edit moves nothing a reader of English sees, so Spanish is still up to date.
      const before = await overviewOf(stories, id);
      expect(before.es.fields).toEqual({
        title: expect.objectContaining({
          sourceLocale: "en",
          outOfDate: false,
        }),
        summary: expect.objectContaining({
          sourceLocale: "en",
          outOfDate: false,
        }),
      });

      // One click: the editor's Publish publishes the language on screen.
      await save(stories, id, "en", {
        title: "Hello again",
        status: "published",
      });

      expect((await liveRead(stories, id, "en")).title).toBe("Hello again");
      const after = await overviewOf(stories, id);
      // Exactly the field whose source moved, and Spanish itself unchanged for its readers.
      expect(after.es.fields?.title?.outOfDate).toBe(true);
      expect(after.es.fields?.summary?.outOfDate).toBe(false);
      expect((await liveRead(stories, id, "es")).title).toBe("Hola");
      expect((await describePublish(id, "all")).languages).toEqual([
        { locale: "en", outcome: "stays-published" },
        { locale: "es", outcome: "stays-published" },
        { locale: "fr", outcome: "shows-fallback", fallback: "en" },
      ]);
    }, 120_000);

    it("lists Spanish's waiting change in the words that describing and publishing Spanish then use, and does the chosen shared change as described", async () => {
      const stories = await boot(dialect);
      const id = await liveInEnglishAndSpanish(stories);
      // From the English editor, a shared edit; from Spanish, a title edit. Neither is live.
      await save(stories, id, "en", { tagline: "Shared, edited" });
      await save(stories, id, "es", { title: "Hola otra vez" });

      // What the choice reads: the shared fields hold a change, told to the language on screen...
      expect((await editorRead(stories, id, "en"))._sharedChangesPending).toBe(
        true
      );
      // ...and, of every language, Spanish holds one of its own; French has nothing.
      const every = await describePublish(id, "all");
      const listed = (locale: string) =>
        every.languages.filter(language => language.locale === locale);
      expect(every.languages.map(language => language.locale)).toEqual([
        "en",
        "es",
        "fr",
      ]);
      expect(listed("es")).toEqual([
        { locale: "es", outcome: "goes-live-with-pending-change" },
      ]);
      expect(listed("fr")).toEqual([
        { locale: "fr", outcome: "shows-fallback", fallback: "en" },
      ]);

      // Each row says what the description of every language says of it, and that is what
      // describing the language as the choice would ask says: Spanish on its own, English with
      // the shared fields that hold its editor's change.
      expect((await describePublish(id, ["es"])).languages).toEqual(
        listed("es")
      );
      const described = await describePublish(id, ["en"], true);
      expect(described.languages).toEqual(listed("en"));

      // The choice as it opens: English and the shared fields, done as described.
      const applied = await publish(id, ["en"], true);
      expect(applied).toEqual(described);

      // The shared change reached readers of every language; Spanish's own change did not go.
      expect((await liveRead(stories, id, "en")).tagline).toBe(
        "Shared, edited"
      );
      const spanish = await liveRead(stories, id, "es");
      expect(spanish.tagline).toBe("Shared, edited");
      expect(spanish.title).toBe("Hola");
      expect((await editorRead(stories, id, "en"))._sharedChangesPending).toBe(
        false
      );

      // Spanish still waits, as the list said, and publishing it does what was described.
      const spanishNext = await describePublish(id, ["es"]);
      expect(spanishNext.languages).toEqual([
        { locale: "es", outcome: "goes-live-with-pending-change" },
      ]);
      const spanishDone = await publish(id, ["es"], false);
      expect(spanishDone).toEqual(spanishNext);
      expect((await liveRead(stories, id, "es")).title).toBe("Hola otra vez");
    }, 120_000);

    it("tells the editor of a shared change a hook made from a save of English's text alone, before it is live", async () => {
      const stories = await boot(dialect);
      const created = await stories.createEntry(
        {
          collectionName: HOOKED,
          overrideAccess: true,
          locale: "en",
          user: { id: "ann" },
        },
        { title: "Hello", status: "published" }
      );
      expect(created.success, JSON.stringify(created)).toBe(true);
      const id = (created.data as { id: string }).id;
      const read = async (options: Record<string, unknown>) => {
        const res = await stories.getEntry({
          collectionName: HOOKED,
          entryId: id,
          overrideAccess: true,
          locale: "en",
          ...options,
        });
        expect(res.success, JSON.stringify(res)).toBe(true);
        return res.data as Record<string, unknown>;
      };
      const editorReads = () =>
        read({ includeWorkingDraft: true, status: "all" });
      expect((await read({ status: "published" })).tagline).toBe("About Hello");

      // The editor stores its edit to the title, and to nothing else.
      const saved = await stories.updateEntry(
        {
          collectionName: HOOKED,
          entryId: id,
          overrideAccess: true,
          locale: "en",
          user: { id: "ann" },
        },
        { title: "Hello again", _overwrite: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);

      const editor = await editorReads();
      expect(editor.title).toBe("Hello again");
      expect(editor.tagline).toBe("About Hello again");
      expect(editor._sharedChangesPending).toBe(true);
      expect((await read({ status: "published" })).tagline).toBe("About Hello");
    }, 120_000);
  }
);
