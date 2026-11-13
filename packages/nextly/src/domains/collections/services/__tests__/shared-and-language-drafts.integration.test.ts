/**
 * Under per-language storage, a document's shared part and each of its
 * languages keep a pending change of their own.
 *
 * A held edit to a published document is split by part: what it changes in a
 * shared field goes to the document's ONE shared draft (stored under no
 * language), and what it changes in a translatable field goes to the draft of
 * the language it was made in. A shared draft holds no translatable value and
 * a language's draft holds no shared one, so an edit to a shared field from
 * any language reaches every language, and an edit to one language's text
 * reaches no other.
 *
 * Every language says while the shared part has unpublished changes, and a
 * public read serves the published shared part with the requested language's
 * published values, whatever drafts exist.
 *
 * Each "absent" assertion stands beside a positive one in the same case: no
 * draft at all also satisfies "the Spanish draft holds no shared value".
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../../__tests__/fixtures/permission-holders";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  number,
  text,
} from "../../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../../services/collections-handler";

const TRANSLATED = "partposts";
const UNTRANSLATED = "partnotes";
/** Translated, with its translatable `title` required. */
const REQUIRED = "partreqs";
/** Translated, with a publish rule that refuses Spanish. */
const GUARDED = "partguards";
const PUBLISHER = "part-publisher";
/** Translated, with a translated component holding a shared sub-field. */
const BANNERED = "partbanners";
const BANNER = "partbanner";
const FIELD_GUARDED = "partfieldguards";

/** Translatable: `title` and `body`. Shared: `views` (a number). */
const FIELDS = () => [
  text({ name: "title" }),
  text({ name: "body" }),
  number({ name: "views" }),
];
const TRANSLATABLE = ["title", "body"];
const SHARED = ["views"];

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

async function boot(dialect: TestDialect): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    dialect,
    perLanguageStorage: true,
    fieldGroups: [
      // Kept per language, with a shared sub-field.
      defineFieldGroup({
        slug: BANNER,
        localized: true,
        fields: [
          text({ name: "words" }),
          text({ name: "code", localized: false }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: BANNERED,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "banner", component: BANNER }),
        ],
      }),
      defineCollection({
        slug: TRANSLATED,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: FIELDS(),
      }),
      defineCollection({
        slug: FIELD_GUARDED,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
        },
        fields: [
          text({ name: "title" }),
          text({ name: "body" }),
          // A shared value this rule does not let the caller change in Spanish.
          number({
            name: "views",
            access: { update: ({ locale }) => locale !== "es" },
          }),
        ],
      }),
      defineCollection({
        slug: UNTRANSLATED,
        status: true,
        versions: { drafts: true },
        fields: FIELDS(),
      }),
      defineCollection({
        slug: REQUIRED,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title", required: true }),
          text({ name: "body" }),
          number({ name: "views" }),
        ],
      }),
      defineCollection({
        slug: GUARDED,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          // Asked once for each language a publish puts live.
          publish: ({ locale }) => locale !== "es",
        },
        fields: FIELDS(),
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return (
    handle.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

/** Writes `data` to the entry in `locale`, as an editor's save does. */
async function save(
  entries: CollectionEntryService,
  slug: string,
  id: string,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  const saved = await entries.updateEntry(
    { collectionName: slug, entryId: id, overrideAccess: true, locale },
    // Every save here replaces what is stored, as an editor's save does.
    { ...data, _overwrite: true }
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

/** A document published in English and Spanish, with `views` at 10. */
async function publishedInBoth(
  entries: CollectionEntryService,
  slug: string
): Promise<string> {
  const created = await entries.createEntry(
    { collectionName: slug, overrideAccess: true, locale: "en" },
    { title: "en title", body: "en body", views: 10, status: "published" }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  const id = (created.data as { id: string }).id;
  await save(entries, slug, id, "es", {
    title: "es title",
    body: "es body",
    status: "published",
  });
  return id;
}

/** The entry's working drafts as stored, by slot (`shared` for none). */
async function drafts(
  entryId: string
): Promise<Record<string, Record<string, unknown>>> {
  const rows = await handle!.adapter.select<{
    locale: string | null;
    snapshot: unknown;
  }>("nextly_versions", {
    where: {
      and: [
        { column: "entryId", op: "=", value: entryId },
        { column: "isAutosave", op: "=", value: false },
        { column: "versionNo", op: "IS NULL" },
        { column: "status", op: "=", value: "draft" },
      ],
    },
  });
  const bySlot: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    const snapshot =
      typeof row.snapshot === "string"
        ? (JSON.parse(row.snapshot) as Record<string, unknown>)
        : (row.snapshot as Record<string, unknown>);
    bySlot[row.locale ?? "shared"] = snapshot;
  }
  return bySlot;
}

/** The field names of `names` a stored draft carries. */
const carried = (draft: Record<string, unknown>, names: string[]) =>
  names.filter(name => name in draft);

async function read(
  entries: CollectionEntryService,
  slug: string,
  id: string,
  locale: string,
  editor = false
): Promise<Record<string, unknown>> {
  const res = await entries.getEntry({
    collectionName: slug,
    entryId: id,
    overrideAccess: true,
    locale,
    ...(editor ? { includeWorkingDraft: true, status: "all" as const } : {}),
  });
  expect(res.success, JSON.stringify(res)).toBe(true);
  return res.data as Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "the shared part and each language get their own draft (integration, %s)",
  dialect => {
    it("keeps one shared draft and one draft per language, each with its own part only", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries, TRANSLATED);

      await save(entries, TRANSLATED, id, "en", { title: "en 2", views: 11 });
      await save(entries, TRANSLATED, id, "es", { title: "es 2", views: 12 });

      const stored = await drafts(id);
      expect(Object.keys(stored).sort()).toEqual(["en", "es", "shared"]);
      // The shared draft: the later shared edit, and no translatable value.
      expect(stored.shared.views).toBe(12);
      expect(carried(stored.shared, TRANSLATABLE)).toEqual([]);
      // Each language's draft: its own text, and no shared value.
      expect(stored.en.title).toBe("en 2");
      expect(stored.es.title).toBe("es 2");
      expect(carried(stored.en, SHARED)).toEqual([]);
      expect(carried(stored.es, SHARED)).toEqual([]);
      // Nothing published moved.
      expect(await read(entries, TRANSLATED, id, "en")).toMatchObject({
        title: "en title",
        views: 10,
      });
      expect(await read(entries, TRANSLATED, id, "es")).toMatchObject({
        title: "es title",
        views: 10,
      });
    }, 90_000);

    it("records a shared edit made in a non-default language in the shared draft, and in no language's", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries, TRANSLATED);

      await save(entries, TRANSLATED, id, "es", { views: 20 });

      const stored = await drafts(id);
      expect(Object.keys(stored)).toEqual(["shared"]);
      expect(stored.shared.views).toBe(20);
      // Every language's editor sees it.
      expect((await read(entries, TRANSLATED, id, "en", true)).views).toBe(20);
      expect((await read(entries, TRANSLATED, id, "es", true)).views).toBe(20);
    }, 90_000);

    it("records a translatable edit in that language's draft only", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries, TRANSLATED);

      await save(entries, TRANSLATED, id, "es", { body: "es body 2" });

      const stored = await drafts(id);
      expect(Object.keys(stored)).toEqual(["es"]);
      expect(stored.es.body).toBe("es body 2");
      expect(carried(stored.es, SHARED)).toEqual([]);
      // The editor sees the Spanish edit in Spanish only.
      expect((await read(entries, TRANSLATED, id, "es", true)).body).toBe(
        "es body 2"
      );
      expect((await read(entries, TRANSLATED, id, "en", true)).body).toBe(
        "en body"
      );
    }, 90_000);

    it("tells every language while the shared part has unpublished changes", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries, TRANSLATED);

      // A translatable edit alone is not a shared change.
      await save(entries, TRANSLATED, id, "es", { body: "es body 2" });
      for (const locale of ["en", "es"]) {
        expect(
          (await read(entries, TRANSLATED, id, locale, true))
            ._sharedChangesPending
        ).toBe(false);
      }

      await save(entries, TRANSLATED, id, "es", { views: 21 });
      for (const locale of ["en", "es"]) {
        expect(
          (await read(entries, TRANSLATED, id, locale, true))
            ._sharedChangesPending
        ).toBe(true);
      }
    }, 90_000);

    // Every combination of a shared draft, a Spanish draft, and Spanish being
    // published or not (falling back to English then): a reader always gets
    // the published shared part and the published values of the language.
    const combinations = [true, false].flatMap(sharedDraft =>
      [true, false].flatMap(languageDraft =>
        [true, false].map(published => ({
          sharedDraft,
          languageDraft,
          published,
        }))
      )
    );
    it.each(combinations)(
      "serves a reader the published parts only (shared draft $sharedDraft, Spanish draft $languageDraft, Spanish published $published)",
      async ({ sharedDraft, languageDraft, published }) => {
        const entries = await boot(dialect);
        const created = await entries.createEntry(
          { collectionName: TRANSLATED, overrideAccess: true, locale: "en" },
          { title: "en title", body: "en body", views: 10, status: "published" }
        );
        const id = (created.data as { id: string }).id;
        if (published) {
          await save(entries, TRANSLATED, id, "es", {
            title: "es title",
            status: "published",
          });
        }
        if (sharedDraft) {
          await save(entries, TRANSLATED, id, "en", { views: 99 });
        }
        if (languageDraft && published) {
          await save(entries, TRANSLATED, id, "es", { title: "es draft" });
        }

        const reader = await read(entries, TRANSLATED, id, "es");
        expect(reader.views).toBe(10);
        expect(reader.title).toBe(published ? "es title" : "en title");
      },
      90_000
    );

    it("keys an untranslated document's drafts by the language they were made in", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries, UNTRANSLATED);

      await save(entries, UNTRANSLATED, id, "en", { title: "en 2" });
      await save(entries, UNTRANSLATED, id, "es", { title: "es 2", views: 30 });

      const stored = await drafts(id);
      expect(Object.keys(stored).sort()).toEqual(["en", "es", "shared"]);
      expect(stored.en.title).toBe("en 2");
      expect(stored.es.title).toBe("es 2");
      expect(stored.shared.views).toBe(30);
    }, 90_000);

    // A language's publish carries the shared changes with it.
    it("publishes a language's draft with the shared draft, and keeps the other language's", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries, TRANSLATED);
      await save(entries, TRANSLATED, id, "en", { title: "en 2" });
      await save(entries, TRANSLATED, id, "es", { title: "es 2", views: 40 });

      await save(entries, TRANSLATED, id, "es", { status: "published" });

      expect(await read(entries, TRANSLATED, id, "es")).toMatchObject({
        title: "es 2",
        views: 40,
      });
      expect((await read(entries, TRANSLATED, id, "en")).title).toBe(
        "en title"
      );
      expect(Object.keys(await drafts(id))).toEqual(["en"]);
    }, 90_000);

    // A publish that chooses languages and not the shared part puts only those languages' own
    // changes live: the shared draft, and the shared values every language shows, stay as they
    // were until the shared part is published.
    it("publishes a chosen language's own change and leaves the shared draft pending", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries, TRANSLATED);
      await save(entries, TRANSLATED, id, "es", { title: "es 2", views: 40 });

      const published = await entries.publishParts(
        {
          collectionName: TRANSLATED,
          entryId: id,
          overrideAccess: true,
          data: { _overwrite: true },
        },
        { direction: "publish", locales: ["es"] }
      );

      expect(published.success, JSON.stringify(published)).toBe(true);
      expect(await read(entries, TRANSLATED, id, "es")).toMatchObject({
        title: "es 2",
        views: 10,
      });
      expect((await read(entries, TRANSLATED, id, "en")).views).toBe(10);
      expect(carried((await drafts(id)).shared ?? {}, SHARED)).toEqual([
        "views",
      ]);
    }, 90_000);

    // An untranslated document is published from one language as a
    // translated one is: that language's draft with the shared draft. Another language's draft stays pending, unchanged, and is
    // published from its own language.
    it("publishes an untranslated document's language with the shared draft, and keeps the other language's", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries, UNTRANSLATED);
      await save(entries, UNTRANSLATED, id, "en", { title: "en 2" });
      await save(entries, UNTRANSLATED, id, "es", { title: "es 2", views: 50 });

      await save(entries, UNTRANSLATED, id, "en", { status: "published" });

      expect(await read(entries, UNTRANSLATED, id, "en")).toMatchObject({
        title: "en 2",
        views: 50,
      });
      expect((await read(entries, UNTRANSLATED, id, "es")).title).toBe(
        "es title"
      );
      const stored = await drafts(id);
      expect(Object.keys(stored)).toEqual(["es"]);
      expect(stored.es.title).toBe("es 2");
    }, 90_000);

    // Publishing every language puts the shared draft live with them: it is
    // the shared change itself, so nothing about it is out of date.
    // Unpublishing a language puts nothing live, so the shared draft stays
    // pending: the language still published keeps its live shared values.
    it("keeps the shared draft pending when one language is unpublished", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries, TRANSLATED);
      await save(entries, TRANSLATED, id, "es", { views: 40 });

      await save(entries, TRANSLATED, id, "es", { status: "draft" });

      expect(await read(entries, TRANSLATED, id, "en")).toMatchObject({
        title: "en title",
        views: 10,
      });
      expect(await drafts(id)).toMatchObject({ shared: { views: 40 } });
    }, 90_000);

    it("publishes every language with a shared edit made in a non-default language", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries, TRANSLATED);
      await save(entries, TRANSLATED, id, "es", { views: 60 });

      const published = await entries.publishAllLocales({
        data: { _overwrite: true },
        collectionName: TRANSLATED,
        entryId: id,
        overrideAccess: true,
      });

      expect(published.success, JSON.stringify(published)).toBe(true);
      for (const locale of ["en", "es"]) {
        expect((await read(entries, TRANSLATED, id, locale)).views).toBe(60);
      }
      expect(await drafts(id)).toEqual({});
    }, 90_000);

    // The shared part shows in every live language, so publishing it asks its fields' rules in
    // each of them: a shared value the caller may not change in Spanish is not put live by a
    // publish chosen in English while Spanish is live.
    it("asks the shared fields' rules in every live language when a publish carries the shared draft", async () => {
      const entries = await boot(dialect);
      await userWhoMay(handle!, PUBLISHER, "update", [FIELD_GUARDED]);
      for (const action of ["read", "publish"]) {
        await grantTo(handle!, PUBLISHER, action, [FIELD_GUARDED]);
      }
      const id = await publishedInBoth(entries, FIELD_GUARDED);
      await save(entries, FIELD_GUARDED, id, "en", { views: 80 });

      const published = await entries.publishParts(
        {
          collectionName: FIELD_GUARDED,
          entryId: id,
          user: { id: PUBLISHER, email: `${PUBLISHER}@example.test` },
          overrideAccess: false,
          data: { _overwrite: true },
        },
        { direction: "publish", locales: ["en"], shared: true }
      );

      expect(published.success, JSON.stringify(published)).toBe(false);
      expect((await read(entries, FIELD_GUARDED, id, "es")).views).toBe(10);
    }, 90_000);

    // A shared-only draft goes live in every language, so a publish of every
    // language asks each language's publish rule about it, Spanish included.
    it("asks every language's publish rule about a shared-only draft a publish of every language puts live", async () => {
      const entries = await boot(dialect);
      await userWhoMay(handle!, PUBLISHER, "update", [GUARDED]);
      for (const action of ["read", "publish"]) {
        await grantTo(handle!, PUBLISHER, action, [GUARDED]);
      }
      const created = await entries.createEntry(
        { collectionName: GUARDED, overrideAccess: true, locale: "en" },
        { title: "en title", body: "en body", views: 10, status: "published" }
      );
      const id = (created.data as { id: string }).id;
      await save(entries, GUARDED, id, "es", { views: 70 });

      const published = await entries.updateEntry(
        {
          collectionName: GUARDED,
          entryId: id,
          locale: "*",
          user: { id: PUBLISHER, email: `${PUBLISHER}@example.test` },
          overrideAccess: false,
        },
        { status: "published", _overwrite: true }
      );

      expect(published.statusCode, JSON.stringify(published)).toBe(403);
      expect((await read(entries, GUARDED, id, "en")).views).toBe(10);
      expect(Object.keys(await drafts(id))).toEqual(["shared"]);
    }, 90_000);

    // Each language's change is validated as that language, its translated
    // values read in: a shared-only change judged with no language would find
    // every required translated field missing.
    it("publishes every language with a shared edit where a translated field is required", async () => {
      const entries = await boot(dialect);
      const created = await entries.createEntry(
        { collectionName: REQUIRED, overrideAccess: true, locale: "en" },
        { title: "en title", views: 10, status: "published" }
      );
      const id = (created.data as { id: string }).id;
      await save(entries, REQUIRED, id, "es", {
        title: "es title",
        status: "published",
      });
      await save(entries, REQUIRED, id, "es", { views: 80 });

      const published = await entries.publishAllLocales({
        data: { _overwrite: true },
        collectionName: REQUIRED,
        entryId: id,
        overrideAccess: true,
      });

      expect(published.success, JSON.stringify(published)).toBe(true);
      for (const locale of ["en", "es"]) {
        expect((await read(entries, REQUIRED, id, locale)).views).toBe(80);
      }
    }, 90_000);

    // A translated component's shared sub-field rides in each language's
    // draft. English's draft holding the value Spanish has since replaced is
    // out of date on every path that publishes it: refused or kept, never put
    // back.
    describe.each([
      { path: "a publish of English" },
      { path: "a publish of every language" },
    ])("$path", ({ path }) => {
      it("never puts back a component's shared value another language published since", async () => {
        const entries = await boot(dialect);
        const created = await entries.createEntry(
          { collectionName: BANNERED, overrideAccess: true, locale: "en" },
          {
            title: "en title",
            banner: { words: "en words", code: "c1" },
            status: "published",
          }
        );
        expect(created.success, JSON.stringify(created)).toBe(true);
        const id = (created.data as { id: string }).id;
        await save(entries, BANNERED, id, "es", {
          title: "es title",
          banner: { words: "es words", code: "c1" },
          status: "published",
        });
        // English holds an edit of its words, with the shared code it began from.
        await save(entries, BANNERED, id, "en", {
          banner: { words: "en words 2", code: "c1" },
        });
        // Spanish then publishes a new shared code.
        await save(entries, BANNERED, id, "es", {
          banner: { words: "es words 2", code: "c2" },
          status: "published",
        });
        const codeIn = async (locale: string) =>
          (
            (await read(entries, BANNERED, id, locale)).banner as {
              code?: unknown;
            } | null
          )?.code;
        // The control: Spanish's publish put its new code live.
        expect(await codeIn("es")).toBe("c2");

        const published =
          path === "a publish of English"
            ? await entries.updateEntry(
                {
                  collectionName: BANNERED,
                  entryId: id,
                  overrideAccess: true,
                  locale: "en",
                },
                { status: "published", _overwrite: true }
              )
            : await entries.publishAllLocales({
                collectionName: BANNERED,
                entryId: id,
                overrideAccess: true,
                data: { _overwrite: true },
              });

        if (!published.success) expect(published.statusCode).toBe(409);
        expect(await codeIn("es")).toBe("c2");
      }, 90_000);
    });
  }
);
