/**
 * The walker over stored content: every reference shape it lists, and the
 * same walk rewriting each of them by a map.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import { ALL_FIELD_TYPES } from "../../../../collections/fields/types";
import { currentFieldGroupTypeKey } from "../../../field-groups/storage/field-group-type-key";
import type { FieldGroupSchemas } from "../../../media/usage/media-references";
import {
  listContentReferences,
  rewriteContentReferences,
} from "../content-references";
import { FIELD_REFERENCE_KINDS } from "../field-reference-kinds";
import type { PluginReferenceShapes } from "../plugin-reference-shapes";
import type { ReferenceMap } from "../reference-map";

const A = "0b6f4f3e-58a5-4c3e-9a51-0d6c1c1e0a01";
const B = "0b6f4f3e-58a5-4c3e-9a51-0d6c1c1e0a02";
const C = "0b6f4f3e-58a5-4c3e-9a51-0d6c1c1e0a03";
const NEW_A = "9a9a9a9a-0000-4000-8000-00000000000a";
const NEW_B = "9a9a9a9a-0000-4000-8000-00000000000b";
const NEW_C = "9a9a9a9a-0000-4000-8000-00000000000c";
const NODE_ID = "0b6f4f3e-58a5-4c3e-9a51-0d6c1c1e0aff";

const f = (field: Record<string, unknown>): FieldConfig =>
  field as unknown as FieldConfig;

/** A map moving A, B and C in every collection named. */
function mapOf(
  collections: string[],
  addresses: Record<string, string> = {}
): ReferenceMap {
  const ids = new Map([
    [A, NEW_A],
    [B, NEW_B],
    [C, NEW_C],
  ]);
  return {
    ids: new Map(collections.map(slug => [slug, ids])),
    addresses: new Map(Object.entries(addresses)),
  };
}

describe("FIELD_REFERENCE_KINDS", () => {
  // The walker dispatches from this table, so a core field type missing from
  // it is one the walker would read as nothing.
  it("says how every core field type holds references", () => {
    expect(Object.keys(FIELD_REFERENCE_KINDS).sort()).toEqual(
      [...ALL_FIELD_TYPES].sort()
    );
  });
});

describe("relationships", () => {
  const fields = [
    f({ type: "relationship", name: "author", relationTo: "people" }),
    f({
      type: "relationship",
      name: "tags",
      relationTo: "tags",
      hasMany: true,
    }),
    // As SQLite and MySQL return a JSON column.
    f({
      type: "relationship",
      name: "text",
      relationTo: "tags",
      hasMany: true,
    }),
    f({ type: "relationship", name: "either", relationTo: ["people", "tags"] }),
    f({
      type: "relationship",
      name: "many",
      relationTo: ["people", "tags"],
      hasMany: true,
    }),
    f({ type: "relationship", name: "expanded", relationTo: "people" }),
    // The Schema Builder spells the target `options.target`.
    f({ type: "relationship", name: "built", options: { target: "people" } }),
    f({ type: "relationship", name: "numbered", relationTo: "people" }),
  ];
  const values = {
    author: A,
    tags: [A, B],
    text: JSON.stringify([C]),
    either: { relationTo: "tags", value: B },
    many: [
      { relationTo: "people", value: A },
      { relationTo: "tags", value: { id: C } },
    ],
    expanded: { id: B, title: "Bea" },
    built: C,
    numbered: 7,
  };

  it("lists an id in every shape, with the collection it is in", () => {
    expect(listContentReferences(fields, values)).toEqual([
      { kind: "link", fieldPath: "author", collection: "people", id: A },
      { kind: "link", fieldPath: "tags", collection: "tags", id: A },
      { kind: "link", fieldPath: "tags", collection: "tags", id: B },
      { kind: "link", fieldPath: "text", collection: "tags", id: C },
      { kind: "link", fieldPath: "either", collection: "tags", id: B },
      { kind: "link", fieldPath: "many", collection: "people", id: A },
      { kind: "link", fieldPath: "many", collection: "tags", id: C },
      { kind: "link", fieldPath: "expanded", collection: "people", id: B },
      { kind: "link", fieldPath: "built", collection: "people", id: C },
      { kind: "link", fieldPath: "numbered", collection: "people", id: "7" },
    ]);
  });

  it("rewrites each id by its own collection's map, in its stored form", () => {
    const map: ReferenceMap = {
      ids: new Map([
        [
          "people",
          new Map([
            [A, NEW_A],
            [B, NEW_B],
            [C, NEW_C],
            ["7", "8"],
          ]),
        ],
        [
          "tags",
          new Map([
            [A, "tag-a"],
            [B, "tag-b"],
            [C, "tag-c"],
          ]),
        ],
      ]),
    };
    expect(rewriteContentReferences(fields, values, map)).toEqual({
      author: NEW_A,
      tags: ["tag-a", "tag-b"],
      text: JSON.stringify(["tag-c"]),
      either: { relationTo: "tags", value: "tag-b" },
      many: [
        { relationTo: "people", value: NEW_A },
        { relationTo: "tags", value: { id: "tag-c" } },
      ],
      expanded: { id: NEW_B, title: "Bea" },
      built: NEW_C,
      numbered: "8",
    });
  });

  // An id in a field that may point at several collections, held without
  // naming one, cannot be placed in any of them.
  it("keeps an id whose collection the value and field do not name", () => {
    const either = [
      f({ type: "relationship", name: "either", relationTo: ["a", "b"] }),
    ];
    expect(listContentReferences(either, { either: A })).toEqual([
      { kind: "link", fieldPath: "either", collection: null, id: A },
    ]);
    const values = { either: A };
    expect(rewriteContentReferences(either, values, mapOf(["a", "b"]))).toBe(
      values
    );
  });
});

describe("uploads", () => {
  it("lists an upload naming no collection as a media item's", () => {
    const fields = [
      f({ type: "upload", name: "image" }),
      f({ type: "upload", name: "file", relationTo: "documents" }),
      f({ type: "upload", name: "gallery", hasMany: true }),
    ];
    const values = { image: A, file: B, gallery: JSON.stringify([A, C]) };
    expect(listContentReferences(fields, values)).toEqual([
      { kind: "link", fieldPath: "image", collection: "media", id: A },
      { kind: "link", fieldPath: "file", collection: "documents", id: B },
      { kind: "link", fieldPath: "gallery", collection: "media", id: A },
      { kind: "link", fieldPath: "gallery", collection: "media", id: C },
    ]);
    expect(rewriteContentReferences(fields, values, mapOf(["media"]))).toEqual({
      image: NEW_A,
      file: B,
      gallery: JSON.stringify([NEW_A, NEW_C]),
    });
  });
});

describe("rich text", () => {
  const fields = [f({ type: "richText", name: "body" })];
  const body = {
    root: {
      type: "root",
      children: [
        { type: "image", src: "/uploads/a.png", altText: "A" },
        {
          type: "gallery",
          images: [
            { src: `/api/media/${B}/raw?w=200` },
            { src: "https://elsewhere.example/c.png" },
          ],
        },
        // A link names a page, not a file.
        { type: "link", url: "https://example.com/about", children: [] },
      ],
    },
  };

  it("lists every src, naming the media item a route address names", () => {
    expect(listContentReferences(fields, { body })).toEqual([
      { kind: "address", fieldPath: "body", url: "/uploads/a.png" },
      {
        kind: "address",
        fieldPath: "body",
        url: `/api/media/${B}/raw?w=200`,
        mediaId: B,
      },
      {
        kind: "address",
        fieldPath: "body",
        url: "https://elsewhere.example/c.png",
      },
    ]);
  });

  it("rewrites mapped addresses and the route of a moved media item", () => {
    const stored = JSON.stringify(body);
    const next = rewriteContentReferences(
      fields,
      { body: stored },
      mapOf(["media"], { "/uploads/a.png": "https://cdn.example/a.png" })
    );
    // A rich-text column a dialect returned as a string stays one.
    expect(typeof next.body).toBe("string");
    const rewritten = JSON.parse(String(next.body)) as typeof body;
    expect(rewritten.root.children[0]).toMatchObject({
      src: "https://cdn.example/a.png",
    });
    expect(rewritten.root.children[1]).toEqual({
      type: "gallery",
      images: [
        { src: `/api/media/${NEW_B}/raw?w=200` },
        { src: "https://elsewhere.example/c.png" },
      ],
    });
    expect(rewritten.root.children[2]).toEqual(body.root.children[2]);
  });
});

describe("JSON and block documents", () => {
  const fields = [
    f({ type: "json", name: "listed" }),
    f({ type: "json", name: "unlisted" }),
    f({ type: "json", name: "plain" }),
  ];
  const values = {
    listed: {
      formatVersion: 1,
      assets: { mediaIds: [A] },
      nodes: [{ id: NODE_ID, type: "image", props: { src: "/uploads/b.png" } }],
    },
    unlisted: {
      formatVersion: 1,
      nodes: [{ id: NODE_ID, type: "image", props: { mediaId: C } }],
    },
    plain: { font: { url: "/uploads/font.woff2" }, ids: [A] },
  };

  it("lists a block document's media list and node addresses, and other JSON's addresses", () => {
    expect(listContentReferences(fields, values)).toEqual([
      { kind: "link", fieldPath: "listed", collection: "media", id: A },
      { kind: "address", fieldPath: "listed", url: "/uploads/b.png" },
      // A node's own id is never taken for a media item's.
      {
        kind: "link",
        fieldPath: "unlisted",
        collection: "media",
        id: C,
        inferred: true,
      },
      { kind: "address", fieldPath: "plain", url: "/uploads/font.woff2" },
    ]);
  });

  it("rewrites them, leaving a plain JSON value's own ids alone", () => {
    const next = rewriteContentReferences(
      fields,
      values,
      mapOf(["media"], { "/uploads/b.png": "/files/b.png" })
    );
    expect(next).toEqual({
      listed: {
        formatVersion: 1,
        assets: { mediaIds: [NEW_A] },
        nodes: [{ id: NODE_ID, type: "image", props: { src: "/files/b.png" } }],
      },
      unlisted: {
        formatVersion: 1,
        nodes: [{ id: NODE_ID, type: "image", props: { mediaId: NEW_C } }],
      },
      plain: values.plain,
    });
  });
});

describe("groups and repeaters", () => {
  const fields = [
    f({
      type: "group",
      name: "hero",
      fields: [f({ type: "upload", name: "image" })],
    }),
    f({
      type: "repeater",
      name: "links",
      fields: [f({ type: "relationship", name: "page", relationTo: "pages" })],
    }),
    // A nameless group keeps its fields on the row that holds it.
    f({
      type: "group",
      fields: [
        f({ type: "relationship", name: "owner", relationTo: "people" }),
      ],
    }),
  ];
  const values = {
    hero: JSON.stringify({ image: A }),
    links: [
      { id: "row-1", page: B },
      { id: "row-2", page: C },
    ],
    owner: A,
  };

  it("lists the references inside them, by the path of field names", () => {
    expect(listContentReferences(fields, values)).toEqual([
      { kind: "link", fieldPath: "hero.image", collection: "media", id: A },
      { kind: "link", fieldPath: "links.page", collection: "pages", id: B },
      { kind: "link", fieldPath: "links.page", collection: "pages", id: C },
      { kind: "link", fieldPath: "owner", collection: "people", id: A },
    ]);
  });

  it("rewrites them, keeping each row's own id", () => {
    expect(
      rewriteContentReferences(
        fields,
        values,
        mapOf(["media", "pages", "people"])
      )
    ).toEqual({
      hero: JSON.stringify({ image: NEW_A }),
      links: [
        { id: "row-1", page: NEW_B },
        { id: "row-2", page: NEW_C },
      ],
      owner: NEW_A,
    });
  });
});

describe("field groups", () => {
  const schemas: FieldGroupSchemas = new Map([
    [
      "card",
      {
        fields: [
          f({ type: "upload", name: "image" }),
          f({ type: "fieldGroup", name: "cta", fieldGroup: "cta" }),
        ],
      },
    ],
    [
      "cta",
      {
        fields: [
          f({ type: "relationship", name: "page", relationTo: "pages" }),
        ],
      },
    ],
  ]);
  const fields = [
    f({ type: "component", name: "card", component: "card" }),
    f({ type: "fieldGroup", name: "zone", fieldGroups: ["card", "cta"] }),
  ];
  const values = {
    card: { image: A, cta: { page: B } },
    zone: [
      { [currentFieldGroupTypeKey]: "cta", page: C },
      // Written under the spelling before the storage migration.
      { _componentType: "card", image: B },
    ],
  };

  it("lists each instance's references by the schema it names, nested ones included", () => {
    expect(
      listContentReferences(fields, values, { fieldGroupSchemas: schemas })
    ).toEqual([
      { kind: "link", fieldPath: "card.image", collection: "media", id: A },
      { kind: "link", fieldPath: "card.cta.page", collection: "pages", id: B },
      { kind: "link", fieldPath: "zone.page", collection: "pages", id: C },
      { kind: "link", fieldPath: "zone.image", collection: "media", id: B },
    ]);
  });

  it("rewrites them", () => {
    expect(
      rewriteContentReferences(fields, values, mapOf(["media", "pages"]), {
        fieldGroupSchemas: schemas,
      })
    ).toEqual({
      card: { image: NEW_A, cta: { page: NEW_B } },
      zone: [
        { [currentFieldGroupTypeKey]: "cta", page: NEW_C },
        { _componentType: "card", image: NEW_B },
      ],
    });
  });

  // A version snapshot's fields arrive enriched with their schemas.
  it("reads a field enriched with its own schema when no map is given", () => {
    const enriched = [
      f({
        type: "component",
        name: "card",
        component: "card",
        componentFields: [f({ type: "upload", name: "image" })],
      }),
    ];
    expect(listContentReferences(enriched, { card: { image: A } })).toEqual([
      { kind: "link", fieldPath: "card.image", collection: "media", id: A },
    ]);
  });
});

describe("plugin field types", () => {
  const shapes: PluginReferenceShapes = new Map([
    [
      "productPicker",
      {
        visit: (value, at) => {
          if (typeof value !== "object" || value === null) return value;
          const { sku } = value as { sku?: unknown };
          if (typeof sku !== "string") return value;
          const next = at({ collection: "products", id: sku });
          return next === undefined ? value : { ...value, sku: next };
        },
      },
    ],
  ]);
  const fields = [
    f({ type: "productPicker", name: "product" }),
    f({ type: "mapPin", name: "pin" }),
  ];
  const values = {
    product: { sku: A },
    pin: { marker: { url: "/uploads/pin.svg" }, lat: 1 },
  };

  it("lists a declared type's references, and an undeclared type's addresses", () => {
    expect(
      listContentReferences(fields, values, { pluginShapes: shapes })
    ).toEqual([
      { kind: "link", fieldPath: "product", collection: "products", id: A },
      { kind: "address", fieldPath: "pin", url: "/uploads/pin.svg" },
    ]);
  });

  it("rewrites through the declared shape", () => {
    expect(
      rewriteContentReferences(
        fields,
        values,
        mapOf(["products"], { "/uploads/pin.svg": "/files/pin.svg" }),
        { pluginShapes: shapes }
      )
    ).toEqual({
      product: { sku: NEW_A },
      pin: { marker: { url: "/files/pin.svg" }, lat: 1 },
    });
  });
});

describe("what is not a reference", () => {
  it("reads nothing in a plain field, however id-like its value", () => {
    const fields = [
      f({ type: "text", name: "code" }),
      f({ type: "select", name: "choice", hasMany: true }),
      f({ type: "chips", name: "chips" }),
    ];
    expect(
      listContentReferences(fields, { code: A, choice: [B], chips: [C] })
    ).toEqual([]);
  });

  it("returns the very value it was given when the map moves nothing in it", () => {
    const fields = [
      f({ type: "relationship", name: "author", relationTo: "people" }),
      f({ type: "richText", name: "body" }),
    ];
    const values = {
      author: A,
      body: { root: { children: [{ src: "/uploads/a.png" }] } },
    };
    expect(rewriteContentReferences(fields, values, mapOf(["tags"]))).toBe(
      values
    );
  });
});
