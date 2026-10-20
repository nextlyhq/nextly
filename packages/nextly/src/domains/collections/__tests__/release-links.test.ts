/**
 * Reading what a document links to from its stored shape.
 *
 * The shapes are the ones a depth-0 read and a working draft's snapshot hold:
 * a bare id, a list of ids, a `{ relationTo, value }` pair, and those inside
 * groups and repeaters, on dialects that hand JSON back as text too.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

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
] as unknown as FieldDefinition[];

describe("linksInDocument", () => {
  it("reads every relationship shape, nested ones included, by field path", () => {
    expect(
      linksInDocument(FIELDS, {
        title: "Hello",
        author: "a1",
        tags: ["t1", "t2"],
        either: { relationTo: "tags", value: "t3" },
        cover: "m1",
        meta: { editor: "a2" },
        credits: [{ who: "a3" }, { who: "a4" }],
      })
    ).toEqual([
      { field: "author", collection: "authors", entryId: "a1" },
      { field: "tags", collection: "tags", entryId: "t1" },
      { field: "tags", collection: "tags", entryId: "t2" },
      { field: "either", collection: "tags", entryId: "t3" },
      { field: "meta.editor", collection: "authors", entryId: "a2" },
      { field: "credits.who", collection: "authors", entryId: "a3" },
      { field: "credits.who", collection: "authors", entryId: "a4" },
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

  it("never reads an upload, and names nothing for empty values", () => {
    expect(
      linksInDocument(FIELDS, {
        author: null,
        tags: [],
        cover: "m1",
        meta: null,
      })
    ).toEqual([]);
  });

  it("drops a pair naming a collection the field does not declare", () => {
    expect(
      linksInDocument(FIELDS, {
        either: { relationTo: "secrets", value: "s1" },
      })
    ).toEqual([]);
  });
});
