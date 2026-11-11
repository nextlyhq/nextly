/**
 * Which pages are listed, decided from each page's answer: a page is listed at
 * its canonical as the answer gives it, a page whose answer has no canonical
 * although its type declares an address has lost that address and is a
 * problem, and a page that is hidden or names another canonical is neither.
 *
 * The answer and core's address answers are stood in for; the record is a
 * list of rows.
 */
import type { PluginContext, PublicAddressType } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SeoAnswer } from "../../resolver/order";
import { listPages } from "../listing";

const answers = new Map<string, SeoAnswer>();
/**
 * Whether the type's address is supplied only for a named language, as a
 * Schema Builder type's template may be.
 */
const supplied = { onlyInALanguage: false };
/** The languages served on a domain of their own, by language. */
const domains: Record<string, string> = {};

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  publicAddressOf: async (
    _type: PublicAddressType,
    entry?: Readonly<Record<string, unknown>>,
    locale?: string
  ) => {
    if (supplied.onlyInALanguage && locale === undefined) {
      return { status: "none" };
    }
    return entry === undefined
      ? { status: "unavailable" }
      : { status: "resolved", path: `/${String(entry.slug)}` };
  },
  // Every language under its code, or on the domain `domains` gives it.
  languageAddressOf: async (path: string, locale: string) =>
    domains[locale] === undefined
      ? { status: "resolved", path: `/${locale}${path}` }
      : { status: "resolved", origin: domains[locale], path },
}));

/** Each read of the pages' documents, with its filter and language. */
const documentReads: { where: unknown; locale?: string }[] = [];

/** The addresses each batch's holders were read for at once. */
const readTogether: string[][] = [];

// Who holds a path, read from the fake record below as the record is read.
vi.mock("../../address-record/participant", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../address-record/participant")
  >()),
  withAddressHolders: async (
    _ctx: PluginContext,
    _locale: string,
    paths: readonly string[],
    work: () => Promise<unknown>
  ) => {
    readTogether.push([...paths]);
    return work();
  },
  addressHolders: async (ctx: PluginContext, path: string, locale: string) => {
    const { data } = await ctx.services.ownCollections.listEntries("", {
      where: {
        and: [
          { kind: { equals: "address" } },
          { locale: { equals: locale } },
          { path: { equals: path } },
        ],
      },
    });
    return (data as Row[]).map(row => ({
      collection: row.holderCollection,
      id: row.holderId,
    }));
  },
}));

/** The language each page was resolved in, by id. */
const resolvedIn = new Map<string, string | undefined>();

vi.mock("../../resolver/provider", () => ({
  resolveSeo: async (
    _ctx: unknown,
    input: { source: { entry: { id: string } }; locale?: string }
  ) => {
    resolvedIn.set(input.source.entry.id, input.locale);
    // A version's own answer where one is set, keyed `<id>@<language>`.
    return (
      answers.get(`${input.source.entry.id}@${input.locale}`) ??
      answers.get(input.source.entry.id)
    );
  },
}));

const SITE = "https://acme.example";
const listed: SeoAnswer["robots"] = {
  value: { index: true, follow: true },
  from: "site",
};

interface Row {
  kind: string;
  locale: string;
  path: string;
  holderCollection: string;
  holderId: string;
}

/** Whether `row` meets one condition of a record read. */
function meets(row: Row, condition: Record<string, unknown>): boolean {
  return Object.entries(condition).every(([field, test]) => {
    const value = row[field as keyof Row];
    const { equals, in: within } = test as { equals?: string; in?: string[] };
    if (equals !== undefined) return value === equals;
    return within?.includes(value) ?? true;
  });
}

/**
 * A plugin context over one collection of `documents` and a record of
 * `rows`, on a site with `languages` where given, the first the default.
 */
function context(
  documents: Record<string, unknown>[],
  rows: Row[],
  languages?: string[],
  registry?: string
) {
  return {
    self: { collections: {} },
    config:
      languages === undefined
        ? {}
        : {
            localization: {
              locales: languages.map(code => ({ code })),
              defaultLocale: languages[0],
            },
          },
    publicAddresses: {
      types: async () => [{ kind: "collection", slug: "pages" }],
      defaultLanguage: async () => registry ?? languages?.[0] ?? "en",
    },
    services: {
      collections: {
        getCollection: async () => ({ status: true }),
        listEntries: async (
          _slug: string,
          query: { where?: unknown },
          opts: { locale?: string }
        ) => {
          documentReads.push({ where: query.where, locale: opts.locale });
          return { data: documents, pagination: { hasMore: false } };
        },
      },
      ownCollections: {
        listEntries: async (
          _slug: string,
          query: { where: { and: Record<string, unknown>[] } }
        ) => ({
          data: rows.filter(row =>
            query.where.and.every(condition => meets(row, condition))
          ),
        }),
      },
    },
  } as unknown as PluginContext;
}

const holds = (id: string, path: string, locale = "en"): Row => ({
  kind: "address",
  locale,
  path,
  holderCollection: "pages",
  holderId: id,
});

describe("the pages the site lists", () => {
  beforeEach(() => {
    answers.clear();
    documentReads.length = 0;
    for (const language of Object.keys(domains)) delete domains[language];
  });

  it("lists a page at its canonical as its answer gives it", async () => {
    answers.set("1", {
      robots: listed,
      canonical: { value: "/de/ueber", from: "address" },
    });
    const { pages, problems } = await listPages(
      context([{ id: "1", slug: "ueber" }], [holds("1", "/ueber")]),
      { origin: SITE }
    );
    expect(pages.map(page => page.loc)).toEqual([`${SITE}/de/ueber`]);
    expect(problems).toEqual([]);
  });

  it("leaves a page whose canonical is on another of the site's addresses to that address's sitemap", async () => {
    answers.set("1", {
      robots: listed,
      canonical: { value: "https://acme.de/ueber", from: "address" },
    });
    const { pages, problems } = await listPages(
      context([{ id: "1", slug: "ueber" }], [holds("1", "/ueber")]),
      { origin: SITE }
    );
    expect(pages).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("leaves out a page whose answer has no canonical, and lists it as a problem naming the page holding its address", async () => {
    answers.set("1", { robots: listed });
    answers.set("2", {
      robots: listed,
      canonical: { value: "/about", from: "address" },
    });
    const { pages, problems } = await listPages(
      context(
        [
          { id: "1", slug: "about" },
          { id: "2", slug: "about" },
        ],
        [holds("2", "/about")]
      ),
      { origin: SITE }
    );
    expect(pages.map(page => page.loc)).toEqual([`${SITE}/about`]);
    expect(problems).toEqual([
      {
        kind: "held-by-another",
        holder: { collection: "pages", id: "1" },
        path: "/about",
        language: "en",
        heldBy: { collection: "pages", id: "2" },
      },
    ]);
  });

  it("lists a page with no canonical whose address no page holds as not recorded", async () => {
    answers.set("1", { robots: listed });
    const { pages, problems } = await listPages(
      context([{ id: "1", slug: "about" }], []),
      { origin: SITE }
    );
    expect(pages).toEqual([]);
    expect(problems).toEqual([
      {
        kind: "not-recorded",
        holder: { collection: "pages", id: "1" },
        path: "/about",
        language: "en",
      },
    ]);
  });

  it("lists neither a hidden page nor one whose canonical names another page", async () => {
    answers.set("1", {
      robots: { value: { index: false, follow: true }, from: "page" },
    });
    answers.set("2", {
      robots: listed,
      canonical: { value: "/about", from: "page" },
    });
    const { pages, problems } = await listPages(
      context(
        [
          { id: "1", slug: "hidden" },
          { id: "2", slug: "copy" },
        ],
        [holds("1", "/hidden"), holds("2", "/copy")]
      ),
      { origin: SITE }
    );
    expect(pages).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("counts a page as holding its address only in the language it is listed in", async () => {
    // The first page holds `/about` in French alone; the second holds it in
    // English. Each is listed in the language it holds it in, and the first
    // is a problem in English, where the second holds it.
    for (const id of ["1", "2"]) {
      answers.set(id, {
        robots: listed,
        canonical: { value: "/en/about", from: "address" },
      });
    }
    answers.set("1@fr", {
      robots: listed,
      canonical: { value: "/fr/about", from: "address" },
    });
    const { pages, problems } = await listPages(
      context(
        [
          { id: "1", slug: "about" },
          { id: "2", slug: "about" },
        ],
        [holds("1", "/about", "fr"), holds("2", "/about", "en")],
        ["en", "fr"]
      ),
      { origin: SITE }
    );
    expect(
      pages.map(page => [page.holder.id, page.language, page.loc])
    ).toEqual([
      ["1", "fr", `${SITE}/fr/about`],
      ["2", "en", `${SITE}/en/about`],
    ]);
    expect(problems).toEqual([
      {
        kind: "held-by-another",
        holder: { collection: "pages", id: "1" },
        path: "/about",
        language: "en",
        heldBy: { collection: "pages", id: "2" },
      },
    ]);
  });

  it("keeps a page whose typed canonical is its own address as its language serves it", async () => {
    answers.set("1", {
      robots: listed,
      canonical: { value: `${SITE}/en/about`, from: "page" },
    });
    const { pages } = await listPages(
      context(
        [{ id: "1", slug: "about" }],
        [holds("1", "/about")],
        ["en", "fr"]
      ),
      { origin: SITE }
    );
    expect(pages.map(page => page.loc)).toEqual([`${SITE}/en/about`]);
  });

  it("asks a type's address in the language the record keeps it in", async () => {
    supplied.onlyInALanguage = true;
    try {
      answers.set("1", {
        robots: listed,
        canonical: { value: "/about", from: "address" },
      });
      const { pages, problems } = await listPages(
        context([{ id: "1", slug: "about" }], [holds("1", "/about")]),
        { origin: SITE }
      );
      expect(pages.map(page => page.loc)).toEqual([`${SITE}/about`]);
      expect(problems).toEqual([]);
    } finally {
      supplied.onlyInALanguage = false;
    }
  });

  it("reads who holds each page's address once for the whole batch", async () => {
    readTogether.length = 0;
    for (const id of ["1", "2"]) {
      answers.set(id, {
        robots: listed,
        canonical: { value: id === "1" ? "/about" : "/team", from: "address" },
      });
    }
    await listPages(
      context(
        [
          { id: "1", slug: "about" },
          { id: "2", slug: "team" },
        ],
        [holds("1", "/about"), holds("2", "/team")]
      ),
      { origin: SITE }
    );
    expect(readTogether).toEqual([["/about", "/team"]]);
  });

  it("resolves each page in the default language the live language list names, not the configuration's", async () => {
    // Languages managed in Settings: the configuration declares none.
    answers.set("1", {
      robots: listed,
      canonical: { value: `${SITE}/fr/about`, from: "page" },
    });
    const { pages } = await listPages(
      context(
        [{ id: "1", slug: "about" }],
        [holds("1", "/about", "fr")],
        undefined,
        "fr"
      ),
      { origin: SITE }
    );
    expect(resolvedIn.get("1")).toBe("fr");
    expect(pages.map(page => page.loc)).toEqual([`${SITE}/fr/about`]);
  });
});

/** A version's answer: listed, at `canonical`, which is its own address. */
const at = (canonical: string): SeoAnswer => ({
  robots: listed,
  canonical: { value: canonical, from: "address" },
});

describe("each page's language versions", () => {
  beforeEach(() => {
    answers.clear();
    documentReads.length = 0;
    for (const language of Object.keys(domains)) delete domains[language];
  });

  it("lists every version a page is published in, each naming every version, itself included, and x-default at the default language's", async () => {
    answers.set("1@en", at("/en/about"));
    answers.set("1@de", at("/de/about"));
    const { pages, problems } = await listPages(
      context(
        [{ id: "1", slug: "about" }],
        [holds("1", "/about", "en"), holds("1", "/about", "de")],
        ["en", "de"]
      ),
      { origin: SITE }
    );
    const links = [
      { hreflang: "en", href: `${SITE}/en/about` },
      { hreflang: "de", href: `${SITE}/de/about` },
      { hreflang: "x-default", href: `${SITE}/en/about` },
    ];
    expect(
      pages.map(page => ({
        language: page.language,
        loc: page.loc,
        alternates: page.alternates,
      }))
    ).toEqual([
      { language: "en", loc: `${SITE}/en/about`, alternates: links },
      { language: "de", loc: `${SITE}/de/about`, alternates: links },
    ]);
    expect(problems).toEqual([]);
  });

  it("links only the languages a page is published in, reading each language's documents once for those published in it", async () => {
    answers.set("1@en", at("/en/about"));
    answers.set("1@de", at("/de/about"));
    // The second page has no published German version: the record holds it
    // in English alone.
    answers.set("2@en", at("/en/team"));
    answers.set("2@de", at("/de/team"));
    const { pages } = await listPages(
      context(
        [
          { id: "1", slug: "about" },
          { id: "2", slug: "team" },
        ],
        [
          holds("1", "/about", "en"),
          holds("1", "/about", "de"),
          holds("2", "/team", "en"),
        ],
        ["en", "de"]
      ),
      { origin: SITE }
    );
    expect(
      pages.map(page => [
        page.loc,
        (page.alternates ?? []).map(link => link.hreflang),
      ])
    ).toEqual([
      [`${SITE}/en/about`, ["en", "de", "x-default"]],
      [`${SITE}/de/about`, ["en", "de", "x-default"]],
      [`${SITE}/en/team`, []],
    ]);
    const german = documentReads.filter(read => read.locale === "de");
    expect(german).toHaveLength(1);
    expect(JSON.stringify(german[0]?.where)).toContain('"in":["1"]');
  });

  it("leaves a version that does not stand for itself out of every version's links", async () => {
    answers.set("1@en", at("/en/about"));
    answers.set("1@de", {
      robots: { value: { index: false, follow: true }, from: "page" },
      canonical: { value: "/de/about", from: "address" },
    });
    const { pages } = await listPages(
      context(
        [{ id: "1", slug: "about" }],
        [holds("1", "/about", "en"), holds("1", "/about", "de")],
        ["en", "de"]
      ),
      { origin: SITE }
    );
    expect(pages.map(page => [page.loc, page.alternates])).toEqual([
      [`${SITE}/en/about`, undefined],
    ]);
  });

  it("names a version on a language's own domain among the links, and leaves it to that domain's sitemap", async () => {
    domains.de = "https://acme.de";
    answers.set("1@en", at("/en/about"));
    answers.set("1@de", at("https://acme.de/about"));
    const { pages } = await listPages(
      context(
        [{ id: "1", slug: "about" }],
        [holds("1", "/about", "en"), holds("1", "/about", "de")],
        ["en", "de"]
      ),
      { origin: SITE }
    );
    expect(pages.map(page => [page.loc, page.alternates])).toEqual([
      [
        `${SITE}/en/about`,
        [
          { hreflang: "en", href: `${SITE}/en/about` },
          { hreflang: "de", href: "https://acme.de/about" },
          { hreflang: "x-default", href: `${SITE}/en/about` },
        ],
      ],
    ]);
  });

  it("lists a version in a language whose code search engines refuse, linking none to it", async () => {
    answers.set("1@en", at("/en/about"));
    answers.set("1@es-419", at("/es-419/about"));
    const { pages } = await listPages(
      context(
        [{ id: "1", slug: "about" }],
        [holds("1", "/about", "en"), holds("1", "/about", "es-419")],
        ["en", "es-419"]
      ),
      { origin: SITE }
    );
    expect(pages.map(page => [page.loc, page.alternates])).toEqual([
      [`${SITE}/en/about`, undefined],
      [`${SITE}/es-419/about`, undefined],
    ]);
  });
});
