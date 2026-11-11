/**
 * A page's structured data, from its answer and its own fields.
 *
 * What each case pins:
 * - a page is described as one linked graph: organisation, website, page,
 *   breadcrumb trail and its subject, each naming the others by `@id`;
 * - every fact in it is one the page, its answer or the brand facts hold;
 * - each type offered is generated from the fields its content type maps;
 * - a type missing a detail it needs is left out, with a problem naming it,
 *   saying whether the page or the mapping is where it is fixed;
 * - a page's own choice beats its content type's, which beats the automatic
 *   one, and a page hidden from search is offered only kinds of page;
 * - with no site address, nothing is generated, and that is the problem.
 */
import {
  type PageMetadataAnswer,
  type PageMetadataInput,
  type PluginContext,
  type PublicAddressType,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  STRUCTURED_DATA_TYPE_KEYS,
  structuredDataTypesFor,
  type StructuredDataTypeKey,
} from "../catalog";
import { buildStructuredData, type StructuredDataNode } from "../graph";
import type { DetailMapping, StructuredDataRules } from "../rules";

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  publicAddressOf: async (
    type: PublicAddressType,
    entry?: Readonly<Record<string, unknown>>
  ) =>
    type.kind === "collection" && type.slug === "authors"
      ? { status: "resolved", path: `/authors/${String(entry?.slug)}` }
      : { status: "none" },
  // Every language but English is served under its own prefix.
  languageAddressOf: async (path: string, locale: string) => ({
    status: "resolved",
    path: locale === "en" ? path : `/${locale}${path}`,
  }),
}));

/** An author as a route reads it populated, at `depth: 1`. */
const SARA = { id: "a1", name: "Sara Khan", slug: "sara-khan" };

/** A context reading the posts' declared fields, and the `about` Single's. */
function context(): PluginContext {
  return {
    services: {
      collections: {
        getCollection: async (slug: string) => ({
          name: slug,
          schemaDefinition: {
            fields: [
              { name: "title", type: "text" },
              { name: "author", type: "relationship", relationTo: "authors" },
              { name: "writer", type: "text" },
            ],
          },
        }),
      },
      singles: {
        list: async () => ({
          total: 1,
          data: [
            {
              slug: "about",
              fields: [
                {
                  name: "details",
                  type: "group",
                  fields: [
                    {
                      name: "author",
                      type: "relationship",
                      relationTo: "authors",
                    },
                  ],
                },
              ],
            },
          ],
        }),
      },
    },
  } as unknown as PluginContext;
}

const ORIGIN = "https://example.com";

const ANSWER: PageMetadataAnswer = {
  title: "Surfer SEO vs Rext AI",
  description: "Which one writes with sources.",
  canonical: "/blog/surfer-seo-vs-rext-ai",
  robots: { index: true, follow: true },
  social: {
    image: { url: "/media/cover.jpg", width: 1200, height: 630, alt: "Cover" },
    siteName: "Rext AI",
  },
};

function rules(
  types: StructuredDataRules["types"] = {},
  origin: string | null = ORIGIN
): StructuredDataRules {
  return {
    ...(origin === null ? {} : { origin }),
    brand: {
      name: "Rext AI Ltd",
      logo: { url: "/media/logo.png", width: 512, height: 512 },
      profiles: [{ url: "https://x.com/rext" }, { url: "not an address" }],
    },
    types,
  };
}

function postInput(
  entry: Record<string, unknown>,
  locale = "en"
): PageMetadataInput {
  return {
    path: "/blog/surfer-seo-vs-rext-ai",
    locale,
    source: { kind: "entry", collection: "posts", entry },
    code: {},
    derived: {},
  };
}

const POST = {
  id: "p1",
  title: "Surfer SEO vs Rext AI",
  writer: "Sara Khan",
  publishedAt: "2026-11-10",
  updatedAt: "2026-11-11T09:00:00.000Z",
};

const PAGE_URL = `${ORIGIN}/blog/surfer-seo-vs-rext-ai`;

/** The node of `type` in a graph. */
function nodeOf(
  nodes: readonly StructuredDataNode[],
  type: string
): StructuredDataNode | undefined {
  return nodes.find(each => each["@type"] === type);
}

/** Every `{ "@id": ... }` reference anywhere in a value. */
function references(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const own =
    Object.keys(record).length === 1 && typeof record["@id"] === "string"
      ? [record["@id"]]
      : [];
  return [...own, ...Object.values(record).flatMap(references)];
}

/** Every text leaf of a value, with the key it sits under. */
function leaves(value: unknown, key = ""): Array<[string, string]> {
  if (typeof value === "string") return [[key, value]];
  if (Array.isArray(value)) return value.flatMap(each => leaves(each, key));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([inner, each]) => leaves(each, inner));
}

describe("a page's structured data", () => {
  it("is one linked graph of the site, the page, its trail and its subject", async () => {
    const { nodes, type, chosen, problems } = await buildStructuredData(
      context(),
      postInput(POST),
      ANSWER,
      rules()
    );

    expect(type).toBe("article");
    expect(chosen).toBe("automatic");
    expect(problems).toEqual([]);
    expect(nodes.map(each => each["@type"])).toEqual([
      "Organization",
      "WebSite",
      "WebPage",
      "BreadcrumbList",
      "Article",
    ]);
    expect(nodeOf(nodes, "Organization")).toEqual({
      "@type": "Organization",
      "@id": `${ORIGIN}/#organization`,
      name: "Rext AI Ltd",
      url: `${ORIGIN}/`,
      logo: {
        "@type": "ImageObject",
        url: `${ORIGIN}/media/logo.png`,
        width: 512,
        height: 512,
      },
      // A profile that is not an address is left out.
      sameAs: ["https://x.com/rext"],
    });
    expect(nodeOf(nodes, "WebPage")).toMatchObject({
      "@id": PAGE_URL,
      url: PAGE_URL,
      name: ANSWER.title,
      description: ANSWER.description,
      isPartOf: { "@id": `${ORIGIN}/#website` },
      breadcrumb: { "@id": `${PAGE_URL}#breadcrumb` },
      inLanguage: "en",
    });
    expect(nodeOf(nodes, "BreadcrumbList")?.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Rext AI", item: `${ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: ANSWER.title },
    ]);
    expect(nodeOf(nodes, "Article")).toEqual({
      "@type": "Article",
      "@id": `${PAGE_URL}#article`,
      mainEntityOfPage: { "@id": PAGE_URL },
      headline: ANSWER.title,
      description: ANSWER.description,
      image: {
        "@type": "ImageObject",
        url: `${ORIGIN}/media/cover.jpg`,
        width: 1200,
        height: 630,
        caption: "Cover",
      },
      datePublished: "2026-11-10",
      dateModified: "2026-11-11T09:00:00.000Z",
      author: { "@type": "Person", name: "Sara Khan" },
      publisher: { "@id": `${ORIGIN}/#organization` },
      inLanguage: "en",
    });
    // Every node another names is in the graph.
    const ids = new Set(nodes.map(each => each["@id"]));
    expect(references(nodes).filter(id => !ids.has(id))).toEqual([]);
  });

  it("states only facts the page, its answer and the brand facts hold", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      postInput(POST),
      ANSWER,
      rules()
    );
    const input = postInput(POST);
    const held = new Set(
      [
        ...leaves(POST),
        ...leaves(ANSWER),
        ...leaves(rules().brand),
        // The language the page was read in.
        ...leaves(input.locale),
      ].map(([, value]) => value)
    );
    const unheld = leaves(nodes).filter(([key, value]) => {
      // What a node is, and how nodes name each other, are not facts.
      if (key === "@type" || key === "@id") return false;
      // An address is the page's or the brand's own, made absolute.
      if (key === "url" || key === "item") {
        const { pathname } = new URL(value);
        return pathname !== "/" && !held.has(pathname);
      }
      return !held.has(value);
    });
    expect(unheld).toEqual([]);
  });

  it("names a related author the route read, at the author's own page in the page's language", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      postInput({ ...POST, writer: undefined, author: SARA }, "de"),
      ANSWER,
      rules()
    );

    expect(nodeOf(nodes, "Article")?.author).toEqual({
      "@type": "Person",
      name: "Sara Khan",
      url: `${ORIGIN}/de/authors/sara-khan`,
    });
  });

  it("names nobody for a relationship read without its entry, and says the route is the fix", async () => {
    const { nodes, problems } = await buildStructuredData(
      context(),
      postInput({ ...POST, writer: undefined, author: "a1" }),
      ANSWER,
      rules({ posts: { type: "article" } })
    );

    // The id is not a name, and nothing is read beyond what the route read.
    expect(nodeOf(nodes, "Article")).toBeUndefined();
    expect(JSON.stringify(nodes)).not.toContain('"a1"');
    expect(problems).toEqual([
      {
        type: "article",
        detail: "author",
        message: "Missing: author.",
        fix: "route",
        field: "author",
      },
    ]);
  });

  it("reads a Single's relationship in a group by its dotted path", async () => {
    const about = (details: Record<string, unknown>): PageMetadataInput => ({
      locale: "en",
      source: {
        kind: "single",
        slug: "about",
        document: { details, publishedAt: "2026-11-10" },
      },
      code: {},
      derived: {},
    });
    const single = rules({
      "single:about": {
        type: "article",
        details: { article: { author: "details.author" } },
      },
    });

    const unread = await buildStructuredData(
      context(),
      about({ author: "a1" }),
      ANSWER,
      single
    );
    const read = await buildStructuredData(
      context(),
      about({ author: SARA }),
      ANSWER,
      single
    );

    expect(nodeOf(unread.nodes, "Article")).toBeUndefined();
    expect(unread.problems.map(problem => problem.fix)).toEqual(["route"]);
    expect(nodeOf(read.nodes, "Article")?.author).toEqual({
      "@type": "Person",
      name: "Sara Khan",
      url: `${ORIGIN}/authors/sara-khan`,
    });
  });

  it("leaves an Article out when its author is missing, naming the field to fill in", async () => {
    const { nodes, problems } = await buildStructuredData(
      context(),
      postInput({ ...POST, writer: "" }),
      ANSWER,
      rules({ posts: { type: "article" } })
    );

    expect(nodeOf(nodes, "Article")).toBeUndefined();
    // The page itself is still described.
    expect(nodeOf(nodes, "WebPage")).toBeDefined();
    expect(problems).toEqual([
      {
        type: "article",
        detail: "author",
        message: "Missing: author.",
        fix: "content",
        field: "writer",
      },
    ]);
  });

  it("says a missing detail is fixed in the mapping when no field holds it", async () => {
    const { problems } = await buildStructuredData(
      context(),
      postInput({ id: "p1", title: "Shoes" }),
      ANSWER,
      rules({ posts: { type: "product" } })
    );

    expect(problems).toEqual([
      {
        type: "product",
        detail: "price",
        message: "Missing: price.",
        fix: "mapping",
      },
      {
        type: "product",
        detail: "availability",
        message: "Missing: availability.",
        fix: "mapping",
      },
    ]);
  });

  it("addresses the page by its canonical as the answer gives it, never where it was served", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      postInput(POST),
      { ...ANSWER, canonical: "https://elsewhere.example/original" },
      rules()
    );

    expect(nodeOf(nodes, "WebPage")?.["@id"]).toBe(
      "https://elsewhere.example/original"
    );
    expect(nodeOf(nodes, "Article")?.mainEntityOfPage).toEqual({
      "@id": "https://elsewhere.example/original",
    });
  });

  it("describes only the site for a page with no canonical, guessing no address", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      postInput(POST),
      { ...ANSWER, canonical: undefined },
      rules()
    );

    expect(nodes.map(each => each["@type"])).toEqual([
      "Organization",
      "WebSite",
    ]);
  });

  it("names no site, and draws no trail, for a site with no name", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      postInput(POST),
      { ...ANSWER, social: { image: { url: "/media/cover.jpg" } } },
      { origin: ORIGIN, brand: {}, types: {} }
    );

    expect(nodes.map(each => each["@type"])).toEqual(["WebPage", "Article"]);
    expect(nodeOf(nodes, "WebPage")).not.toHaveProperty("breadcrumb");
  });

  it("generates nothing without the site's address, and says so", async () => {
    const result = await buildStructuredData(
      context(),
      postInput(POST),
      ANSWER,
      rules({}, null)
    );

    expect(result.nodes).toEqual([]);
    expect(result.problems).toEqual([
      {
        type: "article",
        detail: "siteAddress",
        message: "Missing: the site's address.",
        fix: "settings",
      },
    ]);
  });
});

/** One type, a mapping its content type gives, and the page's fields. */
interface TypeCase {
  type: StructuredDataTypeKey;
  mapping: DetailMapping;
  fields: Record<string, unknown>;
  expected: StructuredDataNode;
}

const TYPE_CASES: TypeCase[] = [
  {
    type: "product",
    mapping: {
      price: "cost",
      availability: "inStock",
      currency: { value: "usd" },
    },
    fields: { cost: "49.5", inStock: true },
    expected: {
      "@type": "Product",
      name: "Surfer SEO vs Rext AI",
      offers: {
        "@type": "Offer",
        price: 49.5,
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: PAGE_URL,
      },
    },
  },
  {
    type: "softwareApplication",
    mapping: { operatingSystem: "platform", price: "price" },
    fields: { platform: "Web", price: 0, rating: 4.6, ratingCount: "120" },
    expected: {
      "@type": "SoftwareApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: 0, url: PAGE_URL },
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: 4.6,
        ratingCount: 120,
      },
    },
  },
  {
    type: "videoObject",
    mapping: { videoFile: "clip" },
    fields: { clip: { url: "/media/demo.mp4" }, uploadDate: "2026-10-01" },
    expected: {
      "@type": "VideoObject",
      thumbnailUrl: `${ORIGIN}/media/cover.jpg`,
      uploadDate: "2026-10-01",
      contentUrl: `${ORIGIN}/media/demo.mp4`,
    },
  },
  {
    type: "event",
    mapping: { location: "venue" },
    fields: {
      startDate: "2026-12-01T18:00:00Z",
      venue: {
        name: "Hall A",
        address: { street: "1 Main St", city: "Lahore" },
      },
    },
    expected: {
      "@type": "Event",
      startDate: "2026-12-01T18:00:00Z",
      location: {
        "@type": "Place",
        name: "Hall A",
        address: {
          "@type": "PostalAddress",
          streetAddress: "1 Main St",
          addressLocality: "Lahore",
        },
      },
    },
  },
  {
    type: "localBusiness",
    mapping: {},
    fields: { address: "1 Main St", openingHours: ["Mo-Fr 09:00-17:00"] },
    expected: {
      "@type": "LocalBusiness",
      url: PAGE_URL,
      address: { "@type": "PostalAddress", streetAddress: "1 Main St" },
      openingHours: ["Mo-Fr 09:00-17:00"],
    },
  },
  {
    type: "review",
    mapping: { itemType: { value: "software application" } },
    fields: { writer: "Sara Khan", item: "Surfer SEO", rating: "4" },
    expected: {
      "@type": "Review",
      author: { "@type": "Person", name: "Sara Khan" },
      itemReviewed: { "@type": "SoftwareApplication", name: "Surfer SEO" },
      reviewRating: { "@type": "Rating", ratingValue: 4 },
    },
  },
];

describe("each type a content type can be mapped to", () => {
  it.each(TYPE_CASES)(
    "generates $type from the mapped fields, linked to the page",
    async ({ type, mapping, fields, expected }) => {
      const { nodes, problems } = await buildStructuredData(
        context(),
        postInput({ id: "p1", ...fields }),
        ANSWER,
        rules({ posts: { type, details: { [type]: mapping } } })
      );

      expect(problems).toEqual([]);
      expect(nodeOf(nodes, expected["@type"] as string)).toMatchObject({
        ...expected,
        "@id": `${PAGE_URL}#${type}`,
        mainEntityOfPage: { "@id": PAGE_URL },
      });
    }
  );

  it.each(TYPE_CASES)(
    "leaves $type out, with a problem per detail, on a page with none of them",
    async ({ type }) => {
      const { nodes, problems } = await buildStructuredData(
        context(),
        postInput({ id: "p1" }),
        { ...ANSWER, social: { siteName: "Rext AI" } },
        rules({ posts: { type } })
      );

      expect(nodes.map(each => each["@type"])).toEqual([
        "Organization",
        "WebSite",
        "WebPage",
        "BreadcrumbList",
      ]);
      expect(problems.length).toBeGreaterThan(0);
      for (const problem of problems) {
        expect(problem.type).toBe(type);
        expect(problem.message).toMatch(/^Missing: [a-z ]+\.$/);
      }
    }
  );

  it("describes a profile page as the person it is about", async () => {
    const { nodes, problems } = await buildStructuredData(
      context(),
      postInput({ id: "a1", name: "Sara Khan" }),
      ANSWER,
      rules({ posts: { type: "profilePage" } })
    );

    expect(problems).toEqual([]);
    expect(nodeOf(nodes, "ProfilePage")?.mainEntity).toEqual({
      "@type": "Person",
      name: "Sara Khan",
    });
  });

  it("describes a profile page missing its person as a web page", async () => {
    const { nodes, problems } = await buildStructuredData(
      context(),
      postInput({ id: "a1" }),
      ANSWER,
      rules({ posts: { type: "profilePage" } })
    );

    expect(nodeOf(nodes, "ProfilePage")).toBeUndefined();
    expect(nodeOf(nodes, "WebPage")).toBeDefined();
    expect(problems.map(problem => problem.detail)).toEqual(["person"]);
  });

  it("names the title as missing for a thing a page with no title describes", async () => {
    const { problems } = await buildStructuredData(
      context(),
      postInput({ id: "p1", price: 5, availability: "in stock" }),
      { ...ANSWER, title: undefined },
      rules({ posts: { type: "product" } })
    );

    expect(problems.map(problem => problem.detail)).toEqual(["title"]);
  });
});

describe("the type a page is described as", () => {
  it("is the page's own choice, over its content type's", async () => {
    const result = await buildStructuredData(
      context(),
      postInput({ ...POST, seo: { structuredDataType: "blogPosting" } }),
      ANSWER,
      rules({ posts: { type: "article" } })
    );

    expect(result.type).toBe("blogPosting");
    expect(result.chosen).toBe("page");
    expect(nodeOf(result.nodes, "BlogPosting")).toBeDefined();
    expect(nodeOf(result.nodes, "Article")).toBeUndefined();
  });

  it("is the content type's choice where the page chose none or no type", async () => {
    for (const own of [undefined, "", "faqPage"]) {
      const result = await buildStructuredData(
        context(),
        postInput({ ...POST, seo: { structuredDataType: own } }),
        ANSWER,
        rules({ posts: { type: "webPage" } })
      );
      expect([result.type, result.chosen]).toEqual(["webPage", "type"]);
    }
  });

  it("is a web page, automatically, for a page with no author or date", async () => {
    const result = await buildStructuredData(
      context(),
      postInput({ id: "p1", title: "About" }),
      ANSWER,
      rules()
    );

    expect([result.type, result.chosen]).toEqual(["webPage", "automatic"]);
    expect(result.problems).toEqual([]);
  });

  it("offers a page hidden from search only kinds of page, and keeps no other choice", async () => {
    const result = await buildStructuredData(
      context(),
      postInput({ ...POST, seo: { structuredDataType: "product" } }),
      { ...ANSWER, robots: { index: false, follow: true } },
      rules({ posts: { type: "article" } })
    );

    expect(result.offered).toEqual(["collectionPage", "webPage"]);
    expect([result.type, result.chosen]).toEqual(["webPage", "automatic"]);
  });

  it("offers every type on a listed page, and only the types Google still shows", () => {
    expect(structuredDataTypesFor({ hidden: false })).toEqual(
      STRUCTURED_DATA_TYPE_KEYS
    );
    expect(STRUCTURED_DATA_TYPE_KEYS).toEqual([
      "article",
      "blogPosting",
      "webPage",
      "collectionPage",
      "profilePage",
      "softwareApplication",
      "product",
      "event",
      "videoObject",
      "review",
      "localBusiness",
    ]);
  });
});
