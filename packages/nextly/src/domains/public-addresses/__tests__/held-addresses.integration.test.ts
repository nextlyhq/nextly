/**
 * The addresses a document holds now, in each of the site's languages: the
 * address its type gives it in each language it is published in, read on the
 * save's own transaction so the save's uncommitted values are what count.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields/helpers";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { addressLanguages, heldIn, readEveryLanguage } from "../held-addresses";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    localization: { locales: ["en", "fr"], defaultLocale: "en" },
    collections: [
      // Translated, published per language, with a translated slug.
      defineCollection({
        slug: "articles",
        localized: true,
        status: true,
        fields: [
          text({ name: "title", localized: false }),
          text({ name: "slug" }),
        ],
        publicAddress: "/articles/{slug}",
      }),
      // Shared in every language, with Draft/Published.
      defineCollection({
        slug: "posts",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/blog/{slug}",
      }),
      // No Draft/Published: every entry is live.
      defineCollection({
        slug: "faqs",
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/faq/{slug}",
      }),
      defineCollection({
        slug: "notes",
        fields: [text({ name: "title" }), text({ name: "slug" })],
      }),
    ],
  });
  return current;
}

/** What the document `id` of `collection` holds, read as a save would. */
async function holds(
  t: TestNextly,
  collection: string,
  id: string,
  data: Record<string, unknown>
) {
  return t.adapter.transaction(async tx => {
    const perLanguage = await readEveryLanguage(tx, {
      collection,
      id,
      data,
      operation: "update",
    });
    return {
      perLanguage,
      held: await heldIn(
        { kind: "collection", slug: collection },
        perLanguage,
        tx
      ),
    };
  });
}

describe.each(getConfiguredTestDialects())(
  "the addresses a document holds (%s)",
  dialect => {
    it("lists the site's languages", async () => {
      await boot(dialect);
      expect(addressLanguages()).toEqual(["en", "fr"]);
    });

    it("holds a translated slug only in the languages it is published in", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: "articles",
        locale: "en",
        data: { title: "Hello", slug: "hello", status: "published" },
      });
      const id = String(created.item.id);
      const fr = await t.nextly.update({
        collection: "articles",
        id,
        locale: "fr",
        data: { slug: "bonjour", status: "draft", _overwrite: true },
      });

      const { perLanguage, held } = await holds(
        t,
        "articles",
        id,
        fr.item as Record<string, unknown>
      );

      expect(perLanguage.get("en")).toMatchObject({
        published: true,
        document: { slug: "hello" },
      });
      expect(perLanguage.get("fr")).toMatchObject({
        published: false,
        document: { slug: "bonjour" },
      });
      expect(held).toEqual([{ locale: "en", path: "/articles/hello" }]);
    });

    it("holds a shared slug in every language once published", async () => {
      const t = await boot(dialect);
      const post = (
        await t.nextly.create({
          collection: "posts",
          data: { title: "Hello", slug: "hello", status: "published" },
        })
      ).item as Record<string, unknown>;

      const { held } = await holds(t, "posts", String(post.id), post);

      expect(held).toEqual([
        { locale: "en", path: "/blog/hello" },
        { locale: "fr", path: "/blog/hello" },
      ]);
    });

    it("holds nothing while a draft", async () => {
      const t = await boot(dialect);
      const post = (
        await t.nextly.create({
          collection: "posts",
          data: { title: "Hello", slug: "hello", status: "draft" },
        })
      ).item as Record<string, unknown>;

      expect((await holds(t, "posts", String(post.id), post)).held).toEqual([]);
    });

    it("counts every entry of a type without Draft/Published as published", async () => {
      const t = await boot(dialect);
      const faq = (
        await t.nextly.create({
          collection: "faqs",
          data: { title: "Why", slug: "why" },
        })
      ).item as Record<string, unknown>;

      expect((await holds(t, "faqs", String(faq.id), faq)).held).toEqual([
        { locale: "en", path: "/faq/why" },
        { locale: "fr", path: "/faq/why" },
      ]);
    });

    it("holds nothing where the slug is empty", async () => {
      const t = await boot(dialect);
      const faq = (
        await t.nextly.create({
          collection: "faqs",
          data: { title: "Why", slug: "why" },
        })
      ).item as Record<string, unknown>;

      // A save that leaves the slug empty: a create would fill it from the
      // title, so the document the save leaves is handed over as it stands.
      expect(
        (await holds(t, "faqs", String(faq.id), { ...faq, slug: "" })).held
      ).toEqual([]);
    });

    it("holds nothing for a type with no address", async () => {
      const t = await boot(dialect);
      const note = (
        await t.nextly.create({
          collection: "notes",
          data: { title: "Hi", slug: "hi" },
        })
      ).item as Record<string, unknown>;

      expect((await holds(t, "notes", String(note.id), note)).held).toEqual([]);
    });
  }
);
