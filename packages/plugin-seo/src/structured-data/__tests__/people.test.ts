/**
 * The site's People in a page's graph: each person the site names is one
 * node with one `@id`, wherever and however a page names them.
 *
 * What each case pins:
 * - a founder, a post's author named by a relationship, an author named as
 *   text, the default author and the subject of a profile page are one
 *   person, by one `@id`, with one node holding every fact the site gives;
 * - an `@id` given for a person on another site is the one every reference
 *   names, and the graph still defines it with the facts the site holds;
 * - a name is matched only as the same name (case and spacing aside) or one
 *   of the person's other names, never a near one;
 * - a team named as an author is an organisation, and the brand's own name
 *   is the site's organisation;
 * - on a person's site, the person publishes the site, the home page is a
 *   profile page about them, and no organisation is described.
 */
import {
  type PageMetadataAnswer,
  type PageMetadataInput,
  type PluginContext,
  type PublicAddressType,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { buildStructuredData, type StructuredDataNode } from "../graph";
import type { StructuredDataRules } from "../rules";

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  publicAddressOf: async (
    type: PublicAddressType,
    entry?: Readonly<Record<string, unknown>>
  ) =>
    type.kind === "collection" && type.slug === "authors"
      ? { status: "resolved", path: `/authors/${String(entry?.slug)}` }
      : { status: "none" },
  languageAddressOf: async (path: string) => ({ status: "resolved", path }),
  addressOfRequest: async (url: URL) =>
    url.origin === ORIGIN ? { locale: "en", path: url.pathname } : undefined,
}));

vi.mock("../../address-record/store", async importOriginal => ({
  ...(await importOriginal()),
  ...(await import("../../address-record/__tests__/record-double"))
    .recordDouble,
}));

const ORIGIN = "https://example.com";

/** A site whose posts name an author by a relationship or as text. */
function context(): PluginContext {
  return {
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
              { name: "title", type: "text" },
              { name: "name", type: "text" },
              { name: "author", type: "relationship", relationTo: "authors" },
              { name: "writer", type: "text" },
            ],
          },
        }),
      },
      singles: { list: async () => ({ total: 0, data: [] }) },
    },
  } as unknown as PluginContext;
}

function answerAt(canonical: string, title: string): PageMetadataAnswer {
  return {
    title,
    description: "What the page says it is.",
    canonical,
    robots: { index: true, follow: true },
    social: { siteName: "Rext AI", image: { url: "/media/card.png" } },
  };
}

function entryInput(
  collection: string,
  entry: Record<string, unknown>
): PageMetadataInput {
  return {
    source: { kind: "entry", collection, entry },
    code: {},
    derived: {},
  };
}

/** Sara, as a route reads her author entry at `depth: 1`. */
const SARA_ENTRY = { id: "a1", name: "Sara Khan", slug: "sara-khan" };

/** Sara, as the site's People list her: a founder, with her profiles. */
const SARA = {
  name: "Sara Khan",
  url: "/authors/sara-khan",
  jobTitle: "Founder",
  sameAs: ["https://github.com/sara"],
  founder: true,
};

function rules(more: Partial<StructuredDataRules> = {}): StructuredDataRules {
  return {
    origin: ORIGIN,
    brand: { name: "Rext AI" },
    people: [SARA],
    types: {
      posts: { type: "blogPosting" },
      authors: { type: "profilePage" },
    },
    ...more,
  };
}

const POST = {
  id: "p1",
  title: "Jasper vs Rext AI",
  publishedAt: "2026-09-24",
};

/** The graphs of the pages that name Sara, each its own way. */
async function graphsNamingSara(
  given: StructuredDataRules
): Promise<StructuredDataNode[][]> {
  const pages: Array<[PageMetadataInput, PageMetadataAnswer]> = [
    // Her post, by the relationship to her author entry.
    [
      entryInput("posts", { ...POST, author: SARA_ENTRY }),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
    ],
    // Another, naming her as text, in any case and spacing.
    [
      entryInput("posts", { ...POST, id: "p2", writer: "  sara   KHAN " }),
      answerAt("/blog/surfer-vs-rext-ai", "Surfer vs Rext AI"),
    ],
    // A third naming nobody, credited to her as the default author.
    [
      entryInput("posts", { ...POST, id: "p3" }),
      answerAt("/blog/rext-ai-launch", "Rext AI launch"),
    ],
    // Her own profile page, about her by her entry's name.
    [
      entryInput("authors", SARA_ENTRY),
      answerAt("/authors/sara-khan", "Sara Khan"),
    ],
  ];
  return Promise.all(
    pages.map(
      async ([input, answer]) =>
        (await buildStructuredData(context(), input, answer, given)).nodes
    )
  );
}

/** Every node of a graph that describes a person. */
const persons = (nodes: readonly StructuredDataNode[]) =>
  nodes.filter(node => node["@type"] === "Person");

/** The node of `type` in a graph. */
function nodeOf(
  nodes: readonly StructuredDataNode[],
  type: string
): StructuredDataNode | undefined {
  return nodes.find(each => each["@type"] === type);
}

const SARA_ID = `${ORIGIN}/authors/sara-khan#person`;

describe("one person, one node", () => {
  it("names a founder, an author and a profile's subject as one person with one @id", async () => {
    const graphs = await graphsNamingSara(
      rules({ defaultAuthor: { name: "Sara Khan" } })
    );

    const ids = new Set(
      graphs.flatMap(nodes => persons(nodes).map(node => node["@id"]))
    );
    expect([...ids]).toEqual([SARA_ID]);
    for (const nodes of graphs) {
      // Defined once in each graph, with every fact the site gives her.
      expect(persons(nodes)).toEqual([
        {
          "@type": "Person",
          "@id": SARA_ID,
          name: "Sara Khan",
          url: `${ORIGIN}/authors/sara-khan`,
          jobTitle: "Founder",
          sameAs: ["https://github.com/sara"],
          worksFor: { "@id": `${ORIGIN}/#organization` },
        },
      ]);
      // The organisation names its founder on every page, not only About.
      expect(nodeOf(nodes, "Organization")?.founder).toEqual([
        { "@id": SARA_ID },
      ]);
    }
    const [byRelation, byText, byDefault, profile] = graphs;
    for (const nodes of [byRelation, byText, byDefault]) {
      expect(nodeOf(nodes ?? [], "BlogPosting")?.author).toEqual({
        "@id": SARA_ID,
      });
    }
    expect(nodeOf(profile ?? [], "ProfilePage")?.mainEntity).toEqual({
      "@id": SARA_ID,
    });
  });

  it("names a person on another site by the @id given, defined with the facts held here", async () => {
    const mobeen = {
      name: "Mobeen Abdullah",
      id: "https://mobeenabdullah.com/#person",
      url: "https://mobeenabdullah.com/",
      sameAs: ["https://github.com/mobeenabdullah"],
      founder: true,
    };
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", { ...POST, writer: "Mobeen Abdullah" }),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({ people: [mobeen] })
    );

    expect(nodeOf(nodes, "Organization")?.founder).toEqual([
      { "@id": mobeen.id },
    ]);
    expect(nodeOf(nodes, "BlogPosting")?.author).toEqual({ "@id": mobeen.id });
    expect(nodes.filter(node => node["@id"] === mobeen.id)).toEqual([
      {
        "@type": "Person",
        "@id": mobeen.id,
        name: "Mobeen Abdullah",
        url: "https://mobeenabdullah.com/",
        sameAs: ["https://github.com/mobeenabdullah"],
        worksFor: { "@id": `${ORIGIN}/#organization` },
      },
    ]);
  });

  it("matches another name a person goes by, and never a near one", async () => {
    const people = [{ ...SARA, otherNames: ["S. Khan"] }];
    const named = async (writer: string) =>
      (
        await buildStructuredData(
          context(),
          entryInput("posts", { ...POST, writer }),
          answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
          rules({ people })
        )
      ).nodes;

    expect(nodeOf(await named("S. Khan"), "BlogPosting")?.author).toEqual({
      "@id": SARA_ID,
    });
    const near = await named("Sara Khanum");
    expect(nodeOf(near, "BlogPosting")?.author).toEqual({
      "@type": "Person",
      name: "Sara Khanum",
    });
  });

  it("gives two people sharing one page an @id each, from their names", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", { ...POST, writer: "Ali Raza" }),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({
        people: [
          { name: "Sara Khan", url: "/about", founder: true },
          { name: "Ali Raza", url: "/about", founder: true },
        ],
      })
    );

    expect(nodeOf(nodes, "Organization")?.founder).toEqual([
      { "@id": `${ORIGIN}/#person-sara-khan` },
      { "@id": `${ORIGIN}/#person-ali-raza` },
    ]);
    expect(nodeOf(nodes, "BlogPosting")?.author).toEqual({
      "@id": `${ORIGIN}/#person-ali-raza`,
    });
  });

  it("tells two people sharing a page apart by the name a page gives", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", {
        ...POST,
        author: { id: "a3", name: "Ali Raza", slug: "team" },
      }),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({
        people: [
          { name: "Sara Khan", url: "/authors/team" },
          { name: "Ali Raza", url: "/authors/team" },
        ],
      })
    );

    expect(nodeOf(nodes, "BlogPosting")?.author).toEqual({
      "@id": `${ORIGIN}/#person-ali-raza`,
    });
  });

  it("keeps two different names that spell the same identifier two people", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", { ...POST, writer: "Anne Marie" }),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({
        people: [
          { name: "Anne-Marie", jobTitle: "Editor" },
          { name: "Anne Marie", jobTitle: "Writer" },
        ],
      })
    );

    expect(nodeOf(nodes, "BlogPosting")?.author).toEqual({
      "@id": `${ORIGIN}/#person-anne-marie-2`,
    });
    expect(
      persons(nodes).find(
        each => each["@id"] === `${ORIGIN}/#person-anne-marie-2`
      )?.jobTitle
    ).toBe("Writer");
  });

  it("never gives a person a generated @id another entry gives as its own", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", { ...POST, writer: "Bob Stone" }),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({
        people: [
          { name: "Alice Lee", founder: true },
          {
            name: "Bob Stone",
            id: `${ORIGIN}/#person-alice-lee`,
            founder: true,
          },
        ],
      })
    );

    expect(nodeOf(nodes, "Organization")?.founder).toEqual([
      { "@id": `${ORIGIN}/#person-alice-lee-2` },
      { "@id": `${ORIGIN}/#person-alice-lee` },
    ]);
    expect(nodeOf(nodes, "BlogPosting")?.author).toEqual({
      "@id": `${ORIGIN}/#person-alice-lee`,
    });
    expect(
      persons(nodes).find(each => each["@id"] === `${ORIGIN}/#person-alice-lee`)
        ?.name
    ).toBe("Bob Stone");
  });

  it("keeps a team whose page is the home page apart from the site's own organisation", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", { ...POST, writer: "Editorial team" }),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({
        people: [{ name: "Editorial team", type: "organization", url: "/" }],
      })
    );

    expect(nodeOf(nodes, "BlogPosting")?.author).toEqual({
      "@id": `${ORIGIN}/#organization-2`,
    });
    expect(
      nodes.find(each => each["@id"] === `${ORIGIN}/#organization-2`)?.name
    ).toBe("Editorial team");
    expect(
      nodes.find(each => each["@id"] === `${ORIGIN}/#organization`)?.name
    ).toBe("Rext AI");
  });

  it("still knows a person by the name of a second entry giving the same @id", async () => {
    const SHARED = "https://sara.example/#person";
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", { ...POST, writer: "S. Khan" }),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      rules({
        people: [
          { name: "Sara Khan", id: SHARED },
          { name: "S. Khan", id: SHARED, jobTitle: "Founder" },
        ],
      })
    );

    expect(nodeOf(nodes, "BlogPosting")?.author).toEqual({ "@id": SHARED });
  });

  it("gives a profile page's subject named as text the page's own address", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("authors", { id: "a2", name: "Ali Raza", slug: "ali-raza" }),
      answerAt("/authors/ali-raza", "Ali Raza"),
      rules({ people: [] })
    );

    // The same `@id` a post naming him by the relationship gives him.
    expect(nodeOf(nodes, "ProfilePage")?.mainEntity).toEqual({
      "@type": "Person",
      "@id": `${ORIGIN}/authors/ali-raza#person`,
      name: "Ali Raza",
      url: `${ORIGIN}/authors/ali-raza`,
    });
  });
});

describe("a team credited as an author", () => {
  it("is an organisation where its entry says so, and the brand's name is the site's own", async () => {
    const team = {
      name: "Rext AI Team",
      type: "organization" as const,
      url: "https://example.com/team",
    };
    const credit = async (writer: string) =>
      (
        await buildStructuredData(
          context(),
          entryInput("posts", { ...POST, writer }),
          answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
          rules({ people: [team] })
        )
      ).nodes;

    const byTeam = await credit("Rext AI Team");
    expect(nodeOf(byTeam, "BlogPosting")?.author).toEqual({
      "@id": `${ORIGIN}/team#organization`,
    });
    expect(
      byTeam.find(node => node["@id"] === `${ORIGIN}/team#organization`)
    ).toEqual({
      "@type": "Organization",
      "@id": `${ORIGIN}/team#organization`,
      name: "Rext AI Team",
      url: `${ORIGIN}/team`,
    });
    const byBrand = await credit("Rext AI");
    expect(nodeOf(byBrand, "BlogPosting")?.author).toEqual({
      "@id": `${ORIGIN}/#organization`,
    });
    // The site's own organisation, written once.
    expect(
      byBrand.filter(node => node["@id"] === `${ORIGIN}/#organization`)
    ).toHaveLength(1);
  });
});

describe("a person's site", () => {
  const MOBEEN_RULES: StructuredDataRules = {
    origin: ORIGIN,
    brand: {
      kind: "person",
      name: "Mobeen Abdullah",
      logo: { url: "/media/mobeen.jpg" },
      profiles: [{ url: "https://github.com/mobeenabdullah" }],
      description: "A software engineer who builds Nextly.",
    },
    people: [
      {
        name: "Mobeen Abdullah",
        jobTitle: "Founder",
        worksFor: { name: "Revnix", url: "https://revnix.com" },
        knowsAbout: ["TypeScript"],
      },
    ],
    defaultAuthor: "organization",
    types: { posts: { type: "blogPosting" } },
  };
  const PERSON_ID = `${ORIGIN}/#person`;
  const home = (): PageMetadataInput =>
    entryInput("pages", { id: "h1", title: "Mobeen Abdullah" });

  it("is published by the person, whose home page is a profile about them, with no organisation", async () => {
    const { nodes, type } = await buildStructuredData(
      context(),
      home(),
      answerAt("/", "Mobeen Abdullah"),
      MOBEEN_RULES
    );

    expect(type).toBe("profilePage");
    expect(nodes.filter(node => node["@type"] === "Organization")).toEqual([]);
    expect(nodes.some(node => node["@id"] === `${ORIGIN}/#organization`)).toBe(
      false
    );
    expect(nodeOf(nodes, "WebSite")?.publisher).toEqual({ "@id": PERSON_ID });
    expect(nodeOf(nodes, "ProfilePage")?.mainEntity).toEqual({
      "@id": PERSON_ID,
    });
    // The person, from their entry over the brand's facts.
    expect(persons(nodes)).toEqual([
      {
        "@type": "Person",
        "@id": PERSON_ID,
        name: "Mobeen Abdullah",
        url: `${ORIGIN}/`,
        image: `${ORIGIN}/media/mobeen.jpg`,
        jobTitle: "Founder",
        description: "A software engineer who builds Nextly.",
        sameAs: ["https://github.com/mobeenabdullah"],
        knowsAbout: ["TypeScript"],
        // The company they work for, named as its own site names itself.
        worksFor: {
          "@type": "Organization",
          "@id": "https://revnix.com/#organization",
          name: "Revnix",
          url: "https://revnix.com/",
        },
      },
    ]);
  });

  it("credits the person's posts to them, as author and publisher", async () => {
    const { nodes } = await buildStructuredData(
      context(),
      entryInput("posts", POST),
      answerAt("/blog/jasper-vs-rext-ai", "Jasper vs Rext AI"),
      MOBEEN_RULES
    );

    const post = nodeOf(nodes, "BlogPosting");
    expect(post?.author).toEqual({ "@id": PERSON_ID });
    expect(post?.publisher).toEqual({ "@id": PERSON_ID });
    expect(persons(nodes).map(node => node["@id"])).toEqual([PERSON_ID]);
  });

  it("leaves the home page as its route says it is", async () => {
    const { type } = await buildStructuredData(
      context(),
      { ...home(), structuredDataHints: { type: "webPage" } },
      answerAt("/", "Mobeen Abdullah"),
      MOBEEN_RULES
    );

    expect(type).toBe("webPage");
  });

  it("leaves a page somebody chose a kind for as they chose it", async () => {
    const { type } = await buildStructuredData(
      context(),
      entryInput("pages", {
        id: "h1",
        title: "Mobeen Abdullah",
        seo: { structuredDataType: "webPage" },
      }),
      answerAt("/", "Mobeen Abdullah"),
      MOBEEN_RULES
    );

    expect(type).toBe("webPage");
  });
});
