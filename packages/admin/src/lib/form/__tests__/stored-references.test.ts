// Keeping the links an editor cannot see.
//
// Each case pairs a populated read with the depth-0 read of the same document,
// shaped as the server answers: a to-many value leaves a hidden or missing item
// out, a to-one relationship keeps only its id, a to-one upload is empty. The
// assertions read the whole merged value, so an implementation that appended
// placeholders, lost the order, or marked a readable row would fail by name.
import { describe, expect, it } from "vitest";

import {
  RESTRICTED_REFERENCE,
  isRestrictedReference,
  populatedAmongStored,
  withStoredReferences,
  withoutPlaceholders,
} from "../stored-references";

/** The field shapes are structural; the schema types are wider than this needs. */
const f = (o: Record<string, unknown>) => o as never;

const placeholder = (id: string) => ({ id, [RESTRICTED_REFERENCE]: true });
const pairPlaceholder = (relationTo: string, value: string) => ({
  relationTo,
  value,
  [RESTRICTED_REFERENCE]: true,
});

const pageA = { id: "a", title: "Page A" };
const pageC = { id: "c", title: "Page C" };

describe("withStoredReferences", () => {
  it("puts a placeholder where a to-many read left an item out, in stored order", () => {
    const merged = withStoredReferences(
      [
        f({
          name: "pages",
          type: "relationship",
          relationTo: "pages",
          hasMany: true,
        }),
      ],
      { pages: [pageA, pageC] },
      { pages: ["a", "hidden", "c"] }
    );
    expect(merged.pages).toEqual([pageA, placeholder("hidden"), pageC]);
  });

  it("puts a placeholder where a to-one relationship kept only its id", () => {
    const merged = withStoredReferences(
      [f({ name: "author", type: "relationship", relationTo: "users" })],
      { author: "u-1" },
      { author: "u-1" }
    );
    expect(merged.author).toEqual(placeholder("u-1"));
  });

  it("leaves a to-one relationship the read populated as its row", () => {
    const merged = withStoredReferences(
      [f({ name: "page", type: "relationship", relationTo: "pages" })],
      { page: pageA },
      { page: "a" }
    );
    expect(merged.page).toBe(pageA);
  });

  it("puts a placeholder where a to-one upload came back empty", () => {
    const merged = withStoredReferences(
      [f({ name: "image", type: "upload", relationTo: "media" })],
      { image: null },
      { image: "m-1" }
    );
    expect(merged.image).toEqual(placeholder("m-1"));
  });

  it("keeps an upload list's order around a hidden item", () => {
    const m1 = { id: "m-1", filename: "one.png" };
    const m3 = { id: "m-3", filename: "three.png" };
    const merged = withStoredReferences(
      [
        f({
          name: "gallery",
          type: "upload",
          relationTo: "media",
          hasMany: true,
        }),
      ],
      { gallery: [m1, m3] },
      { gallery: ["m-2", "m-1", "m-3"] }
    );
    expect(merged.gallery).toEqual([placeholder("m-2"), m1, m3]);
  });

  it("matches a multi-collection link by its collection as well as its id", () => {
    const pageRow = {
      relationTo: "pages",
      value: { id: "x", title: "Page X" },
    };
    const merged = withStoredReferences(
      [
        f({
          name: "related",
          type: "relationship",
          relationTo: ["pages", "notes"],
          hasMany: true,
        }),
      ],
      { related: [pageRow] },
      {
        related: [
          { relationTo: "notes", value: "x" },
          { relationTo: "pages", value: "x" },
        ],
      }
    );
    expect(merged.related).toEqual([pairPlaceholder("notes", "x"), pageRow]);
  });

  it("puts a placeholder where a multi-collection to-one kept only its pair", () => {
    const merged = withStoredReferences(
      [
        f({
          name: "target",
          type: "relationship",
          relationTo: ["pages", "notes"],
        }),
      ],
      { target: { relationTo: "notes", value: "n-1" } },
      { target: { relationTo: "notes", value: "n-1" } }
    );
    expect(merged.target).toEqual(pairPlaceholder("notes", "n-1"));
  });

  it("gives a link stored twice its row twice", () => {
    const merged = withStoredReferences(
      [
        f({
          name: "pages",
          type: "relationship",
          relationTo: "pages",
          hasMany: true,
        }),
      ],
      { pages: [pageA, pageA] },
      { pages: ["a", "a"] }
    );
    expect(merged.pages).toEqual([pageA, pageA]);
  });

  it("merges inside a group and a repeater", () => {
    const fields = [
      f({
        name: "box",
        type: "group",
        fields: [
          f({ name: "page", type: "relationship", relationTo: "pages" }),
        ],
      }),
      f({
        name: "lines",
        type: "repeater",
        fields: [
          f({
            name: "items",
            type: "relationship",
            relationTo: "pages",
            hasMany: true,
          }),
        ],
      }),
    ];
    const merged = withStoredReferences(
      fields,
      {
        box: { page: "hidden" },
        lines: [{ items: [pageA] }, { items: [] }],
      },
      {
        box: { page: "hidden" },
        lines: [{ items: ["a", "gone"] }, { items: ["c"] }],
      }
    );
    expect(merged.box).toEqual({ page: placeholder("hidden") });
    expect(merged.lines).toEqual([
      { items: [pageA, placeholder("gone")] },
      { items: [placeholder("c")] },
    ]);
  });

  it("leaves a field whose read never populates it, and every other field, as read", () => {
    const merged = withStoredReferences(
      [
        f({ name: "title", type: "text" }),
        f({
          name: "shallow",
          type: "relationship",
          relationTo: "pages",
          maxDepth: 0,
        }),
      ],
      { title: "Hello", shallow: "a" },
      { title: "Hello", shallow: "a" }
    );
    expect(merged).toEqual({ title: "Hello", shallow: "a" });
  });

  it("reads a field the API returned under its column name, as the form does", () => {
    // The form reads `featuredImage` or, failing that, `featured_image`; a
    // merge that looked only for the first would leave the link out.
    const merged = withStoredReferences(
      [f({ name: "featuredImage", type: "upload", relationTo: "media" })],
      { featured_image: null } as Record<string, unknown>,
      { featured_image: "m1" }
    );
    expect(merged.featuredImage).toEqual(placeholder("m1"));
  });

  it("keeps an empty link empty", () => {
    const merged = withStoredReferences(
      [
        f({ name: "page", type: "relationship", relationTo: "pages" }),
        f({
          name: "pages",
          type: "relationship",
          relationTo: "pages",
          hasMany: true,
        }),
      ],
      { page: null, pages: [] },
      { page: null, pages: [] }
    );
    expect(merged).toEqual({ page: null, pages: [] });
  });
});

describe("isRestrictedReference", () => {
  it("recognises a placeholder and nothing else", () => {
    expect(isRestrictedReference(placeholder("a"))).toBe(true);
    expect(isRestrictedReference(pairPlaceholder("pages", "a"))).toBe(true);
    expect(isRestrictedReference(pageA)).toBe(false);
    expect(isRestrictedReference("a")).toBe(false);
    expect(isRestrictedReference(null)).toBe(false);
  });
});

describe("withoutPlaceholders", () => {
  const fields = [
    f({
      name: "pages",
      type: "relationship",
      relationTo: "pages",
      hasMany: true,
    }),
    f({ name: "image", type: "upload", relationTo: "media" }),
    f({
      name: "related",
      type: "relationship",
      relationTo: ["pages", "notes"],
      hasMany: true,
    }),
    f({
      name: "box",
      type: "group",
      fields: [f({ name: "logo", type: "upload", relationTo: "media" })],
    }),
    f({
      name: "lines",
      type: "repeater",
      fields: [
        f({
          name: "gallery",
          type: "upload",
          relationTo: "media",
          hasMany: true,
        }),
      ],
    }),
    f({ name: "settings", type: "json" }),
  ];

  it("writes each placeholder as its reference, at the top level and nested", () => {
    expect(
      withoutPlaceholders(fields, {
        title: "T",
        pages: [pageA, placeholder("hidden")],
        image: placeholder("m1"),
        related: [pairPlaceholder("notes", "n1")],
        box: { logo: placeholder("m2") },
        lines: [{ gallery: ["m3", placeholder("m4")] }],
      })
    ).toEqual({
      title: "T",
      pages: [pageA, "hidden"],
      image: "m1",
      related: [{ relationTo: "notes", value: "n1" }],
      box: { logo: "m2" },
      lines: [{ gallery: ["m3", "m4"] }],
    });
  });

  it("leaves content outside reference fields as the author wrote it", () => {
    // A JSON value may carry any key, the marker's included; it is content.
    const settings = { id: "s", [RESTRICTED_REFERENCE]: true, depth: 2 };
    expect(withoutPlaceholders(fields, { settings }).settings).toEqual(
      settings
    );
  });
});

describe("populatedAmongStored", () => {
  const fields = [
    f({
      name: "pages",
      type: "relationship",
      relationTo: "pages",
      hasMany: true,
    }),
    f({ name: "page", type: "relationship", relationTo: "pages" }),
  ];

  it("holds when every populated row is a stored link, hidden ones left out", () => {
    expect(
      populatedAmongStored(
        fields,
        { pages: [pageA], page: "hidden" },
        { pages: ["a", "hidden"], page: "hidden" }
      )
    ).toBe(true);
  });

  it("fails for a row the stored read lacks, which only another version can hold", () => {
    expect(
      populatedAmongStored(fields, { pages: [pageA, pageC] }, { pages: ["a"] })
    ).toBe(false);
    expect(populatedAmongStored(fields, { page: pageC }, { page: "a" })).toBe(
      false
    );
  });
});

describe("populatedAmongStored, nested and edge cases", () => {
  const nested = [
    f({
      name: "box",
      type: "group",
      fields: [f({ name: "page", type: "relationship", relationTo: "pages" })],
    }),
    f({
      name: "lines",
      type: "repeater",
      fields: [
        f({
          name: "items",
          type: "relationship",
          relationTo: "pages",
          hasMany: true,
        }),
      ],
    }),
    f({
      name: "shallow",
      type: "relationship",
      relationTo: "pages",
      maxDepth: 0,
    }),
    f({
      name: "related",
      type: "relationship",
      relationTo: ["pages", "notes"],
      hasMany: true,
    }),
  ];

  it("reads groups and repeaters row by row", () => {
    expect(
      populatedAmongStored(
        nested,
        { box: { page: pageA }, lines: [{ items: [pageA] }] },
        { box: { page: "a" }, lines: [{ items: ["a", "hidden"] }] }
      )
    ).toBe(true);
    expect(
      populatedAmongStored(
        nested,
        { box: { page: pageC } },
        { box: { page: "a" } }
      )
    ).toBe(false);
    expect(
      populatedAmongStored(
        nested,
        { lines: [{ items: [pageC] }] },
        { lines: [{ items: ["a"] }] }
      )
    ).toBe(false);
  });

  it("takes repeaters of different lengths for different versions", () => {
    expect(
      populatedAmongStored(
        nested,
        { lines: [{ items: [] }, { items: [] }] },
        { lines: [{ items: [] }] }
      )
    ).toBe(false);
  });

  it("counts a link stored once against a row given twice", () => {
    expect(
      populatedAmongStored(
        nested,
        {
          related: [
            { relationTo: "pages", value: pageA },
            { relationTo: "pages", value: pageA },
          ],
        },
        { related: [{ relationTo: "pages", value: "a" }] }
      )
    ).toBe(false);
  });

  it("matches a multi-collection row by its collection", () => {
    expect(
      populatedAmongStored(
        nested,
        { related: [{ relationTo: "pages", value: pageA }] },
        { related: [{ relationTo: "notes", value: "a" }] }
      )
    ).toBe(false);
  });

  it("leaves a field the read never populates out of the comparison", () => {
    expect(
      populatedAmongStored(nested, { shallow: "x" }, { shallow: "a" })
    ).toBe(true);
  });
});

describe("inside field groups", () => {
  // A field group's own fields, as the schema API enriches it: one
  // component's under `componentFields`, a dynamic zone's under
  // `componentSchemas`, each row naming its own.
  const cardFields = [
    f({ name: "heading", type: "text" }),
    f({
      name: "pages",
      type: "relationship",
      relationTo: "pages",
      hasMany: true,
    }),
    f({ name: "image", type: "upload", relationTo: "media" }),
  ];
  const quoteFields = [
    f({ name: "note", type: "relationship", relationTo: "notes" }),
  ];
  const fields = [
    f({
      name: "card",
      type: "component",
      component: "card",
      componentFields: cardFields,
    }),
    f({
      name: "cards",
      type: "component",
      component: "card",
      repeatable: true,
      componentFields: cardFields,
    }),
    f({
      name: "blocks",
      type: "fieldGroup",
      fieldGroups: ["card", "quote"],
      repeatable: true,
      componentSchemas: {
        card: { fields: cardFields },
        quote: { fields: quoteFields },
      },
    }),
  ];
  const cardRow = (pages: unknown[], image: unknown) => ({
    heading: "H",
    pages,
    image,
  });

  it("puts placeholders in a field group, a repeatable one and a dynamic zone", () => {
    const merged = withStoredReferences(
      fields,
      {
        card: cardRow([pageA], null),
        cards: [cardRow([], null), cardRow([pageC], null)],
        blocks: [
          { _componentType: "quote", note: "n1" },
          { _componentType: "card", ...cardRow([pageA], null) },
        ],
      },
      {
        card: cardRow(["a", "hidden"], "m1"),
        cards: [cardRow(["gone"], null), cardRow(["c"], "m2")],
        blocks: [
          { _componentType: "quote", note: "n1" },
          { _componentType: "card", ...cardRow(["hidden", "a"], null) },
        ],
      }
    );
    expect(merged.card).toEqual(
      cardRow([pageA, placeholder("hidden")], placeholder("m1"))
    );
    expect(merged.cards).toEqual([
      cardRow([placeholder("gone")], null),
      cardRow([pageC], placeholder("m2")),
    ]);
    expect(merged.blocks).toEqual([
      { _componentType: "quote", note: placeholder("n1") },
      {
        _componentType: "card",
        ...cardRow([placeholder("hidden"), pageA], null),
      },
    ]);
  });

  it("leaves a dynamic zone row alone when the two reads disagree on its type", () => {
    const populated = {
      blocks: [{ _componentType: "card", ...cardRow([], null) }],
    };
    const merged = withStoredReferences(fields, populated, {
      blocks: [{ _componentType: "quote", note: "n1" }],
    });
    expect(merged.blocks).toEqual(populated.blocks);
  });

  it("writes placeholders inside field groups as their references", () => {
    expect(
      withoutPlaceholders(fields, {
        card: cardRow([pageA, placeholder("hidden")], placeholder("m1")),
        blocks: [
          { _componentType: "quote", note: placeholder("n1") },
          { _componentType: "card", ...cardRow([placeholder("h")], null) },
        ],
      })
    ).toEqual({
      card: cardRow([pageA, "hidden"], "m1"),
      blocks: [
        { _componentType: "quote", note: "n1" },
        { _componentType: "card", ...cardRow(["h"], null) },
      ],
    });
  });

  it("takes a field group present in only one read, or rows with other ids, for another version", () => {
    // Two reads straddling an edit made in the same second share a timestamp
    // stored to the second; the instances themselves still tell them apart.
    expect(
      populatedAmongStored(fields, { card: cardRow([], null) }, { card: null })
    ).toBe(false);
    expect(
      populatedAmongStored(fields, { card: null }, { card: cardRow([], null) })
    ).toBe(false);
    expect(
      populatedAmongStored(
        fields,
        { cards: [{ id: "row-2", ...cardRow([], null) }] },
        { cards: [{ id: "row-1", ...cardRow([], null) }] }
      )
    ).toBe(false);
    expect(
      populatedAmongStored(
        fields,
        { card: null, cards: [{ id: "row-1", ...cardRow([], null) }] },
        { card: null, cards: [{ id: "row-1", ...cardRow(["hidden"], null) }] }
      )
    ).toBe(true);
  });

  it("tells two versions apart by the links inside field groups too", () => {
    expect(
      populatedAmongStored(
        fields,
        { blocks: [{ _componentType: "card", ...cardRow([pageC], null) }] },
        { blocks: [{ _componentType: "card", ...cardRow(["a"], null) }] }
      )
    ).toBe(false);
    expect(
      populatedAmongStored(
        fields,
        { cards: [cardRow([], null)] },
        { cards: [cardRow([], null), cardRow([], null)] }
      )
    ).toBe(false);
    expect(
      populatedAmongStored(
        fields,
        { card: cardRow([pageA], null) },
        { card: cardRow(["a", "hidden"], "m1") }
      )
    ).toBe(true);
  });
});
