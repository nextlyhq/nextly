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
 *   primitive; never a relation, a list, a container, rich text, a password
 *   or a field with a read rule. The timestamps follow, unless turned off.
 * - The route is contributed, authenticated, and answers the list envelope.
 */
import { describe, expect, it, vi } from "vitest";

import { LOOP_COLLECTIONS_ROUTE_PATH } from "./loop-collections-contract";
import {
  internalCollections,
  readLoopCollections,
  type LoopCollectionsReads,
} from "./loop-collections-route";
import { pageBuilder } from "./plugin";

function readsOf(
  records: readonly unknown[],
  {
    internal = [],
    readable,
  }: { internal?: readonly string[]; readable?: readonly string[] } = {}
): LoopCollectionsReads & { mayRead: ReturnType<typeof vi.fn> } {
  return {
    collections: async () => records,
    internal: () => new Set(internal),
    mayRead: vi.fn(async (slug: string) =>
      readable === undefined ? true : readable.includes(slug)
    ),
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
    { name: "internalScore", type: "number", access: { read: "admins" } },
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
  it("offers scalar top-level fields, a plugin type by its primitive, then the timestamps", async () => {
    const answer = await readLoopCollections(readsOf([POSTS]));
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
