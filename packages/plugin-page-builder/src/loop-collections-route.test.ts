/**
 * Which collections a collection list is offered, and which of their fields
 * and relations it may name.
 *
 * - Only a collection the caller may read; the plugin's own stores, a hidden
 *   collection and one whose schema is not live are never offered, while the
 *   plugin's Pages are.
 * - A collection is named by its plural name, then its name, then its slug,
 *   and one entry by its singular name.
 * - Fields: only the ones the PUBLIC may read, as a save judges a list, each
 *   with the kind the engine names for it; never one holding several values,
 *   rich text, a container or the id. In the collection's order, then the
 *   timestamps. A choice field carries its choices by name, an entry field
 *   its collection, a day field that it is a day.
 * - Relations: a to-many relation the public may read, to a listed
 *   collection.
 * - The route is contributed, authenticated, and answers the list envelope.
 */
import type { BindingFieldShape } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import { LOOP_COLLECTIONS_ROUTE_PATH } from "./loop-collections-contract";
import {
  internalCollections,
  readLoopCollections,
  type LoopCollectionsReads,
} from "./loop-collections-route";
import { pageBuilder } from "./plugin";

/** A declared field as the fixtures write it. */
interface FixtureField {
  readonly name?: unknown;
  readonly type?: string;
  readonly hasMany?: boolean;
  readonly relationTo?: string;
  readonly dateOnly?: boolean;
  readonly options?: ReadonlyArray<string | { readonly value: string }>;
}

/** The public's shape of one declared field, as `bindingFieldShapes` gives it. */
function shapeOf(field: FixtureField): BindingFieldShape {
  return {
    name: String(field.name),
    type: field.type ?? "text",
    ...(field.hasMany === true ? { hasMany: true } : {}),
    ...(field.relationTo === undefined ? {} : { relationTo: field.relationTo }),
    ...(field.options === undefined
      ? {}
      : {
          options: field.options.map(option =>
            typeof option === "string" ? option : option.value
          ),
        }),
    ...(field.dateOnly === true ? { dateOnly: true } : {}),
  };
}

/**
 * The public's shapes of each record's fields, as `bindingFieldShapes`
 * answers: every declared field but the ones named in `protectedFields`,
 * which a visitor may not read. A collection in `unreadable` has none.
 */
function publicShapesOf(
  records: readonly unknown[],
  protectedFields: readonly string[],
  unreadable: readonly string[]
) {
  return vi.fn(
    async (slug: string): Promise<readonly BindingFieldShape[] | undefined> => {
      if (unreadable.includes(slug)) return undefined;
      const record = records.find(
        each => (each as { slug?: unknown } | null)?.slug === slug
      ) as { fields?: readonly FixtureField[] } | undefined;
      return (record?.fields ?? [])
        .filter(
          field =>
            typeof field.name === "string" &&
            !protectedFields.includes(field.name)
        )
        .map(shapeOf);
    }
  );
}

function readsOf(
  records: readonly unknown[],
  {
    internal = [],
    readable,
    protectedFields = [],
    unreadable = [],
  }: {
    internal?: readonly string[];
    readable?: readonly string[];
    protectedFields?: readonly string[];
    unreadable?: readonly string[];
  } = {}
): LoopCollectionsReads & {
  mayRead: ReturnType<typeof vi.fn>;
  publicFields: ReturnType<typeof vi.fn>;
} {
  return {
    collections: async () => records,
    internal: () => new Set(internal),
    mayRead: vi.fn(async (slug: string) =>
      readable === undefined ? true : readable.includes(slug)
    ),
    publicFields: publicShapesOf(records, protectedFields, unreadable),
  };
}

const POSTS = {
  slug: "posts",
  label: "Post",
  labels: { singular: "Post", plural: "Blog posts" },
  migrationStatus: "synced",
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "publishedAt", type: "date", dateOnly: true },
    { name: "body", type: "richText" },
    { name: "author", type: "relationship", relationTo: "authors" },
    {
      name: "categories",
      type: "relationship",
      relationTo: "categories",
      hasMany: true,
    },
    {
      name: "reviewers",
      type: "relationship",
      relationTo: "categories",
      hasMany: true,
    },
    { name: "tags", type: "select", hasMany: true, options: ["a"] },
    {
      name: "kind",
      type: "select",
      options: [{ value: "news", label: "News" }, "guide"],
    },
    { name: "featured", type: "checkbox" },
    { name: "views", type: "number" },
    { name: "secret", type: "password" },
    { name: "seo", type: "group" },
    { name: "internalScore", type: "number" },
  ],
};

const CATEGORIES = {
  slug: "categories",
  label: "Category",
  fields: [{ name: "name", type: "text" }],
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

  it("names one entry by its singular name, then its name, then its slug", async () => {
    const answer = await readLoopCollections(
      readsOf([
        POSTS,
        { slug: "events", label: "Event", fields: [] },
        { slug: "faq", fields: [] },
      ])
    );
    expect(answer.items.map(item => item.singular)).toEqual([
      "Post",
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

describe("the fields a list may name", () => {
  it("offers the public's fields holding one scalar, in order, then the timestamps, each with its kind", async () => {
    // `internalScore` is declared but withheld from the public, so a list
    // may not name it: the entries shown would reveal its values.
    const answer = await readLoopCollections(
      readsOf([POSTS], { protectedFields: ["internalScore"] })
    );
    expect(
      answer.items[0]?.fields.map(field => [
        field.name,
        field.label,
        field.kind,
      ])
    ).toEqual([
      ["title", "Title", "text"],
      ["publishedAt", "Published At", "date"],
      ["author", "Author", "entry"],
      ["kind", "Kind", "choice"],
      ["featured", "Featured", "boolean"],
      ["views", "Views", "number"],
      ["createdAt", "Created", "date"],
      ["updatedAt", "Updated", "date"],
    ]);
  });

  it("names a choice field's choices as declared, an entry field's collection and a day field", async () => {
    const answer = await readLoopCollections(readsOf([POSTS]));
    const fields = new Map(
      (answer.items[0]?.fields ?? []).map(field => [field.name, field])
    );
    expect(fields.get("kind")?.options).toEqual([
      { value: "news", label: "News" },
      { value: "guide", label: "guide" },
    ]);
    expect(fields.get("author")?.relationTo).toBe("authors");
    expect(fields.get("publishedAt")?.dateOnly).toBe(true);
    expect(fields.get("title")).toStrictEqual({
      name: "title",
      label: "Title",
      kind: "text",
    });
  });

  it("sends every field the public may read, as the save judges a list against them", async () => {
    const answer = await readLoopCollections(
      readsOf([POSTS], { protectedFields: ["internalScore"] })
    );
    const readable = answer.items[0]?.readable ?? [];
    const names = readable.map(field => field.name);
    // Rich text and a has-many relation are not offered, and are readable.
    expect(names).toEqual(expect.arrayContaining(["id", "body", "categories"]));
    expect(names).not.toContain("internalScore");
    expect(readable.find(field => field.name === "categories")).toEqual({
      name: "categories",
      type: "relationship",
      hasMany: true,
      relationTo: "categories",
    });
  });

  it("asks which fields the public may read in the language asked, as a save does", async () => {
    const reads = readsOf([POSTS]);
    await readLoopCollections(reads, "fr");
    expect(reads.publicFields).toHaveBeenCalledWith("posts", "fr");
  });

  it("offers no field of a collection the public may read none of", async () => {
    const answer = await readLoopCollections(
      readsOf([POSTS], { unreadable: ["posts"] })
    );
    expect(answer.items.map(item => item.slug)).toEqual(["posts"]);
    expect(answer.items[0]?.fields).toEqual([]);
    expect(answer.items[0]?.relations).toEqual([]);
    // Its names still travel, so a stored filter is told apart as hidden.
    expect(answer.items[0]?.declared).toContain("title");
  });

  it("offers no timestamps where the collection turned them off", async () => {
    const answer = await readLoopCollections(
      readsOf([{ ...POSTS, timestamps: false }])
    );
    const names = answer.items[0]?.fields.map(field => field.name);
    expect(names).not.toContain("createdAt");
    expect(names).toContain("title");
  });

  it("names a field with a blank label in words", async () => {
    const answer = await readLoopCollections(
      readsOf([
        {
          slug: "notes",
          timestamps: false,
          fields: [{ name: "shortName", type: "text", label: "  " }],
        },
      ])
    );
    expect(answer.items[0]?.fields.map(field => field.label)).toEqual([
      "Short Name",
    ]);
  });
});

describe("the relations a related list may show", () => {
  it("offers a to-many relation the public may read, to a listed collection", async () => {
    const answer = await readLoopCollections(
      readsOf([POSTS, CATEGORIES], { protectedFields: ["reviewers"] })
    );
    expect(answer.items[0]?.relations).toEqual([
      { field: "categories", label: "Categories", collection: "categories" },
    ]);
  });

  it("leaves out a relation to a collection the caller may not read", async () => {
    const answer = await readLoopCollections(
      readsOf([POSTS, CATEGORIES], { readable: ["posts"] })
    );
    expect(answer.items[0]?.relations).toEqual([]);
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
