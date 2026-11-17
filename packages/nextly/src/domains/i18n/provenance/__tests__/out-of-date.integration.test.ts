/**
 * A translated field is out of date, field by field, once its source changes after the
 * translation was made from it: no person sets a flag. The translation overview reads it per
 * language and per field; a value written originally in its language is never out of date, and a
 * language whose values have no recorded origin is judged as before, by its language-level stamp.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../../config";
import { container } from "../../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { SingleEntryService } from "../../../../services/singles/single-entry-service";
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
    singles: [
      defineSingle({
        slug: "notice",
        localized: true,
        status: true,
        fields: [text({ name: "headline", localized: true })],
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

    it("marks a copy out of date when its source moved between the copy and the save", async () => {
      // A copy names the source language's version it was read at. English moved from "Hello" to
      // "Goodbye" after it was copied and before the copy was saved, so the copy was made from a
      // source that is no longer the one recorded: it must read as out of date, not up to date.
      await boot(dialect);
      const created = (await t!.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Hello", summary: "Short" },
      })) as unknown as { item: { id: string } };
      const id = created.item.id;
      const englishRead = await handler().getEntry({
        collectionName: "posts",
        entryId: id,
        locale: "en",
        overrideAccess: true,
      });
      const copiedAt = (englishRead.data as Record<string, unknown>)._rev;
      expect(typeof copiedAt).toBe("string");

      // A copy saved while its source is as it was read: up to date.
      await save(id, "fr", {
        title: "Hello",
        _provenance: {
          title: {
            origin: "copy",
            sourceLocale: "en",
            sourceRevision: copiedAt,
          },
        },
      });
      expect((await overviewOf(id)).fr.fields?.title).toMatchObject({
        origin: "copy",
        outOfDate: false,
      });

      await save(id, "en", { title: "Goodbye" });
      await save(id, "es", {
        title: "Hello",
        _provenance: {
          title: {
            origin: "copy",
            sourceLocale: "en",
            sourceRevision: copiedAt,
          },
        },
      });
      const overview = await overviewOf(id);
      expect(overview.es.fields?.title).toMatchObject({
        origin: "copy",
        outOfDate: true,
      });
      expect(overview.es.stale).toBe(true);

      // Copied again from English as it now stands: up to date again.
      const englishNow = (
        (
          await handler().getEntry({
            collectionName: "posts",
            entryId: id,
            locale: "en",
            overrideAccess: true,
          })
        ).data as Record<string, unknown>
      )._rev;
      await save(id, "es", {
        title: "Goodbye",
        _provenance: {
          title: {
            origin: "copy",
            sourceLocale: "en",
            sourceRevision: englishNow,
          },
        },
      });
      expect((await overviewOf(id)).es.fields?.title).toMatchObject({
        origin: "copy",
        outOfDate: false,
      });

      // A copy that doesn't say which version of its source it read can't be shown to be of the
      // source as it is: out of date until it is copied again.
      await save(id, "es", {
        summary: "Short",
        _provenance: { summary: { origin: "copy", sourceLocale: "en" } },
      });
      expect((await overviewOf(id)).es.fields?.summary).toMatchObject({
        origin: "copy",
        outOfDate: true,
      });

      // A version that is not one is refused before anything is written.
      const refused = await handler().updateEntry(
        {
          collectionName: "posts",
          entryId: id,
          overrideAccess: true,
          locale: "es",
          user: { id: "ann" },
        },
        {
          title: "Hola",
          _overwrite: true,
          _provenance: {
            title: {
              origin: "copy",
              sourceLocale: "en",
              sourceRevision: "not a version",
            },
          },
        }
      );
      expect(refused).toMatchObject({ success: false, statusCode: 400 });
    });

    it("marks a Single's copy out of date when its source moved between the copy and the save", async () => {
      await boot(dialect);
      const singles = container.get<SingleEntryService>("singleEntryService");
      await singles.update(
        "notice",
        { headline: "Hello", status: "published", _overwrite: true },
        { overrideAccess: true, locale: "en" }
      );
      const englishRead = await singles.get("notice", {
        overrideAccess: true,
        locale: "en",
      });
      const copiedAt = (englishRead.data as Record<string, unknown>)._rev;
      expect(typeof copiedAt).toBe("string");
      await singles.update(
        "notice",
        { headline: "Goodbye", status: "published", _overwrite: true },
        { overrideAccess: true, locale: "en" }
      );
      await singles.update(
        "notice",
        {
          headline: "Hello",
          status: "published",
          _overwrite: true,
          _provenance: {
            headline: {
              origin: "copy",
              sourceLocale: "en",
              sourceRevision: copiedAt,
            },
          },
        },
        { overrideAccess: true, locale: "es" }
      );
      const read = await singles.get("notice", {
        overrideAccess: true,
        translationStatus: true,
      });
      const overview = (read.data as Record<string, unknown>)
        ._translations as Record<string, LocaleTranslationMeta>;
      expect(overview.es.fields?.headline).toMatchObject({
        origin: "copy",
        outOfDate: true,
      });
      expect(overview.es.stale).toBe(true);

      // Copied again from English as it now stands, then a copy that names no version.
      const englishNow = (
        (await singles.get("notice", { overrideAccess: true, locale: "en" }))
          .data as Record<string, unknown>
      )._rev;
      const copyAt = async (sourceRevision: unknown) => {
        await singles.update(
          "notice",
          {
            headline: "Goodbye",
            status: "published",
            _overwrite: true,
            _provenance: {
              headline: {
                origin: "copy",
                sourceLocale: "en",
                ...(sourceRevision === undefined ? {} : { sourceRevision }),
              },
            },
          },
          { overrideAccess: true, locale: "es" }
        );
        const again = await singles.get("notice", {
          overrideAccess: true,
          translationStatus: true,
        });
        return (
          (again.data as Record<string, unknown>)._translations as Record<
            string,
            LocaleTranslationMeta
          >
        ).es.fields?.headline;
      };
      expect(await copyAt(englishNow)).toMatchObject({ outOfDate: false });
      expect(await copyAt(undefined)).toMatchObject({ outOfDate: true });
    });

    it("never marks a field its language has cleared", async () => {
      // A cleared translation has no value of its own to fall out of date: the language reads the
      // field from another one. Its source changing says nothing about the language.
      await boot(dialect);
      const id = await translatedPost();
      await save(id, "es", { summary: "" });
      await save(id, "en", { summary: "Brief" });
      const overview = await overviewOf(id);
      expect(overview.es.stale).toBeUndefined();
      expect(overview.es.fields?.summary).toBeUndefined();
      expect(overview.es.fields?.title).toMatchObject({ outOfDate: false });
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

    it("shows a published read of a Single no provenance for a language whose translation is only a draft", async () => {
      await boot(dialect);
      const singles = container.get<SingleEntryService>("singleEntryService");
      await singles.update(
        "notice",
        { headline: "Sale", status: "published", _overwrite: true },
        { overrideAccess: true, locale: "en" }
      );
      await singles.update(
        "notice",
        { headline: "Rebajas", status: "draft", _overwrite: true },
        { overrideAccess: true, locale: "es" }
      );

      const read = await singles.get("notice", {
        overrideAccess: true,
        status: "published",
        translationStatus: true,
      });
      expect(read.success).toBe(true);
      const overview = (read.data as Record<string, unknown>)
        ._translations as Record<string, LocaleTranslationMeta>;
      // The draft is hidden from this read, and so is what it records.
      expect(overview.es.translated).toBe(false);
      expect(overview.es.fields).toBeUndefined();
      expect(overview.en.fields?.headline).toMatchObject({
        origin: "original",
      });
    });
  }
);
