/**
 * What a page's graph says about the page itself, beyond its type's
 * details: its own name, its trail, its dates, the site's brand facts, the
 * kinds of page a route or a content type names, what a route lists and
 * the questions it answers.
 *
 * What each case pins:
 * - the headline, the page's name and the trail's last step are the entry's
 *   own title, never the title its pattern made for search results;
 * - the trail follows the page's address, naming each step by the page
 *   that holds it, and skips a step no page holds;
 * - the organisation and the website carry every brand fact given, and
 *   every address of the site is spelled one way;
 * - an About, Contact, collection or questions page is described as one,
 *   with only what the page shows: no list, question or rating is made up.
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
import { sha256 } from "../../address-record/rows";
import { buildStructuredData, type StructuredDataNode } from "../graph";
import { rulesFromOptions, type StructuredDataRules } from "../rules";

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  publicAddressOf: async (
    type: PublicAddressType,
    entry?: Readonly<Record<string, unknown>>
  ) =>
    type.kind === "collection" && type.slug === "authors"
      ? { status: "resolved", path: `/authors/${String(entry?.slug)}` }
      : { status: "none" },
  // German is served under `/de`, English at the root.
  languageAddressOf: async (path: string, locale: string) => ({
    status: "resolved",
    path: locale === "en" ? path : `/${locale}${path === "/" ? "" : path}`,
  }),
  addressOfRequest: async (url: URL) => {
    if (url.origin !== ORIGIN) return undefined;
    const prefixed = /^\/(de)(\/.*)?$/.exec(url.pathname);
    return prefixed === null
      ? { locale: "en", path: url.pathname }
      : { locale: prefixed[1], path: prefixed[2] ?? "/" };
  },
}));

vi.mock("../../address-record/store", async importOriginal => ({
  ...(await importOriginal()),
  ...(await import("../../address-record/__tests__/record-double"))
    .recordDouble,
}));

const ORIGIN = "https://example.com";

/** The pages the address record says hold an address, by language and path. */
const HELD: Record<string, { collection: string; label?: string }> = {
  "en|/blog": { collection: "single:blog", label: "Blog" },
  "de|/blog": { collection: "single:blog", label: "Blog" },
  "en|/guides": { collection: "single:guides" },
};

/** The pages built in code, by address, as their rows name them. */
const CODE_PAGES: Record<string, string | undefined> = {
  "/docs": "Docs",
};

/**
 * A context whose address record and code pages hold the pages above, on a
 * site whose default language is English.
 */
function context(): PluginContext {
  const listEntries = async (
    slug: string,
    query: { where?: Record<string, Record<string, unknown>> }
  ) => {
    if (slug === "nx_seo_code_pages") {
      const key = query.where?.pathKey?.equals;
      const data = Object.entries(CODE_PAGES).flatMap(([path, name]) =>
        sha256(path) === key
          ? [{ id: path, path, ...(name === undefined ? {} : { name }) }]
          : []
      );
      return { data };
    }
    return { data: [] };
  };
  const ctx = {
    self: { collections: {} },
    config: {},
    publicAddresses: { defaultLanguage: async () => "en" },
    services: {
      ownCollections: { listEntries },
      collections: {
        getCollection: async (slug: string) => ({
          name: slug,
          schemaDefinition: {
            fields: [
              { name: "title", type: "text" },
              { name: "author", type: "relationship", relationTo: "authors" },
              { name: "tags", type: "relationship", relationTo: "tags" },
              {
                name: "category",
                type: "relationship",
                relationTo: "categories",
              },
            ],
          },
        }),
      },
      singles: { list: async () => ({ total: 0, data: [] }) },
    },
  } as unknown as PluginContext;
  keepRecord(
    ctx,
    Object.entries(HELD).map(([at, holder]) => {
      const [locale = "", path = ""] = at.split("|");
      return {
        locale,
        path,
        holderCollection: holder.collection,
        holderId: "1",
        ...(holder.label === undefined ? {} : { holderLabel: holder.label }),
      };
    })
  );
  return ctx;
}

const BRAND: StructuredDataRules["brand"] = {
  name: "Rext AI",
  otherNames: ["RextAI"],
  logo: { url: "/icon.png", width: 512, height: 512 },
  profiles: [{ url: "https://x.com/rextaihq" }],
  description: "An AI article writer for SEO.",
  email: "contact@rext.ai",
  contactPoints: [{ contactType: "customer support", email: "help@rext.ai" }],
  foundingDate: "2024",
  parentOrganization: {
    name: "Revnix LLC",
    url: "https://revnix.com",
    foundingDate: "2020",
  },
  founders: [
    {
      name: "Sara Khan",
      jobTitle: "Founder",
      url: "/about",
      sameAs: ["https://github.com/sara"],
    },
  ],
};

function rules(more: Partial<StructuredDataRules> = {}): StructuredDataRules {
  return { origin: ORIGIN, brand: BRAND, types: {}, ...more };
}

function answerAt(
  canonical: string,
  title: string,
  more: Partial<PageMetadataAnswer> = {}
): PageMetadataAnswer {
  return {
    title,
    description: "What the page says it is.",
    canonical,
    robots: { index: true, follow: true },
    social: { siteName: "Rext AI", image: { url: "/media/card.png" } },
    ...more,
  };
}

function entryInput(
  collection: string,
  entry: Record<string, unknown>,
  more: Partial<PageMetadataInput> = {}
): PageMetadataInput {
  return {
    source: { kind: "entry", collection, entry },
    code: {},
    derived: {},
    ...more,
  };
}

function singleInput(
  slug: string,
  document: Record<string, unknown>,
  hints?: PageStructuredDataHints
): PageMetadataInput {
  return {
    source: { kind: "single", slug, document },
    code: {},
    derived: {},
    ...(hints === undefined ? {} : { structuredDataHints: hints }),
  };
}

function nodeOf(
  nodes: readonly StructuredDataNode[],
  type: string
): StructuredDataNode | undefined {
  return nodes.find(each => each["@type"] === type);
}

function trailOf(nodes: readonly StructuredDataNode[]): unknown {
  return nodeOf(nodes, "BreadcrumbList")?.itemListElement;
}

const POST = {
  id: "p1",
  title: "Jasper vs Rext AI",
  author: {
    id: "a1",
    name: "Sajad Hussain",
    slug: "sajad-hussain",
    jobTitle: "Editor",
  },
  publishedAt: "2026-09-24T13:52:11.914Z",
  correctedAt: "2026-11-03T09:47:39.000Z",
  updatedAt: "2026-11-12T00:00:00.000Z",
  tags: [
    { id: "t1", name: "Comparison" },
    { id: "t2", name: "AI writing" },
  ],
  category: { id: "c1", title: "Alternatives" },
  content: {
    root: {
      children: [
        { type: "paragraph", children: [{ text: "Two tools, one job." }] },
        { type: "paragraph", children: [{ text: "Which writes better?" }] },
      ],
    },
  },
};

const POST_URL = `${ORIGIN}/blog/jasper-vs-rext-ai`;

describe("the page's own name", () => {
  it("is the entry's title for the headline, the page and the last step, never the search title", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", POST),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI | Rext AI Blog"),
      rules({ types: { posts: { type: "blogPosting" } } })
    );

    expect(nodeOf(nodes, "BlogPosting")?.headline).toBe("Jasper vs Rext AI");
    expect(nodeOf(nodes, "WebPage")?.name).toBe("Jasper vs Rext AI");
    expect(trailOf(nodes)).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: `${ORIGIN}/blog`,
      },
      { "@type": "ListItem", position: 3, name: "Jasper vs Rext AI" },
    ]);
  });

  it("is the name the route gives, over the entry's title", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", POST, {
        structuredDataHints: { name: "Jasper or Rext AI?" },
      }),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI | Rext AI"),
      rules()
    );

    expect(nodeOf(nodes, "WebPage")?.name).toBe("Jasper or Rext AI?");
  });

  it("is the title without the site's name the pattern put after it, where the page has no title of its own", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      singleInput("pricing", { id: "s1" }),
      answerAt("/pricing", "Pricing | Rext AI"),
      rules()
    );
    const brandInTitle = await buildStructuredData(
      context(),
      singleInput("story", { id: "s2" }),
      answerAt("/story", "Why we built Rext AI"),
      rules()
    );

    expect(nodeOf(nodes, "WebPage")?.name).toBe("Pricing");
    // A title that names the brand, with no separator before it, is kept.
    expect(nodeOf(brandInTitle.nodes, "WebPage")?.name).toBe(
      "Why we built Rext AI"
    );
  });

  it("is a page built in code's own name, or else its route's title over one made from its address", async () => {
    const codePage = (title: string) =>
      entryInput(
        "nx_seo_code_pages",
        { id: "c1", path: "/pricing", title, seo: {} },
        { code: { title: "Plans and prices | Rext AI" } }
      );
    const fromAddress = await buildStructuredData(
      context(),
      codePage("Pricing"),
      answerAt("/pricing", "Plans and prices | Rext AI"),
      rules()
    );
    const named = await buildStructuredData(
      context(),
      codePage("Our plans"),
      answerAt("/pricing", "Plans and prices | Rext AI"),
      rules()
    );

    expect(nodeOf(fromAddress.nodes, "WebPage")?.name).toBe("Plans and prices");
    expect(nodeOf(named.nodes, "WebPage")?.name).toBe("Our plans");
  });

  it("is the whole title on the home page, which is the site's own", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      singleInput("home", { id: "h1", title: "Home" }),
      answerAt("/", "Rext AI | AI article writer for SEO"),
      rules()
    );

    expect(nodeOf(nodes, "WebPage")?.name).toBe(
      "Rext AI | AI article writer for SEO"
    );
    // The home page is the trail's start, so it has none of its own.
    expect(nodeOf(nodes, "BreadcrumbList")).toBeUndefined();
  });
});

describe("a language's home page", () => {
  it("is named by its whole title, and its subject by the brand, as the site's home is", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      {
        ...singleInput("product", {
          id: "h1",
          title: "Startseite",
          operatingSystem: "Web",
        }),
        locale: "de",
      },
      answerAt("/de", "Rext AI | KI-Artikel für SEO"),
      rules({ types: { "single:product": { type: "softwareApplication" } } })
    );

    expect(nodeOf(nodes, "WebPage")?.name).toBe("Rext AI | KI-Artikel für SEO");
    expect(nodeOf(nodes, "SoftwareApplication")?.name).toBe("Rext AI");
    expect(nodeOf(nodes, "BreadcrumbList")).toBeUndefined();
  });
});

describe("the page's trail", () => {
  it("names each step by the page that holds it, and skips a step no page holds", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      singleInput("doc", { id: "d1", title: "Installation" }),
      answerAt("/docs/getting-started/installation", "Installation | Rext AI"),
      rules()
    );

    expect(trailOf(nodes)).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
      // A page built in code, by the name its route gave it.
      {
        "@type": "ListItem",
        position: 2,
        name: "Docs",
        item: `${ORIGIN}/docs`,
      },
      // `/docs/getting-started` is held by no page: no step leads there.
      { "@type": "ListItem", position: 3, name: "Installation" },
    ]);
  });

  it("names a step held by a page with no title by its address, and a step the site names by that", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      singleInput("guide", { id: "g1", title: "Keyword research" }),
      answerAt("/guides/keyword-research", "Keyword research"),
      rules({
        breadcrumbs: { home: "Rext AI", names: { "/blog": "Articles" } },
      })
    );
    const named = await buildStructuredData(
      context(),
      entryInput("posts", POST),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({ breadcrumbs: { names: { "/blog": "Articles" } } })
    );

    expect(trailOf(nodes)).toEqual([
      { "@type": "ListItem", position: 1, name: "Rext AI", item: `${ORIGIN}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Guides",
        item: `${ORIGIN}/guides`,
      },
      { "@type": "ListItem", position: 3, name: "Keyword research" },
    ]);
    expect(
      (trailOf(named.nodes) as Array<{ name: string }>).map(step => step.name)
    ).toEqual(["Home", "Articles", "Jasper vs Rext AI"]);
  });

  it("leads through the page's language, at its own prefix", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", POST, { locale: "de" }),
      answerAt("/de/blog/jasper-vs-rext-ai", "Jasper oder Rext AI"),
      rules()
    );

    expect(trailOf(nodes)).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/de` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: `${ORIGIN}/de/blog`,
      },
      { "@type": "ListItem", position: 3, name: "Jasper vs Rext AI" },
    ]);
  });

  it("spells each step as the page's own address is spelled, with its trailing slash", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", POST),
      answerAt("/blog/jasper-vs-rext-ai/", "Jasper vs Rext AI"),
      rules()
    );

    expect(
      (trailOf(nodes) as Array<{ item?: string }>).map(step => step.item)
    ).toEqual([`${ORIGIN}/`, `${ORIGIN}/blog/`, undefined]);
  });
});

describe("the site's own nodes", () => {
  it("state every brand fact given, at the one spelling of the site's address", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      singleInput("home", { id: "h1" }),
      answerAt("/", "Rext AI"),
      rules()
    );

    expect(nodeOf(nodes, "Organization")).toEqual({
      "@type": "Organization",
      "@id": `${ORIGIN}/#organization`,
      name: "Rext AI",
      alternateName: ["RextAI"],
      url: `${ORIGIN}/`,
      logo: {
        "@type": "ImageObject",
        url: `${ORIGIN}/icon.png`,
        width: 512,
        height: 512,
      },
      description: "An AI article writer for SEO.",
      email: "contact@rext.ai",
      contactPoint: [
        {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: "help@rext.ai",
        },
      ],
      foundingDate: "2024",
      parentOrganization: {
        "@type": "Organization",
        name: "Revnix LLC",
        url: "https://revnix.com",
        foundingDate: "2020",
      },
      sameAs: ["https://x.com/rextaihq"],
    });
    expect(nodeOf(nodes, "WebSite")).toEqual({
      "@type": "WebSite",
      "@id": `${ORIGIN}/#website`,
      url: `${ORIGIN}/`,
      name: "Rext AI",
      // Google reads a site's other names from here.
      alternateName: ["RextAI"],
      description: "An AI article writer for SEO.",
      publisher: { "@id": `${ORIGIN}/#organization` },
      // The site's language, though the route read the page in none.
      inLanguage: "en",
    });
    // The home page is addressed as the organisation and the website are.
    expect(nodeOf(nodes, "WebPage")?.url).toBe(`${ORIGIN}/`);
  });
});

describe("a page's dates", () => {
  it("are when it was published and last corrected, over the row's own save time", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", POST),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({ types: { posts: { type: "blogPosting" } } })
    );

    for (const node of [
      nodeOf(nodes, "WebPage"),
      nodeOf(nodes, "BlogPosting"),
    ]) {
      expect(node).toMatchObject({
        datePublished: "2026-09-24T13:52:11.914Z",
        dateModified: "2026-11-03T09:47:39.000Z",
      });
    }
  });

  it("are read from the fields a content type maps", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", { ...POST, createdAt: "2026-09-01" }),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({
        types: {
          posts: {
            type: "blogPosting",
            details: {
              blogPosting: {
                datePublished: "createdAt",
                dateModified: "updatedAt",
              },
            },
          },
        },
      })
    );

    expect(nodeOf(nodes, "BlogPosting")).toMatchObject({
      datePublished: "2026-09-01",
      dateModified: "2026-11-12T00:00:00.000Z",
    });
  });
});

describe("a blog post", () => {
  it("credits its author by their own page, and states its keywords, section and length", async () => {
    const { nodes, problems } = await buildStructuredData(
      context(),
      entryInput("posts", POST),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI | Rext AI"),
      rules({ types: { posts: { type: "blogPosting" } } })
    );

    expect(problems).toEqual([]);
    expect(nodeOf(nodes, "BlogPosting")).toMatchObject({
      "@id": `${POST_URL}#blogPosting`,
      mainEntityOfPage: { "@id": `${POST_URL}#webpage` },
      author: {
        "@type": "Person",
        "@id": `${ORIGIN}/authors/sajad-hussain#person`,
        name: "Sajad Hussain",
        url: `${ORIGIN}/authors/sajad-hussain`,
        jobTitle: "Editor",
      },
      publisher: { "@id": `${ORIGIN}/#organization` },
      keywords: "Comparison, AI writing",
      articleSection: "Alternatives",
      wordCount: 7,
      inLanguage: "en",
    });
    expect(nodeOf(nodes, "WebPage")?.mainEntity).toEqual({
      "@id": `${POST_URL}#blogPosting`,
    });
  });

  it("states no keywords or section from relationships the route read as ids", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", { ...POST, tags: ["t1", "t2"], category: "c1" }),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({ types: { posts: { type: "blogPosting" } } })
    );

    const post = nodeOf(nodes, "BlogPosting");
    expect(post).not.toHaveProperty("keywords");
    expect(post).not.toHaveProperty("articleSection");
    expect(JSON.stringify(nodes)).not.toMatch(/"t1"|"c1"/);
  });

  it("counts words as a reader sees them, a word split by formatting as one", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", {
        ...POST,
        content: {
          root: {
            children: [
              {
                type: "paragraph",
                children: [
                  { type: "text", text: "Next" },
                  { type: "text", text: "ly", format: 1 },
                  { type: "text", text: " runs" },
                  { type: "linebreak" },
                  { type: "link", children: [{ type: "text", text: "here" }] },
                  { type: "text", text: "." },
                ],
              },
              {
                type: "paragraph",
                children: [{ type: "text", text: "Fast." }],
              },
            ],
          },
        },
      }),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({ types: { posts: { type: "blogPosting" } } })
    );

    // "Nextly runs here. Fast."
    expect(nodeOf(nodes, "BlogPosting")?.wordCount).toBe(4);
  });

  it("is credited to the site's default author where it names nobody", async () => {
    const post = { ...POST, author: null };
    const asBrand = await buildStructuredData(
      context(),
      entryInput("posts", post),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({
        types: { posts: { type: "blogPosting" } },
        defaultAuthor: "organization",
      })
    );
    const asTeam = await buildStructuredData(
      context(),
      entryInput("posts", post),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({
        types: { posts: { type: "blogPosting" } },
        defaultAuthor: { name: "Rext AI Team" },
      })
    );

    expect(nodeOf(asBrand.nodes, "BlogPosting")?.author).toEqual({
      "@id": `${ORIGIN}/#organization`,
    });
    expect(nodeOf(asTeam.nodes, "BlogPosting")?.author).toEqual({
      "@type": "Person",
      name: "Rext AI Team",
    });
  });

  it("credits nobody else for an author the route read without its entry", async () => {
    const { nodes, problems } = await buildStructuredData(
      context(),
      entryInput("posts", { ...POST, author: "a1" }),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({
        types: { posts: { type: "blogPosting" } },
        defaultAuthor: "organization",
      })
    );

    expect(nodeOf(nodes, "BlogPosting")).toBeUndefined();
    expect(problems.map(problem => [problem.detail, problem.fix])).toEqual([
      ["author", "route"],
    ]);
  });
});

describe("kinds of page", () => {
  it("describes the About page the route names as the organisation's, with its founders", async () => {
    const { nodes, type } = await buildStructuredData(
      context(),
      singleInput(
        "about",
        { id: "s1", title: "About Rext AI" },
        { type: "aboutPage" }
      ),
      answerAt("/about", "About Rext AI | Rext AI"),
      rules()
    );

    expect(type).toBe("aboutPage");
    expect(nodeOf(nodes, "AboutPage")).toMatchObject({
      "@id": `${ORIGIN}/about#webpage`,
      name: "About Rext AI",
      about: { "@id": `${ORIGIN}/#organization` },
      mainEntity: { "@id": `${ORIGIN}/#organization` },
    });
    expect(nodeOf(nodes, "Person")).toEqual({
      "@type": "Person",
      "@id": `${ORIGIN}/#founder`,
      name: "Sara Khan",
      url: `${ORIGIN}/about`,
      jobTitle: "Founder",
      sameAs: ["https://github.com/sara"],
      worksFor: { "@id": `${ORIGIN}/#organization` },
    });
    expect(nodeOf(nodes, "Organization")?.founder).toEqual([
      { "@id": `${ORIGIN}/#founder` },
    ]);
  });

  it("describes a Contact page its content type chose, about the organisation, naming no founder", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      singleInput("contact", { id: "s2", title: "Get in touch." }),
      answerAt("/contact", "Contact | Rext AI"),
      rules({ types: { "single:contact": { type: "contactPage" } } })
    );

    expect(nodeOf(nodes, "ContactPage")).toMatchObject({
      name: "Get in touch.",
      about: { "@id": `${ORIGIN}/#organization` },
    });
    expect(nodeOf(nodes, "Person")).toBeUndefined();
    expect(nodeOf(nodes, "Organization")).not.toHaveProperty("founder");
  });

  it("describes a page listing entries as a collection, with the list its route gives", async () => {
    const { nodes, type } = await buildStructuredData(
      context(),
      singleInput(
        "blog",
        { id: "s3", title: "Blog" },
        {
          items: [
            { name: "Jasper vs Rext AI", url: "/blog/jasper-vs-rext-ai" },
            { name: "Elsewhere", url: "https://other.example/post" },
            { name: " ", url: "/blog/untitled" },
          ],
        }
      ),
      answerAt("/blog", "Blog | Rext AI"),
      rules()
    );

    expect(type).toBe("collectionPage");
    expect(nodeOf(nodes, "CollectionPage")?.mainEntity).toEqual({
      "@id": `${ORIGIN}/blog#itemlist`,
    });
    expect(nodeOf(nodes, "ItemList")).toEqual({
      "@type": "ItemList",
      "@id": `${ORIGIN}/blog#itemlist`,
      numberOfItems: 2,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Jasper vs Rext AI",
          url: POST_URL,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Elsewhere",
          url: "https://other.example/post",
        },
      ],
    });
  });

  it("lists nothing on a collection page whose route gives no list", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      singleInput("blog", { id: "s3", title: "Blog" }),
      answerAt("/blog", "Blog"),
      rules({ types: { "single:blog": { type: "collectionPage" } } })
    );

    expect(nodeOf(nodes, "CollectionPage")).not.toHaveProperty("mainEntity");
    expect(nodeOf(nodes, "ItemList")).toBeUndefined();
  });
});

describe("questions and answers", () => {
  const QUESTIONS = [
    { question: "Does it make things up?", answer: "It shows its sources." },
    { question: "Which CMS?", answer: "WordPress today." },
  ];
  const AS_NODES = QUESTIONS.map(each => ({
    "@type": "Question",
    name: each.question,
    acceptedAnswer: { "@type": "Answer", text: each.answer },
  }));

  it("describe a questions page by the questions its route shows", async () => {
    const { nodes, problems } = await buildStructuredData(
      context(),
      singleInput("faq", { id: "f1", title: "FAQ" }, { questions: QUESTIONS }),
      answerAt("/faq", "FAQ"),
      rules({ types: { "single:faq": { type: "faqPage" } } })
    );

    expect(problems).toEqual([]);
    expect(nodeOf(nodes, "FAQPage")).toMatchObject({
      "@id": `${ORIGIN}/faq#webpage`,
      mainEntity: AS_NODES,
    });
  });

  it("are read from a field holding them, plain or rich text", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      singleInput("faq", {
        id: "f1",
        title: "FAQ",
        faq: [
          {
            question: "Does it make things up?",
            answer: "It shows its sources.",
          },
          {
            question: "Which CMS?",
            answer: {
              root: {
                children: [
                  {
                    type: "paragraph",
                    children: [
                      { type: "text", text: "Word" },
                      { type: "text", text: "Press", format: 1 },
                      { type: "text", text: " today." },
                    ],
                  },
                ],
              },
            },
          },
          { question: "An unanswered one?", answer: "" },
        ],
      }),
      answerAt("/faq", "FAQ"),
      rules({ types: { "single:faq": { type: "faqPage" } } })
    );

    expect(nodeOf(nodes, "FAQPage")?.mainEntity).toEqual(AS_NODES);
  });

  it("are described beside a page of another kind that shows them", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      singleInput("home", { id: "h1" }, { questions: QUESTIONS }),
      answerAt("/", "Rext AI"),
      rules()
    );

    expect(nodeOf(nodes, "WebPage")).toBeDefined();
    expect(nodeOf(nodes, "FAQPage")).toEqual({
      "@type": "FAQPage",
      "@id": `${ORIGIN}/#faq`,
      mainEntity: AS_NODES,
    });
  });

  it("are never made up: a questions page showing none is a web page, and says what is missing", async () => {
    const { nodes, problems } = await buildStructuredData(
      context(),
      singleInput("faq", { id: "f1", title: "FAQ" }),
      answerAt("/faq", "FAQ"),
      rules({ types: { "single:faq": { type: "faqPage" } } })
    );

    expect(nodeOf(nodes, "FAQPage")).toBeUndefined();
    expect(nodeOf(nodes, "WebPage")).toBeDefined();
    expect(problems.map(problem => problem.message)).toEqual([
      "Missing: questions and answers.",
    ]);
  });
});

describe("software", () => {
  it("describes an app without a rating it does not have, and with a price only where given", async () => {
    const { nodes, problems } = await buildStructuredData(
      context(),
      singleInput("product", {
        id: "s1",
        title: "Rext AI",
        operatingSystem: "Web",
        applicationCategory: "BusinessApplication",
      }),
      answerAt("/", "Rext AI"),
      rules({ types: { "single:product": { type: "softwareApplication" } } })
    );

    expect(problems).toEqual([]);
    const app = nodeOf(nodes, "SoftwareApplication");
    expect(app).toMatchObject({
      name: "Rext AI",
      operatingSystem: "Web",
      applicationCategory: "BusinessApplication",
      publisher: { "@id": `${ORIGIN}/#organization` },
    });
    expect(app).not.toHaveProperty("aggregateRating");
    expect(app).not.toHaveProperty("offers");
  });

  it("describes a page's source code where it names its repository", async () => {
    const described = await buildStructuredData(
      context(),
      singleInput("code", {
        id: "s1",
        title: "Nextly",
        repository: "https://github.com/nextlyhq/nextly",
        programmingLanguage: "TypeScript",
        license: "https://opensource.org/licenses/MIT",
      }),
      answerAt("/code", "Nextly"),
      rules({ types: { "single:code": { type: "softwareSourceCode" } } })
    );
    const notAnAddress = await buildStructuredData(
      context(),
      singleInput("code", { id: "s1", title: "Nextly", repository: "nextly" }),
      answerAt("/code", "Nextly"),
      rules({ types: { "single:code": { type: "softwareSourceCode" } } })
    );

    expect(nodeOf(described.nodes, "SoftwareSourceCode")).toMatchObject({
      name: "Nextly",
      codeRepository: "https://github.com/nextlyhq/nextly",
      programmingLanguage: "TypeScript",
      license: "https://opensource.org/licenses/MIT",
    });
    expect(nodeOf(notAnAddress.nodes, "SoftwareSourceCode")).toBeUndefined();
    expect(notAnAddress.problems.map(problem => problem.detail)).toEqual([
      "codeRepository",
    ]);
  });

  it("describes documentation as a technical article without a byline or date", async () => {
    const { nodes, problems } = await buildStructuredData(
      context(),
      singleInput("doc", { id: "d1", title: "Installation" }),
      answerAt("/docs/installation", "Installation | Rext AI"),
      rules({ types: { "single:doc": { type: "techArticle" } } })
    );

    expect(problems).toEqual([]);
    expect(nodeOf(nodes, "TechArticle")).toMatchObject({
      headline: "Installation",
      publisher: { "@id": `${ORIGIN}/#organization` },
    });
  });
});

describe("the structured data options", () => {
  it.each([
    ["an email that is none", { brand: { email: "contact at rext" } }],
    ["a founder with no name", { brand: { founders: [{ name: "" }] } }],
    [
      "a parent's founding date that is no date",
      {
        brand: {
          parentOrganization: { name: "Revnix", foundingDate: "2020s" },
        },
      },
    ],
    [
      "a profile that is no address",
      { brand: { founders: [{ name: "S", sameAs: ["x"] }] } },
    ],
    ["a default author that is neither", { defaultAuthor: "nobody" }],
    [
      "a step named at no address",
      { breadcrumbs: { names: { blog: "Blog" } } },
    ],
  ])("refuses %s when the plugin is created", (_, options) => {
    expect(() => rulesFromOptions(ORIGIN, options as never)).toThrow(
      /^seoPlugin: structuredData\./
    );
  });

  it("accepts every brand fact, a default author and named steps", async () => {
    const read = rulesFromOptions(ORIGIN, {
      brand: BRAND,
      defaultAuthor: { name: "Rext AI Team", url: "/about" },
      breadcrumbs: { home: "Rext AI", names: { "/blog": "Blog" } },
    });

    expect(await read(context(), undefined)).toMatchObject({
      origin: ORIGIN,
      brand: BRAND,
      defaultAuthor: { name: "Rext AI Team", url: "/about" },
      breadcrumbs: { home: "Rext AI", names: { "/blog": "Blog" } },
    });
  });
});
