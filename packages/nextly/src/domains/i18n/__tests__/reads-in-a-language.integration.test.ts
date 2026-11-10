/**
 * Reading content in a language: each translatable value in that language,
 * filled from its fallback languages over published values only, and honest
 * about what it is.
 *
 * Every case reads through the Direct API as a public reader reads: published
 * content only (`status: "published"`).
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

/** Translated, with a translatable unique `slug`. */
const DOCS = "rlang_docs";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: DOCS,
        localized: true,
        status: true,
        access: { read: () => true },
        fields: [text({ name: "title" }), text({ name: "slug", unique: true })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return current;
}

/** Creates a document published in English, and returns its id. */
async function publishedInEnglish(
  t: TestNextly,
  data: Record<string, unknown>
): Promise<string> {
  const created = (await t.nextly.create({
    collection: DOCS,
    locale: "en",
    data: { ...data, status: "published" },
  })) as { item: { id: string } };
  return created.item.id;
}

/** Writes and publishes `data` in `locale`. */
async function publishIn(
  t: TestNextly,
  id: string,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  await t.nextly.update({
    collection: DOCS,
    id,
    locale,
    data: { ...data, status: "published", _overwrite: true },
  });
}

/** A public reader's read of one document in `locale`. */
async function readAs(
  t: TestNextly,
  id: string,
  locale: string
): Promise<Record<string, unknown>> {
  return (await t.nextly.findByID({
    collection: DOCS,
    id,
    locale,
    status: "published",
  })) as Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "reads in a language (integration, %s)",
  dialect => {
    // A unique value identifies one document in one language. Filled from
    // another language, a Spanish read would show an English slug the Spanish
    // lookup can never find, and two documents would answer one address.
    it("never fills a unique field from another language, in a read or a lookup", async () => {
      const t = await boot(dialect);
      const translated = await publishedInEnglish(t, {
        title: "A in English",
        slug: "uno",
      });
      await publishIn(t, translated, "es", {
        title: "A en español",
        slug: "hola",
      });
      const englishOnly = await publishedInEnglish(t, {
        title: "B in English",
        slug: "hola",
      });

      const read = await readAs(t, englishOnly, "es");
      // The control: a field that is not unique falls back as it should.
      expect(read.title).toBe("B in English");
      expect(read.slug ?? null).toBeNull();

      const found = (await t.nextly.find({
        collection: DOCS,
        locale: "es",
        status: "published",
        where: { slug: { equals: "hola" } },
      })) as { items: { id: string; slug?: unknown }[] };
      expect(found.items.map(item => item.id)).toEqual([translated]);
      expect(found.items[0]?.slug).toBe("hola");
    }, 90_000);
  }
);
