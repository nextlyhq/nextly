/**
 * Reading what a document links to from its stored shape, through the walk
 * the version preview uses.
 *
 * The shapes are the ones a stored document and a working draft's snapshot
 * hold: a bare id, a list of ids, a `{ relationTo, value }` pair, and those
 * inside groups, repeaters and components, on dialects that hand JSON back
 * as text too.
 */
import { describe, expect, it, vi } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";

const { releaseGoingLiveDocuments } = vi.hoisted(() => ({
  releaseGoingLiveDocuments: vi.fn(),
}));

// The container the link reads resolve their services from: one collection,
// `posts`, whose documents each link to the author named in their id.
vi.mock("../../../di/container", () => ({
  container: {
    has: (name: string) =>
      name === "collectionRegistryService" || name === "collectionsHandler",
    get: (name: string) =>
      name === "collectionRegistryService"
        ? {
            getCollectionBySlug: async () => ({
              slug: "posts",
              fields: [
                { name: "author", type: "relationship", relationTo: "authors" },
              ],
            }),
          }
        : { releaseGoingLiveDocuments },
  },
}));

import { linksInDocument, releaseLinkReads } from "../release-links";

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
          { name: "author", type: "relationship", relationTo: "authors" },
        ],
      },
      aside: {
        fields: [
          { name: "author", type: "relationship", relationTo: "authors" },
        ],
      },
    },
  },
] as unknown as FieldConfig[];

/** The links, without their keys, for cases about what is found. */
function found(data: Record<string, unknown>) {
  return linksInDocument(FIELDS, data).links.map(
    ({ field, collection, entryId }) => ({ field, collection, entryId })
  );
}

describe("linksInDocument", () => {
  it("reads every relationship and upload, at any nesting, by field path", () => {
    expect(
      found({
        title: "Hello",
        author: "a1",
        tags: ["t1", "t2"],
        either: { relationTo: "tags", value: "t3" },
        cover: "m1",
        meta: { editor: "a2" },
        credits: [{ who: "a3" }, { who: "a4" }],
        blocks: [{ _componentType: "quote", author: "a5" }],
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
      { field: "blocks.author", collection: "authors", entryId: "a5" },
    ]);
  });

  it("keys two fields that share a path apart, and each repeater row apart", () => {
    const { links } = linksInDocument(FIELDS, {
      blocks: [
        { _componentType: "quote", author: "a1" },
        { _componentType: "aside", author: "a2" },
      ],
      credits: [{ who: "a3" }, { who: "a4" }],
    });
    const keyOf = (id: string) =>
      links.find(link => link.entryId === id)?.fieldKey;
    expect(links.map(link => link.field)).toEqual([
      "credits.who",
      "credits.who",
      "blocks.author",
      "blocks.author",
    ]);
    expect(new Set(["a1", "a2", "a3", "a4"].map(keyOf)).size).toBe(4);
  });

  it("reads groups and repeaters a dialect returned as JSON text", () => {
    expect(
      found({
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
    expect(found(data)).toEqual([]);
    // The walk normalises what it reads in place; it reads a copy.
    expect(data.meta).toBe("{}");
  });

  it("drops a pair naming a collection the field does not declare", () => {
    expect(
      found({
        either: { relationTo: "secrets", value: "s1" },
      })
    ).toEqual([]);
  });
});

describe("releaseLinkReads", () => {
  it("reads more documents of one scope than one statement may bind, in runs", async () => {
    releaseGoingLiveDocuments.mockImplementation(
      async ({ entryIds }: { entryIds: readonly string[] }) => {
        // SQLite's default limit on one statement's parameters.
        if (entryIds.length > 999) throw new Error("too many SQL variables");
        return new Map(entryIds.map(id => [id, { id, author: `a-${id}` }]));
      }
    );
    const ids = Array.from({ length: 1200 }, (_, i) => `p${i}`);
    const scanned = await releaseLinkReads({} as never).linksOf(
      { scopeKind: "collection", scopeSlug: "posts" },
      ids
    );
    expect(scanned.size).toBe(1200);
    expect(scanned.get("p1199")?.links.map(link => link.entryId)).toEqual([
      "a-p1199",
    ]);
    expect(
      releaseGoingLiveDocuments.mock.calls.map(
        call => (call[0] as { entryIds: string[] }).entryIds.length
      )
    ).toEqual([500, 500, 200]);
  });
});
