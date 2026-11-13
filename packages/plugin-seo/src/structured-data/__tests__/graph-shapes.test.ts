/**
 * Whole graphs of the pages a site has most: a blog post, an About and a
 * Contact page, a list of posts and the home page, each checked against what
 * Google asks of every type in it and against what sites wrote by hand
 * before the plugin wrote it for them, then kept as a snapshot.
 *
 * What each case pins:
 * - every node has the properties Google requires of its type, and the
 *   ones it recommends wherever the page holds them;
 * - an app with no ratings is described without a rich result, and with no
 *   rating made up to earn one;
 * - each node states at least what a hand-written graph of the same page
 *   stated, so moving a site's markup to the plugin loses nothing;
 * - every `@id` a node names is a node of the same graph.
 */
import {
  type PageMetadataAnswer,
  type PageMetadataInput,
  type PageStructuredDataHints,
  type PluginContext,
  type PublicAddressType,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { keepRecord } from "../../address-record/__tests__/record-double";
import { buildStructuredData, type StructuredDataNode } from "../graph";
import type { StructuredDataRules } from "../rules";

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  publicAddressOf: async (
    type: PublicAddressType,
    entry?: Readonly<Record<string, unknown>>
  ) =>
    type.kind === "collection" && type.slug === "authors"
      ? { status: "resolved", path: `/blog/author/${String(entry?.slug)}` }
      : { status: "none" },
  languageAddressOf: async (path: string) => ({ status: "resolved", path }),
  addressOfRequest: async (url: URL) => ({ locale: "en", path: url.pathname }),
}));

vi.mock("../../address-record/store", async importOriginal => ({
  ...(await importOriginal()),
  ...(await import("../../address-record/__tests__/record-double"))
    .recordDouble,
}));

const ORIGIN = "https://nextlyhq.com";

/** A site whose blog index is a Single holding `/blog`. */
function context(): PluginContext {
  const ctx = {
    self: { collections: {} },
    config: {},
    publicAddresses: { defaultLanguage: async () => "en" },
    services: {
      ownCollections: { listEntries: async () => ({ data: [] }) },
      collections: {
        getCollection: async (slug: string) => ({
          name: slug,
          schemaDefinition: {
            fields: [
              { name: "author", type: "relationship", relationTo: "authors" },
            ],
          },
        }),
      },
      singles: { list: async () => ({ total: 0, data: [] }) },
    },
  } as unknown as PluginContext;
  keepRecord(ctx, [
    {
      locale: "en",
      path: "/blog",
      holderCollection: "single:blog",
      holderId: "1",
      holderLabel: "Blog",
    },
  ]);
  return ctx;
}

/** The brand facts and choices a site like nextlyhq.com would set. */
const RULES: StructuredDataRules = {
  origin: ORIGIN,
  brand: {
    name: "Nextly",
    otherNames: ["Nextly CMS"],
    logo: { url: "/nextly-logo-light.svg" },
    profiles: [
      { url: "https://github.com/nextlyhq/nextly" },
      { url: "https://x.com/nextlyhq" },
    ],
    description: "An open-source CMS and Visual Page Builder for Next.js.",
    founders: [
      {
        name: "Sara Khan",
        jobTitle: "Founder",
        url: "/about",
        sameAs: ["https://github.com/sara-khan"],
      },
    ],
  },
  types: {
    posts: { type: "blogPosting" },
    "single:home": {
      type: "softwareApplication",
      details: {
        softwareApplication: {
          applicationCategory: { value: "DeveloperApplication" },
          operatingSystem: { value: "Cross-platform" },
          price: { value: "0" },
          currency: { value: "USD" },
        },
      },
    },
    "single:about": { type: "aboutPage" },
    "single:contact": { type: "contactPage" },
  },
};

/** One page as a site's route would ask about it. */
interface PageCase {
  name: string;
  input: PageMetadataInput;
  answer: PageMetadataAnswer;
  /**
   * Per schema.org type, the properties the site's own hand-written graph
   * of the same page stated, read from what it served on 2026-11-12: the
   * plugin's graph states each of them too.
   */
  handWritten: Record<string, readonly string[]>;
}

const answer = (
  canonical: string,
  title: string,
  description: string
): PageMetadataAnswer => ({
  title,
  description,
  canonical,
  robots: { index: true, follow: true },
  social: {
    siteName: "Nextly",
    image: { url: "/opengraph-image", width: 1200, height: 630 },
  },
});

const single = (
  slug: string,
  document: Record<string, unknown>,
  hints?: PageStructuredDataHints
): PageMetadataInput => ({
  source: { kind: "single", slug, document },
  code: {},
  derived: {},
  ...(hints === undefined ? {} : { structuredDataHints: hints }),
});

const QUESTIONS = [
  {
    question: "What is Nextly?",
    answer: "An open-source content platform for Next.js.",
  },
  { question: "Is Nextly free?", answer: "Nextly is MIT licensed." },
];

const PAGES: PageCase[] = [
  {
    name: "a blog post",
    input: {
      source: {
        kind: "entry",
        collection: "posts",
        entry: {
          id: "p1",
          title: "What is Nextly?",
          excerpt: "Nextly is an open-source content platform for Next.js.",
          author: {
            id: "a1",
            name: "Nextly Team",
            slug: "nextly-team",
            jobTitle: "Core Team",
          },
          publishedAt: "2026-03-27T12:00:00.000Z",
          correctedAt: "2026-10-23T12:00:00.000Z",
          tags: [{ name: "Open Source" }, { name: "Next.js" }],
          category: { title: "Announcements" },
          content: {
            root: { children: [{ text: "Nextly runs in your app." }] },
          },
        },
      },
      code: {},
      derived: {},
    },
    answer: answer(
      "/blog/introducing-nextly",
      "What is Nextly? | Nextly Blog",
      "Nextly is an open-source content platform for Next.js."
    ),
    handWritten: {
      Organization: ["@id", "name", "url", "logo", "description", "sameAs"],
      WebSite: ["@id", "url", "name", "description", "publisher", "inLanguage"],
      BlogPosting: [
        "@id",
        "mainEntityOfPage",
        "headline",
        "description",
        "image",
        "datePublished",
        "dateModified",
        "author",
        "publisher",
        "keywords",
        "articleSection",
        "wordCount",
        "inLanguage",
      ],
      WebPage: [
        "@id",
        "url",
        "name",
        "description",
        "isPartOf",
        "inLanguage",
        "breadcrumb",
        "mainEntity",
      ],
      BreadcrumbList: ["@id", "itemListElement"],
    },
  },
  {
    name: "the About page",
    input: single("about", { id: "s1", title: "The story behind Nextly" }),
    answer: answer(
      "/about",
      "About | Nextly",
      "An open-source CMS built by a developer who wanted control."
    ),
    handWritten: {
      AboutPage: [
        "@id",
        "url",
        "name",
        "description",
        "isPartOf",
        "inLanguage",
        "breadcrumb",
        "mainEntity",
        "about",
      ],
      Person: ["@id", "name", "jobTitle", "url", "worksFor", "sameAs"],
      BreadcrumbList: ["@id", "itemListElement"],
    },
  },
  {
    name: "the Contact page",
    input: single("contact", { id: "s2", title: "Get in Touch." }),
    answer: answer(
      "/contact",
      "Contact | Nextly",
      "Questions, bug reports or feature requests? We're here."
    ),
    handWritten: {
      ContactPage: [
        "@id",
        "url",
        "name",
        "description",
        "isPartOf",
        "inLanguage",
        "breadcrumb",
        "about",
      ],
      BreadcrumbList: ["@id", "itemListElement"],
    },
  },
  {
    name: "a list of posts",
    input: single(
      "blog",
      { id: "s3", title: "Blog" },
      {
        items: [
          { name: "What is Nextly?", url: "/blog/introducing-nextly" },
          { name: "Why Next.js", url: "/blog/why-nextjs" },
        ],
      }
    ),
    answer: answer(
      "/blog",
      "Blog | Nextly",
      "Writing from the people who build Nextly."
    ),
    handWritten: {
      CollectionPage: [
        "@id",
        "url",
        "name",
        "description",
        "isPartOf",
        "inLanguage",
        "breadcrumb",
        "mainEntity",
      ],
      ItemList: ["@id", "numberOfItems", "itemListElement"],
      BreadcrumbList: ["@id", "itemListElement"],
    },
  },
  {
    name: "the home page",
    input: single(
      "home",
      { id: "s4", updatedAt: "2026-11-11" },
      { questions: QUESTIONS }
    ),
    answer: answer(
      "/",
      "Nextly | Open-source CMS and Visual Page Builder for Next.js",
      "Nextly is an open-source CMS and Visual Page Builder for Next.js."
    ),
    handWritten: {
      WebPage: [
        "@id",
        "url",
        "name",
        "description",
        "isPartOf",
        "inLanguage",
        "mainEntity",
        "dateModified",
      ],
      SoftwareApplication: [
        "@id",
        "name",
        "description",
        "url",
        "applicationCategory",
        "operatingSystem",
        "offers",
      ],
      // The hand-written graph also described the page's questions as an
      // FAQPage beside the app. The plugin describes questions only on a
      // page whose kind someone chose as Questions and answers, so a home
      // page described as an app gets none, though its route lists them.
    },
  },
];

/** What Google asks of a type: always, and wherever the page has it. */
interface GoogleRule {
  required: readonly string[];
  recommended: readonly string[];
  /** Further checks of the node's parts, as messages for what is wrong. */
  check?: (node: StructuredDataNode) => string[];
}

const has = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== "";

/** A list's items each holding `keys`, the last exempt from `exceptLast`. */
function eachItem(
  items: unknown,
  keys: readonly string[],
  exceptLast: readonly string[] = []
): string[] {
  if (!Array.isArray(items) || items.length === 0) return ["no items"];
  return items.flatMap((item, at) =>
    keys
      .filter(key => !(at === items.length - 1 && exceptLast.includes(key)))
      .filter(key => !has((item as Record<string, unknown>)[key]))
      .map(key => `item ${at + 1} has no ${key}`)
  );
}

const ARTICLE: GoogleRule = {
  // developers.google.com/search/docs/appearance/structured-data/article:
  // no property is required; these are recommended.
  required: [],
  recommended: ["author", "datePublished", "dateModified", "headline", "image"],
  check: node => {
    const author = node.author as Record<string, unknown> | undefined;
    return author === undefined || has(author.name) || has(author["@id"])
      ? []
      : ["author has no name"];
  },
};

/**
 * Google's properties per type, from Search Central's structured data
 * pages as they stood on 2026-11-12. A type with no Google feature asks
 * what schema.org's own definition needs to be read at all.
 */
const GOOGLE: Record<string, GoogleRule> = {
  Article: ARTICLE,
  BlogPosting: ARTICLE,
  TechArticle: ARTICLE,
  // .../structured-data/organization: none required.
  Organization: {
    required: [],
    recommended: ["name", "url", "logo", "description", "sameAs"],
  },
  // .../structured-data/site-names: name required, alternateName and url.
  WebSite: { required: ["name", "url"], recommended: ["alternateName"] },
  WebPage: { required: ["url"], recommended: ["name", "isPartOf"] },
  AboutPage: { required: ["url"], recommended: ["name", "isPartOf"] },
  ContactPage: { required: ["url"], recommended: ["name", "isPartOf"] },
  CollectionPage: { required: ["url"], recommended: ["name", "isPartOf"] },
  // .../structured-data/breadcrumb: each item's position and name, and its
  // item, which the last may leave to the page it is on.
  BreadcrumbList: {
    required: ["itemListElement"],
    recommended: [],
    check: node =>
      eachItem(node.itemListElement, ["position", "name", "item"], ["item"]),
  },
  // .../structured-data/carousel: each item's position and url.
  ItemList: {
    required: ["itemListElement"],
    recommended: [],
    check: node => eachItem(node.itemListElement, ["position", "url"]),
  },
  // FAQPage: each question's name and accepted answer, as schema.org and
  // Google's FAQ guide had it; Google retired the rich result in May 2026,
  // and other engines read the same shape.
  FAQPage: {
    required: ["mainEntity"],
    recommended: [],
    check: node =>
      eachItem(node.mainEntity, ["name", "acceptedAnswer"]).concat(
        (node.mainEntity as Array<{ acceptedAnswer?: { text?: unknown } }>)
          .filter(each => !has(each.acceptedAnswer?.text))
          .map(() => "an answer has no text")
      ),
  },
  // .../structured-data/software-app: name, and for a rich result a price
  // and a rating, which a page without ratings goes without.
  SoftwareApplication: {
    required: ["name"],
    recommended: ["applicationCategory", "operatingSystem", "offers"],
  },
  SoftwareSourceCode: { required: ["codeRepository"], recommended: [] },
  Person: { required: ["name"], recommended: ["url"] },
};

/** What Google would refuse in a graph, and what it recommends it lacks. */
function googleFindings(nodes: readonly StructuredDataNode[]): {
  refused: string[];
  lacking: string[];
} {
  const refused: string[] = [];
  const lacking: string[] = [];
  for (const node of nodes) {
    const type = String(node["@type"]);
    const rule = GOOGLE[type];
    if (rule === undefined) {
      refused.push(`${type}: no rule for this type`);
      continue;
    }
    for (const key of rule.required) {
      if (!has(node[key])) refused.push(`${type}: no ${key}`);
    }
    for (const message of rule.check?.(node) ?? []) {
      refused.push(`${type}: ${message}`);
    }
    for (const key of rule.recommended) {
      if (!has(node[key])) lacking.push(`${type}.${key}`);
    }
  }
  return { refused, lacking };
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

describe("whole graphs of a site's pages", () => {
  it("checks what it is meant to: a node missing what Google requires is refused", () => {
    // The checker's own positive control: it reports what it is shown.
    expect(
      googleFindings([
        { "@type": "BreadcrumbList", itemListElement: [{ position: 1 }] },
        { "@type": "WebSite", url: "https://example.com/" },
      ]).refused
    ).toEqual(["BreadcrumbList: item 1 has no name", "WebSite: no name"]);
  });

  it.each(PAGES)(
    "describes $name with everything Google requires",
    async ({ input, answer: pageAnswer }) => {
      const { nodes, problems } = await buildStructuredData(
        context(),
        input,
        pageAnswer,
        RULES
      );

      expect(problems).toEqual([]);
      expect(googleFindings(nodes).refused).toEqual([]);
      const ids = new Set(nodes.map(each => each["@id"]));
      expect(references(nodes).filter(id => !ids.has(id))).toEqual([]);
    }
  );

  it.each(PAGES)(
    "states on $name at least what its hand-written graph stated",
    async ({ input, answer: pageAnswer, handWritten }) => {
      const { nodes } = await buildStructuredData(
        context(),
        input,
        pageAnswer,
        RULES
      );

      const short = Object.entries(handWritten).flatMap(([type, keys]) => {
        const ours = nodes.find(each => each["@type"] === type);
        if (ours === undefined) return [`${type}: not stated`];
        return keys.filter(key => !has(ours[key])).map(key => `${type}.${key}`);
      });
      expect(short).toEqual([]);
    }
  );

  it.each(PAGES)("keeps the shape of $name", async ({ input, answer: a }) => {
    const { nodes } = await buildStructuredData(context(), input, a, RULES);
    expect(nodes).toMatchSnapshot();
  });

  it("describes an app with no ratings without a rich result, and makes up none", async () => {
    const home = PAGES.find(each => each.name === "the home page");
    const { nodes } = await buildStructuredData(
      context(),
      home?.input as PageMetadataInput,
      home?.answer as PageMetadataAnswer,
      RULES
    );
    const app = nodes.find(each => each["@type"] === "SoftwareApplication");

    // Named by the brand, not by the home page's whole title.
    expect(app?.name).toBe("Nextly");
    expect(app).not.toHaveProperty("aggregateRating");
    expect(app).not.toHaveProperty("review");
    expect(app?.offers).toEqual({
      "@type": "Offer",
      price: 0,
      priceCurrency: "USD",
      url: `${ORIGIN}/`,
    });
  });
});
