/**
 * Reading content in a language: each translatable value in that language,
 * filled from its fallback languages over published values only, and honest
 * about what it is.
 *
 * Every case reads through the Direct API as a public reader reads: published
 * content only (`status: "published"`).
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, json, text } from "../../../config";
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
// A collection and a Single with a translated structured value, and a field
// withheld from a read in Spanish.
const DATA = "rlang_data";
const SITE_DATA = "rlang_site_data";

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
          // Translated, and withheld from every reader by its read rule.
          text({ name: "note", access: { read: () => false } }),
          // Translated, and withheld from a read in Spanish only.
          text({
            name: "regional",
            access: { read: ({ locale }) => locale !== "es" },
          }),
        ],
      }),
      defineCollection({
        slug: DATA,
        localized: true,
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          json({ name: "meta", localized: true }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: SITE,
        localized: true,
        status: true,
        access: { read: () => true },
        fields: [text({ name: "title" }), text({ name: "tagline" })],
      }),
      defineSingle({
        slug: SITE_DATA,
        localized: true,
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          json({ name: "meta", localized: true }),
          text({
            name: "regional",
            access: { read: ({ locale }) => locale !== "es" },
          }),
        ],
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

    // Asked for, a read says for each translatable field which language its
    // value came from: the requested one, a fallback language, or none.
    it("says which language each translatable value came from, on request", async () => {
      const t = await boot(dialect);
      const id = await publishedInEnglish(t, {
        title: "A in English",
        body: "English body",
        slug: "a",
      });
      // Spanish has its own title and slug, and no body of its own.
      await publishIn(t, id, "es", { title: "A en español", slug: "a-es" });

      const read = (await t.nextly.findByID({
        collection: DOCS,
        id,
        locale: "es",
        status: "published",
        sourceLocales: true,
      })) as Record<string, unknown>;
      // A trusted read may read `note`, which no language holds.
      expect(read._sources).toEqual({
        title: "es",
        body: "en",
        slug: "es",
        note: null,
        regional: null,
      });

      // Not asked for, a read carries no sources.
      expect((await readAs(t, id, "es"))._sources).toBeUndefined();

      // A visitor, whom `note`'s read rule refuses, is told nothing of it.
      const rest = await restRead(id, "?locale=es&source-locales=1");
      expect(rest.status, JSON.stringify(rest.json)).toBe(200);
      expect(rest.json._sources).toEqual({
        title: "es",
        body: "en",
        slug: "es",
      });
    }, 90_000);

    // Whole-document fallback applies to a read of one document: a list asked
    // for it is refused, never read without it.
    it("refuses ?fallback=document on a list read", async () => {
      await boot(dialect);
      const listed = await restGet(
        ["collections", DOCS, "entries"],
        "?locale=es&fallback=document"
      );
      expect(listed.status, JSON.stringify(listed.json)).toBe(400);
    }, 90_000);

    // A Single says its values' languages as an entry does.
    it("says which language each of a Single's translatable values came from", async () => {
      const t = await boot(dialect);
      const singles = singlesOf(t);
      for (const [locale, data] of [
        ["en", { title: "Site in English", tagline: "English tagline" }],
        ["es", { title: "Sitio" }],
      ] as const) {
        const saved = await singles.update(
          SITE,
          { ...data, status: "published", _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }

      const read = await singles.get(SITE, {
        locale: "es",
        status: "published",
        sourceLocales: true,
      });
      expect(read.data?._sources).toEqual({ title: "es", tagline: "en" });
    }, 90_000);

    // One language per read, every field its own type; every language's
    // values beside it through a separate accessor, on request. `locale=all`
    // is that accessor on the default language. A public read's accessor
    // holds published values only; a read allowed drafts sees them.
    it("reads one language with every language's values beside it, on request", async () => {
      const t = await boot(dialect);
      const id = await publishedInEnglish(t, {
        title: "A in English",
        slug: "a",
      });
      // Spanish holds a translation not yet published.
      await t.nextly.update({
        collection: DOCS,
        id,
        locale: "es",
        data: { title: "A en español", slug: "a-es", _overwrite: true },
      });

      const english = (await t.nextly.findByID({
        collection: DOCS,
        id,
        locale: "en",
        status: "published",
        translations: "all",
      })) as Record<string, unknown>;
      expect(english.title).toBe("A in English");
      expect(english._allLocales).toMatchObject({
        title: { en: "A in English", es: null },
      });

      // The alias: the default language, its fields their own type.
      const all = (await t.nextly.findByID({
        collection: DOCS,
        id,
        locale: "all",
        status: "published",
      } as never)) as Record<string, unknown>;
      expect(all.title).toBe("A in English");
      expect(all._allLocales).toMatchObject({
        title: { en: "A in English", es: null },
      });

      // A read allowed drafts sees Spanish's draft in the accessor.
      const drafts = (await t.nextly.findByID({
        collection: DOCS,
        id,
        locale: "en",
        status: "all",
        translations: "all",
      })) as Record<string, unknown>;
      expect(drafts._allLocales).toMatchObject({
        title: { en: "A in English", es: "A en español" },
      });

      const rest = await restRead(id, "?locale=en&translations=all");
      expect(rest.status, JSON.stringify(rest.json)).toBe(200);
      expect(rest.json.title).toBe("A in English");
      expect(rest.json._allLocales).toMatchObject({
        title: { en: "A in English", es: null },
      });
    }, 90_000);

    // Every language's values are the row's own fields in other languages, so
    // they say only what the reader may read of the row: a field its read
    // rule withholds is absent beside the row as it is from it.
    it("says beside a read only the fields the reader may read", async () => {
      const t = await boot(dialect);
      const id = await publishedInEnglish(t, {
        title: "Harbour",
        slug: "a",
        note: "kept from readers",
      });
      await publishIn(t, id, "es", {
        title: "Puerto",
        slug: "a-es",
        note: "oculta",
      });
      const one = await restGet(
        ["collections", DOCS, "entries", id],
        "?locale=all"
      );
      const listed = await restGet(
        ["collections", DOCS, "entries"],
        "?locale=all"
      );
      expect(one.status, JSON.stringify(one.json)).toBe(200);
      expect(listed.status, JSON.stringify(listed.json)).toBe(200);
      const [first] = listed.json.items as Record<string, unknown>[];
      for (const read of [one.json, first]) {
        expect(read).not.toHaveProperty("note");
        const every = read._allLocales as Record<string, unknown>;
        // Present, so its missing field is the rule's doing.
        expect(every.title).toMatchObject({ en: "Harbour", es: "Puerto" });
        expect(every).not.toHaveProperty("note");
      }
    }, 90_000);

    // Each language's value is judged as the row read in that language is,
    // so a rule withholding a field in Spanish withholds its Spanish value
    // beside a read in English.
    it("withholds a language's value its read rule refuses in that language", async () => {
      const t = await boot(dialect);
      const id = await publishedInEnglish(t, {
        title: "Harbour",
        slug: "a",
        regional: "Coastal",
      });
      await publishIn(t, id, "es", {
        title: "Puerto",
        slug: "a-es",
        regional: "Costero",
      });
      const read = await restGet(
        ["collections", DOCS, "entries", id],
        "?locale=en&translations=all"
      );
      expect(read.status, JSON.stringify(read.json)).toBe(200);
      expect(read.json.regional).toBe("Coastal");
      const every = read.json._allLocales as Record<
        string,
        Record<string, unknown>
      >;
      // Present, so its missing language is the rule's doing.
      expect(every.title).toMatchObject({ en: "Harbour", es: "Puerto" });
      expect(every.regional).toEqual({ en: "Coastal" });
    }, 90_000);

    // Under the alias a read of every language searches in the default
    // language, as it reads: neither dropped nor matched on another language.
    it("searches a locale=all read in the default language", async () => {
      const t = await boot(dialect);
      const id = await publishedInEnglish(t, { title: "Harbour", slug: "a" });
      await publishIn(t, id, "es", { title: "Puerto", slug: "a-es" });
      // Over REST, where the alias is asked for: the Direct API's `find`
      // takes no search, so a search through it would match every row.
      const search = async (query: string) => {
        const listed = await restGet(["collections", DOCS, "entries"], query);
        expect(listed.status, JSON.stringify(listed.json)).toBe(200);
        return (listed.json.items as { id: string }[]).map(item => item.id);
      };

      // The Spanish value is searchable in Spanish, so an empty answer under
      // the alias is the default language deciding, not a search that missed.
      expect(await search("?locale=es&search=Puerto")).toEqual([id]);
      expect(await search("?locale=all&search=Harbour")).toEqual([id]);
      expect(await search("?locale=all&search=Puerto")).toEqual([]);
    }, 90_000);

    // A read that falls back shows a field from the first language of its
    // chain holding a value, so its filter and its search judge that value:
    // a match is what the reader sees, never a value the read does not show.
    it("filters and searches a read on the value it shows through fallback", async () => {
      const t = await boot(dialect);
      // Spanish holds no title of its own, so a read in Spanish shows English's.
      const fallsBack = await publishedInEnglish(t, {
        title: "Harbour",
        slug: "a",
      });
      await publishIn(t, fallsBack, "es", { body: "Cuerpo", slug: "a-es" });
      // Spanish holds its own title, so a read in Spanish never shows English's.
      const ownTitle = await publishedInEnglish(t, {
        title: "Harbour Bay",
        slug: "b",
      });
      await publishIn(t, ownTitle, "es", { title: "Bahía", slug: "b-es" });
      const ids = async (query: string) => {
        const listed = await restGet(["collections", DOCS, "entries"], query);
        expect(listed.status, JSON.stringify(listed.json)).toBe(200);
        return (listed.json.items as { id: string }[]).map(item => item.id);
      };

      expect(await ids("?locale=es&where[title][equals]=Harbour")).toEqual([
        fallsBack,
      ]);
      expect(await ids("?locale=es&search=Harbour")).toEqual([fallsBack]);
      // Spanish's own value is matched where it is the one shown.
      expect(await ids("?locale=es&search=Bah")).toEqual([ownTitle]);
    }, 90_000);

    // Every language's structured values beside a read are the field's own
    // type, as the row's are: on a driver that stores JSON as text, a value
    // left encoded would reach the reader as a string.
    it("decodes each language's structured values beside a read", async () => {
      const t = await boot(dialect);
      const created = (await t.nextly.create({
        collection: DATA,
        locale: "en",
        data: { title: "One", meta: { n: 1 }, status: "published" },
      })) as { item: { id: string } };
      const id = created.item.id;
      await t.nextly.update({
        collection: DATA,
        id,
        locale: "es",
        data: {
          title: "Uno",
          meta: { n: 2 },
          status: "published",
          _overwrite: true,
        },
      });
      const read = (await t.nextly.findByID({
        collection: DATA,
        id,
        locale: "en",
        status: "published",
        translations: "all",
      })) as Record<string, unknown>;
      // The row's own value decodes, so the side map is the one in question.
      expect(read.meta).toEqual({ n: 1 });
      expect(read._allLocales).toMatchObject({
        meta: { en: { n: 1 }, es: { n: 2 } },
      });
    }, 90_000);

    // A Single reads as an entry does: one language, every field its own
    // type, with every language's values beside it on request, `locale=all`
    // as that accessor on the default language, and each value's language
    // on request, through the service, REST and the Direct API.
    it("reads a Single with every language's values and their sources beside it", async () => {
      const t = await boot(dialect);
      const singles = singlesOf(t);
      for (const [locale, data] of [
        ["en", { title: "Site", meta: { n: 1 }, regional: "Coastal" }],
        ["es", { title: "Sitio", meta: { n: 2 }, regional: "Costero" }],
      ] as const) {
        const saved = await singles.update(
          SITE_DATA,
          { ...data, status: "published", _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }
      const expectEvery = (
        read: Record<string, unknown> | null | undefined
      ) => {
        expect(read?.title).toBe("Site");
        expect(read?.meta).toEqual({ n: 1 });
        const every = read?._allLocales as Record<string, unknown>;
        expect(every).toMatchObject({
          title: { en: "Site", es: "Sitio" },
          meta: { en: { n: 1 }, es: { n: 2 } },
        });
        // Withheld in Spanish by its read rule, beside the row as in it.
        expect(every.regional).toEqual({ en: "Coastal" });
      };

      const asked = await singles.get(SITE_DATA, {
        locale: "en",
        status: "published",
        translations: "all",
        overrideAccess: false,
      });
      expectEvery(asked.data);
      const alias = await singles.get(SITE_DATA, {
        locale: "all",
        status: "published",
        overrideAccess: false,
      });
      expectEvery(alias.data);

      for (const query of ["?locale=en&translations=all", "?locale=all"]) {
        const rest = await restGet(["singles", SITE_DATA], query);
        expect(rest.status, JSON.stringify(rest.json)).toBe(200);
        expectEvery(rest.json);
      }
      const direct = (await t.nextly.findSingle({
        slug: SITE_DATA,
        locale: "en",
        status: "published",
        translations: "all",
        overrideAccess: false,
      })) as Record<string, unknown>;
      expectEvery(direct);

      const sources = await restGet(
        ["singles", SITE_DATA],
        "?locale=es&source-locales=1"
      );
      expect(sources.status, JSON.stringify(sources.json)).toBe(200);
      expect(sources.json._sources).toMatchObject({ title: "es", meta: "es" });
      const directSources = (await t.nextly.findSingle({
        slug: SITE_DATA,
        locale: "es",
        status: "published",
        sourceLocales: true,
      })) as Record<string, unknown>;
      expect(directSources._sources).toMatchObject({ title: "es", meta: "es" });
    }, 90_000);
  }
);
