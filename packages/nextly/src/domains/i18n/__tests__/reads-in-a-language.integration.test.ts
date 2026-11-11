/**
 * Reading content in a language: each translatable value in that language,
 * filled from its fallback languages over published values only, and honest
 * about what it is.
 *
 * Every case reads through the Direct API as a public reader reads: published
 * content only (`status: "published"`).
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { createDynamicHandlers } from "../../../routeHandler";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

/** Translated, with a translatable unique `slug`. */
const DOCS = "rlang_docs";
/** A translated Single. */
const SITE = "rlang_site";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    // The boot's seeding, so a visitor's REST read is judged by the Public
    // role, which the `read` rule below grants.
    seedPublic: true,
    collections: [
      defineCollection({
        slug: DOCS,
        localized: true,
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          text({ name: "body" }),
          text({ name: "slug", unique: true }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: SITE,
        localized: true,
        status: true,
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return current;
}

/** The Single service, as reads and writes reach it. */
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
    ): Promise<{
      success: boolean;
      statusCode?: number;
      data?: Record<string, unknown> | null;
    }>;
  };

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

/** A visitor's REST GET of `path`, with `query` (`?locale=…`). */
async function restGet(
  path: string[],
  query: string
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await createDynamicHandlers().GET(
    new Request(`http://localhost/api/${path.join("/")}${query}`, {
      headers: { origin: "http://localhost" },
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

/** A visitor's REST read of one document, with `query`. */
const restRead = (id: string, query: string) =>
  restGet(["collections", DOCS, "entries", id], query);

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
      // Published in Spanish too, with no Spanish slug or body of its own.
      const englishSlug = await publishedInEnglish(t, {
        title: "B in English",
        body: "B body",
        slug: "hola",
      });
      await publishIn(t, englishSlug, "es", { title: "B en español" });

      const read = await readAs(t, englishSlug, "es");
      // The control: a field that is not unique falls back as it should.
      expect(read.body).toBe("B body");
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

    // A document not published in a language is, to a reader of that
    // language, not there: a get-one answers not found, and a list leaves it
    // out. A published language and the default are the controls.
    it("answers not found for a public read in a language the document is not published in", async () => {
      const t = await boot(dialect);
      const englishOnly = await publishedInEnglish(t, {
        title: "B in English",
        slug: "b",
      });
      const both = await publishedInEnglish(t, {
        title: "A in English",
        slug: "a",
      });
      await publishIn(t, both, "es", { title: "A en español", slug: "a-es" });

      await expect(readAs(t, englishOnly, "es")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect((await readAs(t, englishOnly, "en")).title).toBe("B in English");
      expect((await readAs(t, both, "es")).title).toBe("A en español");

      const listed = (await t.nextly.find({
        collection: DOCS,
        locale: "es",
        status: "published",
      })) as { items: { id: string }[]; meta: { total?: number } };
      expect(listed.items.map(item => item.id)).toEqual([both]);
    }, 90_000);

    // Asked for, whole-document fallback answers in the first published
    // language of the chain and says which; where the requested language is
    // published, it answers in that one.
    it("answers in the first published language with whole-document fallback, and says which", async () => {
      const t = await boot(dialect);
      const englishOnly = await publishedInEnglish(t, {
        title: "B in English",
        slug: "b",
      });
      const both = await publishedInEnglish(t, {
        title: "A in English",
        slug: "a",
      });
      await publishIn(t, both, "es", { title: "A en español", slug: "a-es" });

      const fellBack = (await t.nextly.findByID({
        collection: DOCS,
        id: englishOnly,
        locale: "es",
        status: "published",
        wholeDocumentFallback: true,
      })) as Record<string, unknown>;
      expect(fellBack).toMatchObject({ title: "B in English", _locale: "en" });

      const own = (await t.nextly.findByID({
        collection: DOCS,
        id: both,
        locale: "es",
        status: "published",
        wholeDocumentFallback: true,
      })) as Record<string, unknown>;
      expect(own).toMatchObject({ title: "A en español", _locale: "es" });
    }, 90_000);

    // The same two answers through REST, to a visitor: not found by default,
    // and with `?fallback=document` the first published language, named.
    it("answers a visitor's REST read the same way, with ?fallback=document to opt in", async () => {
      const t = await boot(dialect);
      const englishOnly = await publishedInEnglish(t, {
        title: "B in English",
        slug: "b",
      });

      const missing = await restRead(englishOnly, "?locale=es");
      expect(missing.status, JSON.stringify(missing.json)).toBe(404);

      const fellBack = await restRead(
        englishOnly,
        "?locale=es&fallback=document"
      );
      expect(fellBack.status, JSON.stringify(fellBack.json)).toBe(200);
      expect(fellBack.json).toMatchObject({
        title: "B in English",
        _locale: "en",
      });

      // A fallback the API does not know is refused, never ignored.
      const unknown = await restRead(englishOnly, "?locale=es&fallback=field");
      expect(unknown.status, JSON.stringify(unknown.json)).toBe(400);
    }, 90_000);

    // A Single answers as an entry does: not found in a language it is not
    // published in, and in the first published language with whole-document
    // fallback, named.
    it("answers a Single's public read the same way", async () => {
      const t = await boot(dialect);
      const singles = singlesOf(t);
      const saved = await singles.update(
        SITE,
        { title: "Site in English", status: "published", _overwrite: true },
        { locale: "en", overrideAccess: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);

      const missing = await singles.get(SITE, {
        locale: "es",
        status: "published",
      });
      expect(missing.statusCode, JSON.stringify(missing)).toBe(404);
      expect(
        (await singles.get(SITE, { locale: "en", status: "published" })).data
          ?.title
      ).toBe("Site in English");

      const fellBack = await singles.get(SITE, {
        locale: "es",
        status: "published",
        wholeDocumentFallback: true,
      });
      expect(fellBack.success, JSON.stringify(fellBack)).toBe(true);
      expect(fellBack.data).toMatchObject({
        title: "Site in English",
        _locale: "en",
      });
    }, 90_000);

    // A Single through REST and the Direct API answers as an entry does: not
    // found by default, and with whole-document fallback asked for, the first
    // published language, named.
    it("answers a Single's REST and Direct API reads the same way", async () => {
      const t = await boot(dialect);
      const saved = await singlesOf(t).update(
        SITE,
        { title: "Site in English", status: "published", _overwrite: true },
        { locale: "en", overrideAccess: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);

      const missing = await restGet(["singles", SITE], "?locale=es");
      expect(missing.status, JSON.stringify(missing.json)).toBe(404);
      const fellBack = await restGet(
        ["singles", SITE],
        "?locale=es&fallback=document"
      );
      expect(fellBack.status, JSON.stringify(fellBack.json)).toBe(200);
      expect(JSON.stringify(fellBack.json)).toContain('"_locale":"en"');

      const direct = (await t.nextly.findSingle({
        slug: SITE,
        locale: "es",
        status: "published",
        wholeDocumentFallback: true,
      })) as Record<string, unknown>;
      expect(direct).toMatchObject({ title: "Site in English", _locale: "en" });
    }, 90_000);
  }
);
