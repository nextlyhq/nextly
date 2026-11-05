/**
 * Which collections a collection loop is offered, and which of their fields it
 * may sort by.
 *
 * - Only a collection the caller may read; the plugin's own stores, a hidden
 *   collection and one whose schema is not live are never offered, while the
 *   plugin's Pages are.
 * - A collection is named by its plural name, then its name, then its slug.
 * - Sortable: a top-level field holding one scalar value, judged by the
 *   engine's binding vocabulary, including a plugin type by its storage
 *   primitive; never a relation, a list, a container, rich text or a
 *   password. The timestamps follow, unless turned off. Of those, only the
 *   keys core accepts for this caller, asked by one sorted read: a field
 *   whose read rule the records do not carry is still left out.
 * - The route is contributed, authenticated, and answers the list envelope.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { LOOP_COLLECTIONS_ROUTE_PATH } from "./loop-collections-contract";
import {
  internalCollections,
  readLoopCollections,
  sortableKeys,
  type LoopCollectionsReads,
} from "./loop-collections-route";
import { pageBuilder } from "./plugin";

/** Core's refusal of a sort, naming each key, as a sorted read throws it. */
function sortRefusal(keys: readonly string[]): NextlyError {
  return NextlyError.validation({
    errors: keys.map(key => ({
      path: `sort.${key}`,
      code: "FIELD_NOT_SORTABLE",
      message: `"${key}" is not a field this list can be sorted by.`,
    })),
  });
}

/**
 * A sorted read that refuses, as core does, every asked key in `refused`,
 * one stage per entry in the order core checks them.
 */
function sortedReadRefusing(stages: ReadonlyArray<readonly string[]> = []) {
  return vi.fn(async (_slug: string, keys: readonly string[]) => {
    for (const stage of stages) {
      const named = keys.filter(key => stage.includes(key));
      if (named.length > 0) throw sortRefusal(named);
    }
  });
}

function readsOf(
  records: readonly unknown[],
  {
    internal = [],
    readable,
    refused,
  }: {
    internal?: readonly string[];
    readable?: readonly string[];
    refused?: ReadonlyArray<readonly string[]>;
  } = {}
): LoopCollectionsReads & {
  mayRead: ReturnType<typeof vi.fn>;
  sortedRead: ReturnType<typeof vi.fn>;
} {
  return {
    collections: async () => records,
    internal: () => new Set(internal),
    mayRead: vi.fn(async (slug: string) =>
      readable === undefined ? true : readable.includes(slug)
    ),
    sortedRead: sortedReadRefusing(refused),
  };
}

const POSTS = {
  slug: "posts",
  label: "Post",
  labels: { plural: "Blog posts" },
  migrationStatus: "synced",
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "publishedAt", type: "date" },
    { name: "body", type: "richText" },
    { name: "author", type: "relationship" },
    { name: "tags", type: "select", hasMany: true },
    { name: "kind", type: "select" },
    { name: "featured", type: "checkbox" },
    { name: "views", type: "number" },
    { name: "secret", type: "password" },
    { name: "seo", type: "group" },
    { name: "internalScore", type: "number" },
    { name: "rating", type: "acme-stars", storage: "number" },
    { name: "widget", type: "acme-widget" },
  ],
};

describe("the collections a loop is offered", () => {
  it("lists only the collections the caller may read", async () => {
    const reads = readsOf(
      [POSTS, { slug: "orders", label: "Order", fields: [] }],
      { readable: ["posts"] }
    );
    const answer = await readLoopCollections(reads);
    expect(answer.items.map(item => item.slug)).toEqual(["posts"]);
    // Asked of each, so a refusal is the caller's, not a guess.
    expect(reads.mayRead.mock.calls.map(call => call[0])).toEqual([
      "posts",
      "orders",
    ]);
  });

  it("leaves out the plugin's own stores, hidden collections and ones not live yet", async () => {
    const answer = await readLoopCollections(
      readsOf(
        [
          POSTS,
          { slug: "patterns", fields: [] },
          { slug: "pages", fields: [] },
          { slug: "audit", admin: { hidden: true }, fields: [] },
          { slug: "drafts", migrationStatus: "pending", fields: [] },
        ],
        { internal: ["patterns"] }
      )
    );
    expect(answer.items.map(item => item.slug)).toEqual(["posts", "pages"]);
  });

  it("asks nothing about a collection it would never list", async () => {
    const reads = readsOf(
      [
        { slug: "patterns", fields: [] },
        { slug: "audit", admin: { hidden: true }, fields: [] },
      ],
      { internal: ["patterns"] }
    );
    await readLoopCollections(reads);
    expect(reads.mayRead).not.toHaveBeenCalled();
  });

  it("names a collection by its plural name, then its name, then its slug", async () => {
    const answer = await readLoopCollections(
      readsOf([
        POSTS,
        { slug: "events", label: "Event", fields: [] },
        { slug: "faq", fields: [] },
      ])
    );
    expect(answer.items.map(item => item.label)).toEqual([
      "Blog posts",
      "Event",
      "faq",
    ]);
  });

  it("answers the list envelope, every collection on one page", async () => {
    const answer = await readLoopCollections(readsOf([POSTS]));
    expect(answer.meta).toMatchObject({
      total: 1,
      page: 1,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  });
});

describe("the fields a loop may sort by", () => {
  it("offers scalar top-level fields, a plugin type by its primitive, then the timestamps, as core accepts them", async () => {
    // `internalScore` carries a read rule this caller fails; a code-first
    // rule is a function the records never hold, so only core can say.
    const answer = await readLoopCollections(
      readsOf([POSTS], { refused: [["internalScore"]] })
    );
    expect(answer.items[0]?.sortFields).toEqual([
      { name: "title", label: "Title", date: false },
      { name: "publishedAt", label: "Published At", date: true },
      { name: "kind", label: "Kind", date: false },
      { name: "featured", label: "Featured", date: false },
      { name: "views", label: "Views", date: false },
      { name: "rating", label: "Rating", date: false },
      { name: "createdAt", label: "Created", date: true },
      { name: "updatedAt", label: "Updated", date: true },
    ]);
  });

  it("leaves out a field it cannot name or order, and names one with a blank label in words", async () => {
    const answer = await readLoopCollections(
      readsOf([
        {
          slug: "notes",
          timestamps: false,
          fields: [
            null,
            "title",
            { type: "text" },
            { name: "", type: "text" },
            { name: "untyped" },
            { name: "codes", type: "text", hasMany: true },
            { name: "score", type: "acme-score", storage: "unknown" },
            { name: "weight", type: "acme-weight", storage: "number" },
            { name: "shortName", type: "text", label: "  " },
          ],
        },
      ])
    );
    expect(answer.items[0]?.sortFields).toStrictEqual([
      { name: "weight", label: "Weight", date: false },
      { name: "shortName", label: "Short Name", date: false },
    ]);
  });

  it("offers no timestamps where the collection turned them off", async () => {
    const answer = await readLoopCollections(
      readsOf([{ ...POSTS, timestamps: false }])
    );
    const names = answer.items[0]?.sortFields.map(field => field.name);
    expect(names).not.toContain("createdAt");
    expect(names).toContain("title");
  });

  it("lists a declared timestamp once, as the collection declares it", async () => {
    const answer = await readLoopCollections(
      readsOf([
        {
          slug: "notes",
          fields: [{ name: "createdAt", type: "date", label: "Written" }],
        },
      ])
    );
    expect(answer.items[0]?.sortFields).toEqual([
      { name: "createdAt", label: "Written", date: true },
      { name: "updatedAt", label: "Updated", date: true },
    ]);
  });
});

describe("asking core which keys this caller may sort by", () => {
  it("asks once with every key where core accepts them all", async () => {
    const reads = { sortedRead: sortedReadRefusing() };
    expect([...(await sortableKeys("posts", ["a", "b"], reads))]).toEqual([
      "a",
      "b",
    ]);
    expect(reads.sortedRead).toHaveBeenCalledTimes(1);
    expect(reads.sortedRead).toHaveBeenCalledWith("posts", ["a", "b"]);
  });

  it("asks again without each key core names, stage by stage", async () => {
    const reads = { sortedRead: sortedReadRefusing([["b"], ["c"]]) };
    expect([
      ...(await sortableKeys("posts", ["a", "b", "c", "d"], reads)),
    ]).toEqual(["a", "d"]);
    expect(reads.sortedRead.mock.calls.map(call => call[1])).toEqual([
      ["a", "b", "c", "d"],
      ["a", "c", "d"],
      ["a", "d"],
    ]);
  });

  it("offers nothing for a failure that is not a sort refusal", async () => {
    const reads = {
      sortedRead: vi.fn(async () => {
        throw NextlyError.forbidden();
      }),
    };
    expect([...(await sortableKeys("posts", ["a"], reads))]).toEqual([]);
  });

  it("reads a refusal naming anything but sort keys as a failure, offering nothing", async () => {
    // A validation error that also names a filter is not core saying which
    // keys it will not sort by, so no key is taken from it.
    const reads = {
      sortedRead: vi.fn(async () => {
        throw NextlyError.validation({
          errors: [
            { path: "sort.a", code: "FIELD_NOT_SORTABLE", message: "No." },
            { path: "where.b", code: "FIELD_NOT_FILTERABLE", message: "No." },
          ],
        });
      }),
    };
    expect([...(await sortableKeys("posts", ["a", "c"], reads))]).toEqual([]);
    expect(reads.sortedRead).toHaveBeenCalledTimes(1);
  });

  it("stops at a refusal naming no key it asked, rather than asking forever", async () => {
    const reads = {
      sortedRead: vi.fn(async () => {
        throw sortRefusal(["elsewhere"]);
      }),
    };
    expect([...(await sortableKeys("posts", ["a"], reads))]).toEqual([]);
    expect(reads.sortedRead).toHaveBeenCalledTimes(1);
  });

  it("asks nothing for a collection with no candidate field", async () => {
    const reads = { sortedRead: sortedReadRefusing() };
    expect([...(await sortableKeys("posts", [], reads))]).toEqual([]);
    expect(reads.sortedRead).not.toHaveBeenCalled();
  });
});

describe("the plugin's own collections", () => {
  it("are every one it declares, as renamed, but its Pages, and a store the host named", () => {
    const internal = internalCollections(
      {
        self: {
          collections: {
            pages: "site_pages",
            patterns: "patterns",
            layouts: "site_layouts",
          },
        },
      },
      { collection: "host_components", field: "document" }
    );
    expect([...internal].sort()).toEqual([
      "host_components",
      "patterns",
      "site_layouts",
    ]);
  });
});

describe("the route", () => {
  const route = (pageBuilder().contributes?.routes ?? []).find(
    each => each.path === LOOP_COLLECTIONS_ROUTE_PATH
  );

  it("is mounted at the path the client asks", () => {
    expect(route?.method).toBe("GET");
  });

  it("is not public", () => {
    // Authenticated unless it opts out: which collections exist, and their
    // fields, are not for anonymous callers.
    expect(route).toBeDefined();
    expect(route?.public).not.toBe(true);
  });
});
