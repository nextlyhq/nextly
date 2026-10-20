/**
 * Reading what a document links to from its stored shape, through the walk
 * the version preview uses.
 *
 * The shapes are the ones a stored document and a working draft's snapshot
 * hold: a bare id, a list of ids, a `{ relationTo, value }` pair, and those
 * inside groups, repeaters and components, on dialects that hand JSON back
 * as text too.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { linksInDocument } from "../release-links";

const FIELDS = [
  { name: "title", type: "text" },
  { name: "author", type: "relationship", relationTo: "authors" },
  { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
  { name: "either", type: "relationship", relationTo: ["authors", "tags"] },
  { name: "cover", type: "upload", relationTo: "media" },
  {
    name: "meta",
    type: "group",
    fields: [{ name: "editor", type: "relationship", relationTo: "authors" }],
  },
  {
    name: "credits",
    type: "repeater",
    fields: [{ name: "who", type: "relationship", relationTo: "authors" }],
  },
  {
    name: "blocks",
    type: "component",
    componentSchemas: {
      quote: {
        fields: [
          { name: "cite", type: "relationship", relationTo: "authors" },
          {
            name: "guarded",
            type: "relationship",
            relationTo: "authors",
            access: { read: () => false },
          },
        ],
      },
    },
  },
] as unknown as FieldConfig[];

describe("linksInDocument", () => {
  it("reads every relationship and upload, at any nesting, by field path", () => {
    expect(
      linksInDocument(FIELDS, {
        title: "Hello",
        author: "a1",
        tags: ["t1", "t2"],
        either: { relationTo: "tags", value: "t3" },
        cover: "m1",
        meta: { editor: "a2" },
        credits: [{ who: "a3" }, { who: "a4" }],
        blocks: [{ _componentType: "quote", cite: "a5", guarded: "a6" }],
      })
    ).toEqual([
      { field: "author", collection: "authors", entryId: "a1" },
      { field: "tags", collection: "tags", entryId: "t1" },
      { field: "tags", collection: "tags", entryId: "t2" },
      { field: "either", collection: "tags", entryId: "t3" },
      // Read like any link: the media library is judged, and dropped, later.
      { field: "cover", collection: "media", entryId: "m1" },
      { field: "meta.editor", collection: "authors", entryId: "a2" },
      { field: "credits.who", collection: "authors", entryId: "a3" },
      { field: "credits.who", collection: "authors", entryId: "a4" },
      { field: "blocks.cite", collection: "authors", entryId: "a5" },
      // A protected field inside a component is still a link; who may be
      // told of it is the reader's question.
      { field: "blocks.guarded", collection: "authors", entryId: "a6" },
    ]);
  });

  it("reads groups and repeaters a dialect returned as JSON text", () => {
    expect(
      linksInDocument(FIELDS, {
        meta: JSON.stringify({ editor: "a2" }),
        credits: JSON.stringify([{ who: "a3" }]),
      })
    ).toEqual([
      { field: "meta.editor", collection: "authors", entryId: "a2" },
      { field: "credits.who", collection: "authors", entryId: "a3" },
    ]);
  });

  it("names nothing for empty values, and leaves the document as it was", () => {
    const data = { author: null, tags: [], meta: JSON.stringify({}) };
    expect(linksInDocument(FIELDS, data)).toEqual([]);
    // The walk normalises what it reads in place; it reads a copy.
    expect(data.meta).toBe("{}");
  });

  it("drops a pair naming a collection the field does not declare", () => {
    expect(
      linksInDocument(FIELDS, {
        either: { relationTo: "secrets", value: "s1" },
      })
    ).toEqual([]);
  });
});
