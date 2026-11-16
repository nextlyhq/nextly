/**
 * A translated field is out of date, field by field, once its source changes after the
 * translation was made from it: no person sets a flag. The translation overview reads it per
 * language and per field; a value written originally in its language is never out of date, and a
 * language whose values have no recorded origin is judged as before, by its language-level stamp.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../../config";
import { container } from "../../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { LocaleTranslationMeta } from "../../companion-join";

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  t = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es", "fr"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "summary", localized: true }),
        ],
      }),
      // Each language with its own draft or published status.
      defineCollection({
        slug: "articles",
        localized: true,
        status: true,
        fields: [text({ name: "title", localized: true })],
      }),
    ],
  });
  return t;
}

const handler = () => container.get<CollectionsHandler>("collectionsHandler");

/** A save of `data` in `locale`, as a person. */
async function save(
  id: string,
  locale: string,
  data: Record<string, unknown>,
  collectionName = "posts"
) {
  const result = await handler().updateEntry(
    {
      collectionName,
      entryId: id,
      overrideAccess: true,
      locale,
      user: { id: "ann" },
    },
    { ...data, _overwrite: true }
  );
  if (!result.success) {
    throw new Error(`save refused: ${result.statusCode} ${result.message}`);
  }
}

/** The post's translation overview, by language. */
async function overviewOf(
  id: string
): Promise<Record<string, LocaleTranslationMeta>> {
  const res = await handler().getEntry({
    collectionName: "posts",
    entryId: id,
    translationStatus: true,
    overrideAccess: true,
  });
  expect(res.success).toBe(true);
  return (res.data as Record<string, unknown>)._translations as Record<
    string,
    LocaleTranslationMeta
  >;
}

/** A post written in English, then translated into Spanish by a person. */
async function translatedPost(): Promise<string> {
  const created = (await t!.nextly.create({
    collection: "posts",
    locale: "en",
    data: { title: "Hi", summary: "Short" },
  })) as unknown as { item: { id: string } };
  const id = created.item.id;
  await save(id, "es", { title: "Hola", summary: "Corto" });
  return id;
}

describe.each(getConfiguredTestDialects())(
  "a translated field out of date (%s)",
  dialect => {
    it("marks only the field whose source changed, until it is translated again", async () => {
      await boot(dialect);
      const id = await translatedPost();
      const before = await overviewOf(id);
      expect(before.es.stale).toBeUndefined();
      expect(before.es.fields).toEqual({
        title: expect.objectContaining({
          origin: "person",
          sourceLocale: "en",
          outOfDate: false,
        }),
        summary: expect.objectContaining({ outOfDate: false }),
      });

      await save(id, "en", { title: "Hello" });
      const after = await overviewOf(id);
      expect(after.es.stale).toBe(true);
      expect(after.es.fields?.title).toMatchObject({ outOfDate: true });
      expect(after.es.fields?.summary).toMatchObject({ outOfDate: false });

      await save(id, "es", { title: "Hola de nuevo" });
      const retranslated = await overviewOf(id);
      expect(retranslated.es.stale).toBeUndefined();
      expect(retranslated.es.fields?.title).toMatchObject({
        outOfDate: false,
      });
    });

    it("never marks a value written originally in its language", async () => {
      await boot(dialect);
      const id = await translatedPost();
      await save(id, "fr", {
        title: "Bonjour",
        summary: "Bref",
        _provenance: {
          title: { origin: "original" },
          summary: { origin: "original" },
        },
      });

      await save(id, "en", { title: "Hello", summary: "Brief" });
      const overview = await overviewOf(id);
      expect(overview.fr.stale).toBeUndefined();
      expect(overview.fr.fields?.title).toMatchObject({
        origin: "original",
        outOfDate: false,
      });
      expect(overview.es.stale).toBe(true);
    });

    it("judges a language with no recorded origin by its language-level stamp", async () => {
      await boot(dialect);
      const id = await translatedPost();
      // As a translation made before origins were recorded: no row.
      await t!.adapter.delete("nextly_translation_provenance", {
        and: [{ column: "locale", op: "=", value: "es" }],
      });
      // A second later, so the stamps differ on every dialect.
      await new Promise(resolve => setTimeout(resolve, 1100));
      await save(id, "en", { summary: "Shorter" });

      const overview = await overviewOf(id);
      expect(overview.es.fields).toBeUndefined();
      // The title's source did not change, but nothing records that: the
      // language-level stamp says the source moved after Spanish was written.
      expect(overview.es.stale).toBe(true);
    });

    it("judges a translation made from a source with no recorded value by the language-level stamp", async () => {
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Hi", summary: "Short" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      // A source written before origins were recorded: no row for English.
      await t!.adapter.delete("nextly_translation_provenance", {
        and: [{ column: "locale", op: "=", value: "en" }],
      });
      // Spanish is recorded, but made from a source value nothing fingerprinted.
      await save(id, "es", { title: "Hola", summary: "Corto" });
      await new Promise(resolve => setTimeout(resolve, 1100));
      await save(id, "en", { title: "Hello" });

      const overview = await overviewOf(id);
      expect(overview.es.fields?.title?.outOfDate).toBeUndefined();
      // Nothing records what Spanish was made from, so its stamp decides.
      expect(overview.es.stale).toBe(true);
    });

    it("shows a published read no provenance for a language whose translation is only a draft", async () => {
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "articles",
        locale: "en",
        data: { title: "Hi", status: "published" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      await save(id, "es", { title: "Hola", status: "draft" }, "articles");

      const res = await handler().listEntries({
        collectionName: "articles",
        overrideAccess: true,
        status: "published",
        translationStatus: true,
      } as never);
      expect(res.success).toBe(true);
      const docs = (res.data as { docs: Record<string, unknown>[] }).docs;
      const overview = docs.find(doc => doc.id === id)?._translations as Record<
        string,
        LocaleTranslationMeta
      >;
      // The draft is hidden from this read, and so is what it records.
      expect(overview.es.translated).toBe(false);
      expect(overview.es.fields).toBeUndefined();
      expect(overview.en.fields?.title).toMatchObject({ origin: "original" });
    });
  }
);
