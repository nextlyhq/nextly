/**
 * A list's batched expansion gives each document exactly what the read by id
 * gives it, at every depth, and stays batched while doing so.
 *
 * The batched path fetched each relationship's rows and expanded the parent's
 * own uploads, and stopped there: a related row came back with its own upload
 * (an author's avatar) and its own relationships as bare ids at any depth,
 * where the read by id recursed into the row with the depth remaining. The
 * single-entry expansion is the oracle here, run over the same stored rows.
 *
 * The rows come from stubs of the two fetch seams, one per path, so the
 * comparison is of the expansion logic alone; the integration suite
 * (`list-expands-related-uploads.integration.test.ts`) runs the same question
 * against a real database, with access and the REST route.
 */
import { describe, expect, it, vi } from "vitest";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { TRUSTS_EVERY_COLLECTION } from "../../../../services/collections/trust-grant";
import { CollectionRelationshipService } from "../collection-relationship-service";

const ORG_FIELDS: FieldDefinition[] = [
  { name: "name", type: "text" },
  { name: "logo", type: "upload", relationTo: "media" },
];

function authorFields(orgMaxDepth?: number): FieldDefinition[] {
  return [
    { name: "name", type: "text" },
    { name: "avatar", type: "upload", relationTo: "media" },
    {
      name: "org",
      type: "relationship",
      relationTo: "orgs",
      ...(orgMaxDepth === undefined ? {} : { maxDepth: orgMaxDepth }),
    },
    // Never set: an unset to-many value on a related row.
    {
      name: "mentors",
      type: "relationship",
      relationTo: "authors",
      hasMany: true,
    },
  ];
}

/** Every relationship shape a post can hold, and an upload of its own. */
const POST_FIELDS: FieldDefinition[] = [
  { name: "title", type: "text" },
  { name: "hero", type: "upload", relationTo: "media" },
  { name: "byline", type: "relationship", relationTo: "authors" },
  {
    name: "contributors",
    type: "relationship",
    relationTo: "authors",
    hasMany: true,
  },
  {
    name: "featured",
    type: "relationship",
    relationTo: ["authors", "orgs"],
  },
  {
    name: "credits",
    type: "repeater",
    fields: [
      { name: "role", type: "text" },
      { name: "person", type: "relationship", relationTo: "authors" },
      // Never set: an unset to-many value inside a repeater row.
      {
        name: "also",
        type: "relationship",
        relationTo: "authors",
        hasMany: true,
      },
    ],
  },
];

const POST_COUNT = 10;
const ids = (prefix: string): string[] =>
  Array.from({ length: POST_COUNT }, (_, i) => `${prefix}${i + 1}`);

/**
 * The stored rows, by collection. Every post has its OWN author and its own
 * media, so a fetch made per row would show up as a count that grows with the
 * page; a shared author would hide it behind the batch's id dedupe.
 */
function storedRows(): Record<string, Record<string, Record<string, unknown>>> {
  const media: Record<string, Record<string, unknown>> = {};
  const authors: Record<string, Record<string, unknown>> = {};
  const posts: Record<string, Record<string, unknown>> = {};
  const orgs: Record<string, Record<string, unknown>> = {
    o1: { id: "o1", name: "Acme", logo: "m-o1" },
  };
  media["m-o1"] = { id: "m-o1", filename: "acme.png" };
  for (const [index, id] of ids("p").entries()) {
    const author = `a${index + 1}`;
    const credit = `c${index + 1}`;
    for (const person of [author, credit]) {
      authors[person] = {
        id: person,
        name: `Author ${person}`,
        avatar: `m-${person}`,
        org: "o1",
        mentors: null,
      };
      media[`m-${person}`] = { id: `m-${person}`, filename: `${person}.png` };
    }
    media[`m-${id}`] = { id: `m-${id}`, filename: `${id}.png` };
    posts[id] = {
      id,
      title: `Post ${id}`,
      hero: `m-${id}`,
      byline: author,
      contributors: [author, credit],
      featured: { relationTo: "orgs", value: "o1" },
      credits: [
        { id: `row-${id}`, role: "editor", person: credit, also: null },
      ],
    };
  }
  return { media, authors, posts, orgs };
}

const silent = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as never;

/** The private media read, named so it can be watched. */
interface MediaRead {
  fetchMediaByIds(ids: string[]): Promise<Record<string, unknown>[]>;
}

/**
 * A service reading the stored rows through stubs of its fetch seams: the
 * batched fetch the list path uses, the per-row fetch the read by id uses, the
 * media read both use, and the collection registry.
 */
function serviceOver(orgMaxDepth?: number) {
  const db = storedRows();
  const fields: Record<string, FieldDefinition[]> = {
    authors: authorFields(orgMaxDepth),
    orgs: ORG_FIELDS,
    posts: POST_FIELDS,
  };
  const collections = {
    getCollection: (slug: string) => Promise.resolve({ fields: fields[slug] }),
  };
  const service = new CollectionRelationshipService(
    {
      getDrizzle: () => ({}),
      getCapabilities: () => ({ dialect: "sqlite" }),
    } as never,
    silent,
    {} as never,
    collections as never
  );
  const row = (collection: string, id: string) => {
    const stored = db[collection]?.[id];
    return stored ? structuredClone(stored) : undefined;
  };

  vi.spyOn(service, "getBestLabelField").mockResolvedValue("name");
  const batchFetch = vi
    .spyOn(service, "batchFetchRelatedEntries")
    .mockImplementation((collection, relatedIds) => {
      const found = new Map<string, Record<string, unknown>>();
      for (const id of relatedIds) {
        const stored = row(collection, id);
        // Labelled as the real fetch labels a row.
        if (stored) found.set(id, { ...stored, label: stored.name ?? id });
      }
      return Promise.resolve(found);
    });
  const singleFetch = vi
    .spyOn(service, "fetchRelatedEntry")
    .mockImplementation((collection, id) =>
      Promise.resolve(row(collection, id) ?? null)
    );
  const mediaFetch = vi
    .spyOn(service as unknown as MediaRead, "fetchMediaByIds")
    .mockImplementation(mediaIds =>
      Promise.resolve(
        mediaIds.flatMap(id => {
          const stored = row("media", id);
          return stored ? [stored] : [];
        })
      )
    );
  const posts = ids("p").flatMap(id => {
    const post = row("posts", id);
    return post ? [post] : [];
  });
  return { service, posts, batchFetch, singleFetch, mediaFetch };
}

const TRUSTED = { overrideAccess: true, trusted: TRUSTS_EVERY_COLLECTION };

describe("batched expansion matches the read by id", () => {
  for (const depth of [0, 1, 2, 3]) {
    it(`gives a listed post what its read by id gives, at depth ${depth}`, async () => {
      const { service, posts } = serviceOver();
      const [listed] = await service.batchExpandRelationships(
        [posts[0]],
        "posts",
        POST_FIELDS,
        { depth, ...TRUSTED }
      );
      const byId = await service.expandRelationships(
        posts[0],
        "posts",
        POST_FIELDS,
        { depth, ...TRUSTED }
      );
      expect(listed).toEqual(byId);
    });
  }

  it("expands a related row's upload exactly where the read by id does", async () => {
    // The parity above, stated as the values it compares, so a parity reached
    // by both paths leaving everything as ids cannot pass for it.
    const { service, posts } = serviceOver();
    const at = async (depth: number) =>
      (
        await service.batchExpandRelationships(
          [posts[0]],
          "posts",
          POST_FIELDS,
          { depth, ...TRUSTED }
        )
      )[0] as Record<string, Record<string, unknown>>;

    // Depth 1 populates the author and leaves its own upload as stored.
    expect((await at(1)).byline.avatar).toBe("m-a1");
    // Depth 2 reaches the author's own upload and relationship, and stops
    // there: the org's upload stays an id.
    const two = await at(2);
    expect(two.byline.avatar).toMatchObject({ id: "m-a1" });
    expect(two.byline.org).toMatchObject({ id: "o1", logo: "m-o1" });
    // Depth 3 reaches the org's upload too.
    const three = await at(3);
    expect(three.byline.org).toMatchObject({ logo: { id: "m-o1" } });
    // The other shapes go as deep: a to-many, a polymorphic pair and a
    // repeater row.
    const contributors = (three as Record<string, unknown>)
      .contributors as Array<Record<string, unknown>>;
    expect(contributors[1].avatar).toMatchObject({ id: "m-c1" });
    expect(three.featured).toMatchObject({
      relationTo: "orgs",
      value: { logo: { id: "m-o1" } },
    });
    const credits = (three as Record<string, unknown>).credits as Array<
      Record<string, Record<string, unknown>>
    >;
    expect(credits[0].person.avatar).toMatchObject({ id: "m-c1" });
  });

  it("keeps an unset to-many value of a related row or a repeater row as stored", async () => {
    // Below the document itself a list gives an unset to-many value as stored,
    // as the read by id does (the parity above covers it); stated here so a
    // parity reached by both giving an empty list cannot pass for it.
    const { service, posts } = serviceOver();
    const [listed] = await service.batchExpandRelationships(
      [posts[0]],
      "posts",
      POST_FIELDS,
      { depth: 2, ...TRUSTED }
    );
    const doc = listed as Record<string, unknown>;
    expect((doc.byline as Record<string, unknown>).mentors).toBeNull();
    const credits = doc.credits as Array<Record<string, unknown>>;
    expect(credits[0].also).toBeNull();
  });

  it("gives a document's own unset to-many value as an empty list, where the read by id gives null", async () => {
    // The one known difference, kept on purpose: a list has always given a
    // document's own unset to-many field as `[]`, and list callers map over
    // it, so the batch path's default keeps that shape. Everything else about
    // the document still matches the read by id.
    const { service, posts } = serviceOver();
    const bare = { ...posts[0], contributors: null };
    for (const depth of [1, 2, 3]) {
      const [listed] = await service.batchExpandRelationships(
        [bare],
        "posts",
        POST_FIELDS,
        { depth, ...TRUSTED }
      );
      const byId = await service.expandRelationships(
        bare,
        "posts",
        POST_FIELDS,
        { depth, ...TRUSTED }
      );
      expect(listed.contributors).toEqual([]);
      expect(byId.contributors).toBeNull();
      expect({ ...listed, contributors: null }).toEqual(byId);
    }
    // At depth 0 nothing is populated, and both give the value as stored.
    const [unexpanded] = await service.batchExpandRelationships(
      [bare],
      "posts",
      POST_FIELDS,
      { depth: 0, ...TRUSTED }
    );
    expect(unexpanded.contributors).toBeNull();
  });

  it("honours a field's maxDepth one hop down, as the read by id does", async () => {
    // `org` may be populated only from the document itself, so on an author
    // reached one hop in it stays an id however deep the read asks.
    const { service, posts } = serviceOver(1);
    const [listed] = await service.batchExpandRelationships(
      [posts[0]],
      "posts",
      POST_FIELDS,
      { depth: 3, ...TRUSTED }
    );
    const byId = await service.expandRelationships(
      posts[0],
      "posts",
      POST_FIELDS,
      { depth: 3, ...TRUSTED }
    );
    expect(listed).toEqual(byId);
    const byline = (listed as Record<string, Record<string, unknown>>).byline;
    expect(byline.org).toBe("o1");
    // While its own upload is still reached.
    expect(byline.avatar).toMatchObject({ id: "m-a1" });
  });

  it("gives every post of a page what its own read by id gives", async () => {
    const { service, posts } = serviceOver();
    const listed = await service.batchExpandRelationships(
      posts,
      "posts",
      POST_FIELDS,
      { depth: 3, ...TRUSTED }
    );
    for (const [index, post] of posts.entries()) {
      expect(listed[index]).toEqual(
        await service.expandRelationships(post, "posts", POST_FIELDS, {
          depth: 3,
          ...TRUSTED,
        })
      );
    }
  });
});

describe("batched expansion stays batched at depth", () => {
  /** The reads one list expansion makes, by kind and target collection. */
  async function readsFor(pageSize: number): Promise<Record<string, number>> {
    const { service, posts, batchFetch, singleFetch, mediaFetch } =
      serviceOver();
    await service.batchExpandRelationships(
      posts.slice(0, pageSize),
      "posts",
      POST_FIELDS,
      { depth: 3, ...TRUSTED }
    );
    const reads: Record<string, number> = {
      media: mediaFetch.mock.calls.length,
    };
    const count = (key: string) => {
      reads[key] = (reads[key] ?? 0) + 1;
    };
    for (const [collection] of batchFetch.mock.calls) {
      count(`batch:${collection}`);
    }
    for (const [collection] of singleFetch.mock.calls) {
      count(`row:${collection}`);
    }
    return reads;
  }

  it("reads as often for ten posts as for one", async () => {
    const one = await readsFor(1);
    const ten = await readsFor(POST_COUNT);
    expect(ten).toEqual(one);
    // A list never falls back to the per-row fetch, which is what made a
    // repeater's rows cost one read each.
    expect(Object.keys(ten).some(key => key.startsWith("row:"))).toBe(false);
    // The count is not trivially equal: each depth level reads its targets.
    expect(ten["batch:authors"]).toBeGreaterThan(0);
    expect(ten["batch:orgs"]).toBeGreaterThan(0);
    expect(ten.media).toBeGreaterThan(0);
  });
});
