/**
 * Every language's values beside a read (`translations=all`, `_allLocales`)
 * stay behind the same guards as the document: the read rule judges each
 * language's values, no hook is handed a value a rule withholds, and no
 * password leaves in any language.
 *
 * @module domains/i18n/__tests__/every-language-values-stay-guarded.integration.test
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import {
  defineCollection,
  defineSingle,
  group,
  password,
  relationship,
  text,
} from "../../../config";
import { createDynamicHandlers } from "../../../routeHandler";
import { createPublicSingleRoute } from "../../../runtime/routing/single-route";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

const FILTERED = "evg_filtered";
const ECHOED = "evg_echoed";
const GATED = "evg_gated";
const LANGUAGE_GATED = "evg_language_gated";
const LANGUAGES_GATED = "evg_languages_gated";
const SITE = "evg_site";

/** What collection-level read hooks were shown beside each row. */
const besideSeen: string[] = [];

/** A shared field whose read hook answers with every language's values it was shown. */
const echo = () =>
  text({
    name: "echo",
    localized: false,
    hooks: {
      afterRead: [
        ({ data }: { data?: Record<string, unknown> }) =>
          JSON.stringify(data?._allLocales ?? null),
      ],
    },
  });

/** A translated group whose read hook puts a password value back. */
const vault = () =>
  group({
    name: "vault",
    localized: true,
    hooks: {
      afterRead: [
        ({ value }: { value: unknown }) =>
          value !== null && typeof value === "object"
            ? { ...(value as Record<string, unknown>), pin: "restored-pin" }
            : value,
      ],
    },
    fields: [text({ name: "label" }), password({ name: "pin" })],
  });

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  besideSeen.length = 0;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    seedPublic: true,
    collections: [
      defineCollection({
        slug: FILTERED,
        localized: true,
        status: true,
        // Readable where the title is "Public": a filter, judged in a language.
        access: {
          read: () => ({ title: { equals: "Public" } }) as unknown as boolean,
        },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: LANGUAGE_GATED,
        localized: true,
        status: true,
        // Readable in any language but Spanish, judged on the one language.
        access: {
          read: ({ locale }: { locale?: string }) => locale !== "es",
        },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: ECHOED,
        localized: true,
        status: true,
        access: { read: () => true },
        hooks: {
          afterRead: [
            ({ data }: { data?: Record<string, unknown> }) => {
              besideSeen.push(JSON.stringify(data?._allLocales ?? null));
            },
          ],
        },
        fields: [
          text({ name: "title" }),
          // Translated, and withheld from every reader by its read rule.
          text({ name: "note", access: { read: () => false } }),
          echo(),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: GATED,
        localized: true,
        status: true,
        // Readable in any language but Spanish.
        access: {
          read: ({ locale }: { locale?: string }) => locale !== "es",
        },
        fields: [text({ name: "title" })],
      }),
      defineSingle({
        slug: LANGUAGES_GATED,
        localized: true,
        status: true,
        // Refuses a read that involves Spanish at all.
        access: {
          read: ({ locales }: { locales?: readonly string[] }) =>
            !(locales ?? []).includes("es"),
        },
        fields: [text({ name: "title" })],
      }),
      defineSingle({
        slug: SITE,
        localized: true,
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          text({ name: "secret", access: { read: () => false } }),
          echo(),
          vault(),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return current;
}

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

/** Writes and publishes an entry in English, then in Spanish. */
async function entryInBoth(
  t: TestNextly,
  collection: string,
  en: Record<string, unknown>,
  es: Record<string, unknown>
): Promise<string> {
  const created = await t.nextly.create({
    collection,
    locale: "en",
    data: { ...en, status: "published" },
  });
  const id = String(created.item.id);
  await t.nextly.update({
    collection,
    id,
    locale: "es",
    data: { ...es, status: "published", _overwrite: true },
  });
  return id;
}

/** Writes and publishes a Single in English, then in Spanish. */
async function singleInBoth(
  t: TestNextly,
  slug: string,
  en: Record<string, unknown>,
  es: Record<string, unknown>
): Promise<void> {
  const singles = t.getService("singleEntryService") as unknown as {
    update(
      slug: string,
      data: Record<string, unknown>,
      options: Record<string, unknown>
    ): Promise<{ success: boolean }>;
  };
  for (const [locale, data] of [
    ["en", en],
    ["es", es],
  ] as const) {
    const saved = await singles.update(
      slug,
      { ...data, status: "published", _overwrite: true },
      { locale, overrideAccess: true }
    );
    expect(saved.success, JSON.stringify(saved)).toBe(true);
  }
}

describe.each(getConfiguredTestDialects())(
  "every language's values stay guarded (integration, %s)",
  dialect => {
    // A read rule answering with a filter admits a document in the language
    // read; a language whose values the filter refuses is not shown beside it.
    it("withholds a language's values the read rule's filter refuses", async () => {
      const t = await boot(dialect);
      const id = await entryInBoth(
        t,
        FILTERED,
        { title: "Public" },
        { title: "Private" }
      );
      // A reader the grant admits, so the filter decides what they see.
      await userWhoMay(t, "evg-reader", "read", [FILTERED]);
      const read = (await t.nextly.findByID({
        collection: FILTERED,
        id,
        locale: "en",
        translations: "all",
        overrideAccess: false,
        user: { id: "evg-reader" },
      })) as Record<string, unknown> | null;
      expect(read?.title).toBe("Public");
      expect(JSON.stringify(read)).not.toContain("Private");
    }, 90_000);

    // A Single's read rule judges each language whose values a read carries.
    it("withholds a Single's language its read rule refuses in that language", async () => {
      const t = await boot(dialect);
      await singleInBoth(t, GATED, { title: "Site" }, { title: "Sitio" });
      const read = await restGet(
        ["singles", GATED],
        "?locale=en&translations=all"
      );
      expect(JSON.stringify(read.json)).not.toContain("Sitio");
    }, 90_000);

    // An entry's read rule judging the one language withholds that language.
    it("withholds an entry's language its read rule refuses in that language", async () => {
      const t = await boot(dialect);
      const id = await entryInBoth(
        t,
        LANGUAGE_GATED,
        { title: "Harbour" },
        { title: "Puerto" }
      );
      const read = await restGet(
        ["collections", LANGUAGE_GATED, "entries", id],
        "?locale=en&translations=all"
      );
      expect(read.status, JSON.stringify(read.json)).toBe(200);
      expect(read.json.title).toBe("Harbour");
      expect(JSON.stringify(read.json)).not.toContain("Puerto");
    }, 90_000);

    // A Single's read rule judging every language involved refuses a read
    // that carries one it refuses.
    it("refuses a Single's read carrying a language its rule refuses", async () => {
      const t = await boot(dialect);
      await singleInBoth(
        t,
        LANGUAGES_GATED,
        { title: "Site" },
        { title: "Sitio" }
      );
      // English alone is readable, so the refusal below is Spanish's doing.
      const english = await restGet(["singles", LANGUAGES_GATED], "?locale=en");
      expect(english.status, JSON.stringify(english.json)).toBe(200);
      const read = await restGet(
        ["singles", LANGUAGES_GATED],
        "?locale=en&translations=all"
      );
      expect(read.status).not.toBe(200);
      expect(JSON.stringify(read.json)).not.toContain("Sitio");
    }, 90_000);

    // A read the route has already admitted, as the dispatcher reads it
    // (`routeAuthorized`), is admitted for the language it asked only: each
    // other language's rule is still asked, for a Single and an entry alike.
    it("asks each language's rule of a read the route admitted", async () => {
      const t = await boot(dialect);
      await singleInBoth(t, GATED, { title: "Site" }, { title: "Sitio" });
      const id = await entryInBoth(
        t,
        LANGUAGE_GATED,
        { title: "Harbour" },
        { title: "Puerto" }
      );
      await userWhoMay(t, "evg-route-reader", "read", [GATED, LANGUAGE_GATED]);
      const asReader = {
        locale: "en",
        translations: "all",
        overrideAccess: false,
        routeAuthorized: true,
        user: { id: "evg-route-reader" },
      };
      const singles = t.getService("singleEntryService") as unknown as {
        get(
          slug: string,
          options: Record<string, unknown>
        ): Promise<{ success: boolean; data?: Record<string, unknown> | null }>;
      };
      const single = await singles.get(GATED, asReader);
      expect(single.success, JSON.stringify(single)).toBe(true);
      expect(single.data?.title).toBe("Site");
      expect(JSON.stringify(single.data)).not.toContain("Sitio");
      const entries = t.getService("collectionsHandler") as unknown as {
        getEntryService(): {
          getEntry(args: Record<string, unknown>): Promise<{
            success: boolean;
            data?: unknown;
          }>;
        };
      };
      const entry = await entries.getEntryService().getEntry({
        collectionName: LANGUAGE_GATED,
        entryId: id,
        ...asReader,
      });
      expect(entry.success, JSON.stringify(entry)).toBe(true);
      expect(JSON.stringify(entry.data)).toContain("Harbour");
      expect(JSON.stringify(entry.data)).not.toContain("Puerto");
    }, 90_000);

    // No hook, of the collection or of a field, is handed a language's value
    // a field rule withholds, so none can copy it out.
    it("hands no read hook an entry's withheld value in any language", async () => {
      const t = await boot(dialect);
      const id = await entryInBoth(
        t,
        ECHOED,
        { title: "Harbour", note: "kept-en" },
        { title: "Puerto", note: "kept-es" }
      );
      const read = await restGet(
        ["collections", ECHOED, "entries", id],
        "?locale=en&translations=all"
      );
      expect(read.status, JSON.stringify(read.json)).toBe(200);
      // Present, so the hooks ran and the read carries every language.
      expect(read.json._allLocales).toMatchObject({
        title: { en: "Harbour", es: "Puerto" },
      });
      expect(JSON.stringify(read.json)).not.toContain("kept-");
      expect(besideSeen.join(" ")).not.toContain("kept-");
    }, 90_000);

    it("hands no read hook a Single's withheld value in any language", async () => {
      const t = await boot(dialect);
      await singleInBoth(
        t,
        SITE,
        { title: "Site", secret: "kept-en" },
        { title: "Sitio", secret: "kept-es" }
      );
      const read = await restGet(
        ["singles", SITE],
        "?locale=en&translations=all"
      );
      expect(read.status, JSON.stringify(read.json)).toBe(200);
      expect(JSON.stringify(read.json)).toContain("Sitio");
      expect(JSON.stringify(read.json)).not.toContain("kept-");
    }, 90_000);

    // A password a field hook puts back is cleared again in every language,
    // as it is in the document.
    it("clears a password a Single's read hook puts back, in every language", async () => {
      const t = await boot(dialect);
      await singleInBoth(
        t,
        SITE,
        { title: "Site", vault: { label: "Key", pin: "en-pin-1234" } },
        { title: "Sitio", vault: { label: "Llave", pin: "es-pin-1234" } }
      );
      const read = await restGet(
        ["singles", SITE],
        "?locale=en&translations=all"
      );
      expect(read.status, JSON.stringify(read.json)).toBe(200);
      expect(JSON.stringify(read.json)).toContain("Llave");
      expect(JSON.stringify(read.json)).not.toContain("restored-pin");
    }, 90_000);
  }
);

// ---------------------------------------------------------------------------
// Every read path, judged per language.
//
// One table: each read path that returns a language's values, against each
// rule a language's values answer to. (c) a public read finds nothing in a
// language that is not published; (a) each language's values answer to the
// read rule in that language; (b) each language's values answer to the field
// rules in that language; (d) a password is cleared from every language after
// the read hooks; and no read hook is handed a withheld language. The
// fixture is booted once per dialect and only read: an entry and a Single
// published in English and Spanish, each with a French draft.
// ---------------------------------------------------------------------------

const PAGES = "evp_pages";
const PEOPLE = "evp_people";
const GATED_PEOPLE = "evp_gated_people";
const GATED_PAGES = "evp_gated_pages";
const HOME = "evp_home";
const HOME_GATED = "evp_home_gated";

const pathsSeen: string[] = [];
const seeAllLocales = ({ data }: { data?: Record<string, unknown> }) => {
  pathsSeen.push(JSON.stringify(data?._allLocales ?? null));
};
const notSpanish = ({ locale }: { locale?: string }) => locale !== "es";

async function bootPaths(dialect: TestDialect): Promise<TestNextly> {
  return createTestNextly({
    dialect,
    seedPublic: true,
    collections: [
      defineCollection({
        slug: PEOPLE,
        localized: true,
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "name" }),
          text({ name: "secret", access: { read: () => false } }),
        ],
      }),
      defineCollection({
        slug: GATED_PEOPLE,
        localized: true,
        status: true,
        access: { read: notSpanish },
        fields: [text({ name: "name" })],
      }),
      defineCollection({
        slug: PAGES,
        localized: true,
        status: true,
        access: { read: () => true },
        hooks: { afterRead: [seeAllLocales] },
        fields: [
          text({ name: "title" }),
          text({ name: "brand", localized: false }),
          text({ name: "memo", access: { read: () => false } }),
          vault(),
          relationship({ name: "author", relationTo: PEOPLE }),
          relationship({ name: "editor", relationTo: PEOPLE }),
          relationship({ name: "gatedAuthor", relationTo: GATED_PEOPLE }),
        ],
      }),
      defineCollection({
        slug: GATED_PAGES,
        localized: true,
        status: true,
        access: { read: notSpanish },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: HOME,
        localized: true,
        status: true,
        access: { read: () => true },
        hooks: { afterRead: [seeAllLocales] },
        fields: [
          text({ name: "title" }),
          text({ name: "brand", localized: false }),
          text({ name: "memo", access: { read: () => false } }),
          vault(),
        ],
      }),
      defineSingle({
        slug: HOME_GATED,
        localized: true,
        status: true,
        access: { read: notSpanish },
        fields: [text({ name: "title" })],
      }),
    ],
    localization: { locales: ["en", "es", "fr"], defaultLocale: "en" },
  });
}

interface Seeded {
  page: string;
  gatedPage: string;
}

/** The Single service, as the dispatcher reaches it. */
const singleService = (t: TestNextly) =>
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

async function seedPaths(t: TestNextly): Promise<Seeded> {
  // Published in English only.
  const ann = String(
    (
      await t.nextly.create({
        collection: PEOPLE,
        locale: "en",
        data: { name: "Ann", status: "published" },
      })
    ).item.id
  );
  const bea = await entryInBoth(
    t,
    PEOPLE,
    { name: "Bea", secret: "s-en" },
    { name: "Bea-es", secret: "s-es" }
  );
  const gil = await entryInBoth(
    t,
    GATED_PEOPLE,
    { name: "Gil" },
    { name: "Gil-es" }
  );
  const page = await entryInBoth(
    t,
    PAGES,
    {
      title: "Page",
      brand: "Acme",
      memo: "m-en",
      vault: { label: "Key", pin: "pin-en-1234" },
      author: ann,
      editor: bea,
      gatedAuthor: gil,
    },
    {
      title: "Pagina",
      memo: "m-es",
      vault: { label: "Llave", pin: "pin-es-1234" },
    }
  );
  // A French draft, never published.
  await t.nextly.update({
    collection: PAGES,
    id: page,
    locale: "fr",
    data: {
      title: "Brouillon",
      memo: "m-fr",
      status: "draft",
      _overwrite: true,
    },
  });
  const gatedPage = await entryInBoth(
    t,
    GATED_PAGES,
    { title: "Harbour" },
    { title: "Puerto" }
  );
  await singleInBoth(
    t,
    HOME,
    {
      title: "Home",
      brand: "Acme",
      memo: "hm-en",
      vault: { label: "Key", pin: "pin-en-1234" },
    },
    {
      title: "Inicio",
      memo: "hm-es",
      vault: { label: "Llave", pin: "pin-es-1234" },
    }
  );
  const draft = await singleService(t).update(
    HOME,
    {
      title: "Accueil brouillon",
      memo: "hm-fr",
      status: "draft",
      _overwrite: true,
    },
    { locale: "fr", overrideAccess: true }
  );
  expect(draft.success, JSON.stringify(draft)).toBe(true);
  await singleInBoth(t, HOME_GATED, { title: "Site" }, { title: "Sitio" });
  return { page, gatedPage };
}

type PathCheck = (t: TestNextly, seeded: Seeded) => Promise<void>;

/** A visitor's REST read, answered 200, as text. */
async function visitorReads(path: string[], query: string): Promise<string> {
  const read = await restGet(path, query);
  expect(read.status, JSON.stringify(read.json)).toBe(200);
  return JSON.stringify(read.json);
}

const pageRead = (s: Seeded, query: string) =>
  visitorReads(["collections", PAGES, "entries", s.page], query);
const pagesListed = (query: string) =>
  visitorReads(["collections", PAGES, "entries"], query);
const homeRead = (query: string) => visitorReads(["singles", HOME], query);

/** Every withheld value of the page and the Single, in every language. */
const WITHHELD = ["m-en", "m-es", "m-fr", "hm-", "s-en", "s-es", "pin-"];
const holdsNoWithheld = (text: string) => {
  for (const value of WITHHELD) expect(text).not.toContain(value);
  expect(text).not.toContain("restored-pin");
};

const PATHS: [string, PathCheck][] = [
  // The fixture reaches every mechanism below: the French drafts are there
  // to a trusted reader, and the related documents are expanded in English.
  [
    "fixture: the French drafts are there to a trusted read",
    async (t, s) => {
      const page = (await t.nextly.findByID({
        collection: PAGES,
        id: s.page,
        locale: "fr",
        status: "all",
      })) as Record<string, unknown>;
      expect(page.title).toBe("Brouillon");
      const home = await singleService(t).get(HOME, {
        locale: "fr",
        status: "all",
        overrideAccess: true,
      });
      expect(home.data?.title, JSON.stringify(home)).toBe("Accueil brouillon");
      const english = await pageRead(s, "?locale=en&depth=1");
      expect(english).toContain("Ann");
      expect(english).toContain("Gil");
    },
  ],

  // (c) A public read finds nothing in a language that is not published.
  [
    "(c) entry by id",
    async (_t, s) => {
      const read = await restGet(
        ["collections", PAGES, "entries", s.page],
        "?locale=fr"
      );
      expect(read.status, JSON.stringify(read.json)).toBe(404);
    },
  ],
  [
    "(c) entry list and count",
    async t => {
      expect(await pagesListed("?locale=fr")).not.toContain('"title":"Page"');
      const counted = await t.nextly.count({
        collection: PAGES,
        locale: "fr",
        status: "published",
      });
      expect(counted.total).toBe(0);
    },
  ],
  [
    "(c) entry with every language beside it",
    async (_t, s) => {
      const text = await pageRead(s, "?locale=en&translations=all");
      expect(text).toContain("Pagina");
      expect(text).not.toContain("Brouillon");
    },
  ],
  [
    "(c) entry list with every language beside it",
    async () => {
      const text = await pagesListed("?locale=en&translations=all");
      expect(text).toContain("Pagina");
      expect(text).not.toContain("Brouillon");
    },
  ],
  [
    "(c) entry read in every language (locale=all)",
    async (_t, s) => {
      const text = await pageRead(s, "?locale=all");
      expect(text).toContain("Pagina");
      expect(text).not.toContain("Brouillon");
    },
  ],
  [
    "(c) entry with whole-document fallback",
    async (_t, s) => {
      const text = await pageRead(s, "?locale=fr&fallback=document");
      expect(text).toContain('"_locale":"en"');
      expect(text).not.toContain("Brouillon");
    },
  ],
  [
    "(c) related documents (depth 1)",
    async (_t, s) => {
      const text = await pageRead(s, "?locale=es&depth=1");
      expect(text).toContain("Pagina");
      expect(text).toContain("Bea-es");
      expect(text).not.toContain("Ann");
    },
  ],
  [
    "(c) entry's translation overview",
    async (_t, s) => {
      const text = await pageRead(s, "?locale=en&translation-status=1");
      expect(text).toContain("_translations");
      expect(text).not.toContain('"draft"');
    },
  ],
  [
    "(c) entry list's language filter",
    async t => {
      for (const state of ["draft", "translated", "published"] as const) {
        const listed = await t.nextly.find({
          collection: PAGES,
          locale: "en",
          status: "published",
          where: { _translated: { locale: "fr", state } } as never,
        });
        expect(listed.items, state).toHaveLength(0);
      }
      const missing = await t.nextly.find({
        collection: PAGES,
        locale: "en",
        status: "published",
        where: { _translated: { locale: "fr", state: "missing" } } as never,
      });
      expect(missing.items).toHaveLength(1);
    },
  ],
  [
    "(c) Single",
    async () => {
      const read = await restGet(["singles", HOME], "?locale=fr");
      expect(read.status, JSON.stringify(read.json)).toBe(404);
    },
  ],
  [
    "(c) Single read of shared fields",
    async t => {
      const read = await singleService(t).get(HOME, {
        locale: "fr",
        select: { brand: true },
        status: "published",
      });
      expect(read.statusCode, JSON.stringify(read)).toBe(404);
    },
  ],
  [
    "(c) Single with every language beside it",
    async () => {
      const text = await homeRead("?locale=en&translations=all");
      expect(text).toContain("Inicio");
      expect(text).not.toContain("brouillon");
    },
  ],
  [
    "(c) Single read in every language (locale=all)",
    async () => {
      const text = await homeRead("?locale=all");
      expect(text).toContain("Inicio");
      expect(text).not.toContain("brouillon");
    },
  ],
  [
    "(c) Single's translation overview",
    async () => {
      const text = await homeRead("?locale=en&translation-status=1");
      expect(text).toContain("_translations");
      expect(text).not.toContain('"draft"');
    },
  ],
  [
    "(c) a public Single route",
    async t => {
      const route = createPublicSingleRoute({
        slug: HOME,
        locale: "fr",
        nextly: t.nextly,
        render: () => null,
        buildMetadata: document => ({ title: String(document.title) }),
      });
      expect(JSON.stringify(await route.generateMetadata())).not.toContain(
        "brouillon"
      );
      const english = createPublicSingleRoute({
        slug: HOME,
        locale: "en",
        nextly: t.nextly,
        render: () => null,
        buildMetadata: document => ({ title: String(document.title) }),
      });
      expect(await english.generateMetadata()).toEqual({ title: "Home" });
    },
  ],

  // (a) Each language's values answer to the read rule in that language.
  [
    "(a) entry with every language beside it",
    async (_t, s) => {
      const text = await visitorReads(
        ["collections", GATED_PAGES, "entries", s.gatedPage],
        "?locale=en&translations=all"
      );
      expect(text).toContain("Harbour");
      expect(text).not.toContain("Puerto");
    },
  ],
  [
    "(a) entry list with every language beside it",
    async () => {
      const text = await visitorReads(
        ["collections", GATED_PAGES, "entries"],
        "?locale=en&translations=all"
      );
      expect(text).toContain("Harbour");
      expect(text).not.toContain("Puerto");
    },
  ],
  [
    "(a) entry read in every language (locale=all)",
    async (_t, s) => {
      const read = await restGet(
        ["collections", GATED_PAGES, "entries", s.gatedPage],
        "?locale=all"
      );
      expect(JSON.stringify(read.json)).not.toContain("Puerto");
    },
  ],
  [
    "(a) Single with every language beside it",
    async () => {
      const text = await visitorReads(
        ["singles", HOME_GATED],
        "?locale=en&translations=all"
      );
      expect(text).toContain("Site");
      expect(text).not.toContain("Sitio");
    },
  ],
  [
    "(a) related documents (depth 1)",
    async (_t, s) => {
      const text = await pageRead(s, "?locale=es&depth=1");
      expect(text).toContain("Pagina");
      expect(text).not.toContain("Gil");
    },
  ],

  // (b) Each language's values answer to the field rules in that language,
  // and (d) a password a read hook puts back is cleared in every language.
  [
    "(b, d) entry with every language beside it",
    async (_t, s) => {
      const text = await pageRead(s, "?locale=en&translations=all");
      expect(text).toContain("Llave");
      holdsNoWithheld(text);
    },
  ],
  [
    "(b, d) entry list with every language beside it",
    async () => {
      const text = await pagesListed("?locale=en&translations=all");
      expect(text).toContain("Llave");
      holdsNoWithheld(text);
    },
  ],
  [
    "(b, d) entry read in every language (locale=all)",
    async (_t, s) => {
      const text = await pageRead(s, "?locale=all");
      expect(text).toContain("Llave");
      holdsNoWithheld(text);
    },
  ],
  [
    "(b, d) entry in one language, and its related documents",
    async (_t, s) => {
      const text = await pageRead(s, "?locale=es&depth=1");
      expect(text).toContain("Llave");
      holdsNoWithheld(text);
    },
  ],
  [
    "(b, d) Single with every language beside it",
    async () => {
      const text = await homeRead("?locale=en&translations=all");
      expect(text).toContain("Llave");
      holdsNoWithheld(text);
    },
  ],
  [
    "(b, d) Single read in every language (locale=all)",
    async () => {
      const text = await homeRead("?locale=all");
      expect(text).toContain("Llave");
      holdsNoWithheld(text);
    },
  ],

  // No read hook is handed a language's withheld value.
  [
    "(hooks) entry and Single read hooks",
    async (_t, s) => {
      pathsSeen.length = 0;
      await pageRead(s, "?locale=en&translations=all");
      await homeRead("?locale=en&translations=all");
      // Both hooks ran; the languages beside the read are reattached after
      // them, so neither is handed one.
      expect(pathsSeen.length).toBeGreaterThanOrEqual(2);
      const seen = pathsSeen.join(" ");
      expect(seen).not.toContain("Pagina");
      expect(seen).not.toContain("Inicio");
      for (const value of WITHHELD) expect(seen).not.toContain(value);
      expect(seen).not.toContain("rouillon");
    },
  ],
];

describe.each(getConfiguredTestDialects())(
  "every read path, judged per language (integration, %s)",
  dialect => {
    let paths: TestNextly | undefined;
    let seeded: Seeded | undefined;
    beforeAll(async () => {
      paths = await bootPaths(dialect);
      seeded = await seedPaths(paths);
    }, 180_000);
    afterAll(async () => {
      await paths?.destroy();
      paths = undefined;
    });

    it.each(PATHS)(
      "%s",
      async (_name, check) => {
        if (!paths || !seeded) throw new Error("the fixture did not boot");
        await check(paths, seeded);
      },
      60_000
    );
  }
);
