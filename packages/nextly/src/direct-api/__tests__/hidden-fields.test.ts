/**
 * The walk that leaves a populated document's own hidden fields out.
 *
 * The integration suite pins the walk on a real relationship. This pins the
 * shapes a real schema takes too long to build there: a dynamic zone, whose
 * instances name their member type with `_componentType`, a polymorphic
 * relationship, and a value population left as an id. And how often a read
 * goes to the registry: once per source for a whole call, however many rows
 * and populated documents name it.
 */
import { describe, expect, it, vi } from "vitest";

/** Each source's hidden paths and declared fields, as the registry would give them. */
const HIDDEN: Record<string, string[]> = {
  pages: [],
  authors: ["staffNote"],
  tags: ["internal"],
};

const FIELDS: Record<string, unknown[]> = {
  pages: [
    { name: "title", type: "text" },
    {
      name: "sections",
      type: "component",
      fields: [
        {
          name: "#hero",
          fields: [
            { name: "heading", type: "text" },
            { name: "author", type: "relationship", relationTo: "authors" },
          ],
        },
        {
          name: "#quote",
          fields: [{ name: "text", type: "text" }],
        },
      ],
    },
    {
      name: "related",
      type: "relationship",
      relationTo: ["authors", "tags"],
      hasMany: true,
    },
  ],
  authors: [
    { name: "name", type: "text" },
    { name: "staffNote", type: "text" },
  ],
  tags: [
    { name: "label", type: "text" },
    { name: "internal", type: "text" },
  ],
};

/** The registry reads, by source slug: each mocked lookup records its source. */
const reads = { hidden: [] as string[], fields: [] as string[] };

vi.mock("../../runtime/routing/declared-fields", () => ({
  hiddenFieldPaths: async (source: { slug: string }) => {
    reads.hidden.push(source.slug);
    return new Set(HIDDEN[source.slug] ?? []);
  },
  expandedFields: async (source: { slug: string }) => {
    reads.fields.push(source.slug);
    return FIELDS[source.slug];
  },
  withoutHidden: (document: Record<string, unknown>, hidden: Set<string>) =>
    Object.fromEntries(
      Object.entries(document).filter(([key]) => !hidden.has(key))
    ),
}));

const { hiddenFieldRead } = await import("../namespaces/hidden-fields");
const { find } = await import("../namespaces/collections");

const PAGES = { kind: "collection", slug: "pages" } as const;

/** One read's strip, as a Direct API call makes it. */
const withoutHiddenFields = <T>(
  document: T,
  config: { showHiddenFields?: boolean },
  source: typeof PAGES
): Promise<T> => hiddenFieldRead(config).without(document, source);

describe("a populated document's own hidden fields", () => {
  it("are left out inside a dynamic zone instance of the member type that holds the relation", async () => {
    const page = {
      title: "Home",
      sections: [
        {
          _componentType: "hero",
          heading: "Hi",
          author: { id: "a1", name: "Ada", staffNote: "on leave" },
        },
        // A different member type: its `author` key is not a declared relation.
        { _componentType: "quote", text: "Hello", author: { staffNote: "x" } },
      ],
    };

    const stripped = await withoutHiddenFields(
      page,
      { showHiddenFields: false },
      PAGES
    );

    expect(stripped.sections[0]?.author).toEqual({ id: "a1", name: "Ada" });
    expect(stripped.sections[1]).toEqual(page.sections[1]);
  });

  it("are left out of each polymorphic value by the collection it names, and an id is kept", async () => {
    const page = {
      title: "Home",
      sections: [],
      related: [
        {
          relationTo: "authors",
          value: { id: "a1", name: "Ada", staffNote: "on leave" },
        },
        {
          relationTo: "tags",
          value: { id: "t1", label: "News", internal: "y" },
        },
        { relationTo: "tags", value: "t2" },
      ],
    };

    const stripped = await withoutHiddenFields(
      page,
      { showHiddenFields: false },
      PAGES
    );

    expect(stripped.related).toEqual([
      { relationTo: "authors", value: { id: "a1", name: "Ada" } },
      { relationTo: "tags", value: { id: "t1", label: "News" } },
      { relationTo: "tags", value: "t2" },
    ]);
  });

  it("are kept when the read does not pass false", async () => {
    const page = {
      title: "Home",
      related: [
        {
          relationTo: "authors",
          value: { id: "a1", name: "Ada", staffNote: "on leave" },
        },
      ],
    };

    expect(await withoutHiddenFields(page, {}, PAGES)).toBe(page);
  });
});

describe("a read's declarations", () => {
  it("are read from the registry once per source for a whole find, however many rows and populated documents name it", async () => {
    // Three rows, each populating an author in a dynamic zone and an author
    // and a tag through a polymorphic relation: nine related documents over
    // two collections, beside the three rows of the third.
    const row = (n: number) => ({
      id: `p${n}`,
      title: `Page ${n}`,
      sections: [
        {
          _componentType: "hero",
          heading: "Hi",
          author: { id: `a${n}`, name: "Ada", staffNote: "on leave" },
        },
      ],
      related: [
        {
          relationTo: "authors",
          value: { id: `a${n}`, name: "Ada", staffNote: "on leave" },
        },
        {
          relationTo: "tags",
          value: { id: `t${n}`, label: "News", internal: "y" },
        },
      ],
    });
    const ctx = {
      defaultConfig: {},
      collectionsHandler: {
        listEntries: async () => ({
          success: true,
          data: { docs: [row(1), row(2), row(3)], totalDocs: 3 },
        }),
      },
    } as unknown as Parameters<typeof find>[0];
    reads.hidden.length = 0;
    reads.fields.length = 0;

    const result = await find(ctx, {
      collection: "pages",
      showHiddenFields: false,
    } as Parameters<typeof find>[1]);

    // The control: every populated document was stripped, so the reads below
    // are the whole call's and not a walk that stopped early.
    const items = result.items as unknown as ReturnType<typeof row>[];
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.sections[0]?.author).toEqual({
        id: item.sections[0]?.author.id,
        name: "Ada",
      });
      expect(item.related[1]?.value).not.toHaveProperty("internal");
    }
    expect(reads.hidden.sort()).toEqual(["authors", "pages", "tags"]);
    expect(reads.fields.sort()).toEqual(["authors", "pages", "tags"]);
  });
});
