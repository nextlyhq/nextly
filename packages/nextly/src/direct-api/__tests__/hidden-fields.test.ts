/**
 * The walk that leaves a populated document's own hidden fields out.
 *
 * The integration suite pins the walk on a real relationship. This pins the
 * shapes a real schema takes too long to build there: a dynamic zone, whose
 * instances name their member type with `_componentType`, a polymorphic
 * relationship, and a value population left as an id.
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

vi.mock("../../runtime/routing/declared-fields", () => ({
  hiddenFieldPaths: async (source: { slug: string }) =>
    new Set(HIDDEN[source.slug] ?? []),
  expandedFields: async (source: { slug: string }) => FIELDS[source.slug],
  withoutHidden: (document: Record<string, unknown>, hidden: Set<string>) =>
    Object.fromEntries(
      Object.entries(document).filter(([key]) => !hidden.has(key))
    ),
}));

const { withoutHiddenFields } = await import("../namespaces/hidden-fields");

const PAGES = { kind: "collection", slug: "pages" } as const;

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
