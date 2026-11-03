/**
 * What the entries route decides: which queries it accepts, which collections
 * it will read at all, what it asks of the read, and what of each row travels.
 *
 * The reads are injected, so each assertion here is about the decision and not
 * about a database. What the route BINDS those reads to — the Direct API, as
 * the caller — is `entries-route.binding.test.ts`; that the reads mean what
 * they say on a real database is the integration suite.
 *
 * @module entries-route.test
 */
import { ITEM_SCHEMA_MAX_DEPTH } from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  ENTRIES_LIMIT_DEFAULT,
  ENTRIES_LIMIT_MAX,
  ENTRIES_SEARCH_MAX,
  ENTRIES_UNTITLED,
} from "./entries-contract";
import {
  parseEntriesQuery,
  readEntries,
  relationTargets,
  type EntriesFindArgs,
  type EntriesReads,
} from "./entries-route";

const BASE = "http://nextly.test/plugins/x/entries";

/** The route's URL for these query parameters. */
function url(params: Record<string, string>): string {
  return `${BASE}?${new URLSearchParams(params).toString()}`;
}

/** The validation error a refused query throws, or a failure naming what was thrown instead. */
function refusedQuery(params: Record<string, string>): NextlyError {
  try {
    parseEntriesQuery(url(params));
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
  throw new Error(`expected ${JSON.stringify(params)} to be refused`);
}

describe("the query, parsed at the boundary", () => {
  it("reads a collection alone, with the default limit", () => {
    // The positive control: every refusal below is satisfied by a parser that
    // refuses everything.
    expect(parseEntriesQuery(url({ collection: "posts" }))).toEqual({
      collection: "posts",
      limit: ENTRIES_LIMIT_DEFAULT,
    });
  });

  it("refuses a request that names no collection", () => {
    expect(refusedQuery({}).code).toBe("VALIDATION_ERROR");
    expect(refusedQuery({ collection: "  " }).code).toBe("VALIDATION_ERROR");
  });

  it("trims the search, and reads an empty one as none", () => {
    expect(
      parseEntriesQuery(url({ collection: "posts", search: "  hello " })).search
    ).toBe("hello");
    expect(
      parseEntriesQuery(url({ collection: "posts", search: "   " }))
    ).not.toHaveProperty("search");
  });

  it("refuses a search longer than the ceiling, and accepts one exactly at it", () => {
    const atCeiling = "a".repeat(ENTRIES_SEARCH_MAX);
    expect(
      parseEntriesQuery(url({ collection: "posts", search: atCeiling })).search
    ).toBe(atCeiling);

    const error = refusedQuery({
      collection: "posts",
      search: `${atCeiling}a`,
    });
    expect(error.code).toBe("VALIDATION_ERROR");
    // The PARAMETER is named and the value is not echoed back.
    expect(JSON.stringify(error.publicData)).toContain('"search"');
    expect(JSON.stringify(error.publicData)).not.toContain(atCeiling);
  });

  it("caps a limit above the ceiling rather than refusing it", () => {
    expect(
      parseEntriesQuery(url({ collection: "posts", limit: "500" })).limit
    ).toBe(ENTRIES_LIMIT_MAX);
    expect(
      parseEntriesQuery(url({ collection: "posts", limit: "7" })).limit
    ).toBe(7);
  });

  it("refuses a limit that is not a positive whole number", () => {
    for (const limit of ["0", "-1", "2.5", "ten", ""]) {
      expect(refusedQuery({ collection: "posts", limit }).code).toBe(
        "VALIDATION_ERROR"
      );
    }
  });

  it("splits ids on commas, trimming, dropping blanks and folding repeats", () => {
    expect(
      parseEntriesQuery(url({ collection: "posts", ids: " a,,b, a " })).ids
    ).toEqual(["a", "b"]);
    expect(
      parseEntriesQuery(url({ collection: "posts", ids: " , " }))
    ).not.toHaveProperty("ids");
  });

  it("refuses more ids than one page carries", () => {
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => `id-${i}`).join(",");
    expect(
      parseEntriesQuery(
        url({ collection: "posts", ids: ids(ENTRIES_LIMIT_MAX) })
      ).ids
    ).toHaveLength(ENTRIES_LIMIT_MAX);
    expect(
      refusedQuery({ collection: "posts", ids: ids(ENTRIES_LIMIT_MAX + 1) })
        .code
    ).toBe("VALIDATION_ERROR");
  });
});

describe("which collections a registered block names as relation targets", () => {
  it("collects every relation prop's target, across blocks", () => {
    expect(
      [
        ...relationTargets([
          { props: { post: { type: "relation", relationTo: "posts" } } },
          {
            props: {
              heading: { type: "text" },
              author: { type: "relation", relationTo: "people" },
            },
          },
        ]),
      ].sort()
    ).toEqual(["people", "posts"]);
  });

  it("collects a relation inside a list's item schema, which the inspector draws too", () => {
    expect([
      ...relationTargets([
        {
          props: {
            cards: {
              type: "array",
              of: "object",
              item: {
                caption: { type: "text" },
                post: { type: "relation", relationTo: "posts" },
              },
            },
          },
        },
      ]),
    ]).toEqual(["posts"]);
  });

  it("ignores a prop that is not a relation, or names no usable target", () => {
    // Each of these is a declaration that must NOT open a collection: a
    // different control naming a collection, a relation naming nothing, and
    // malformed shapes a registry of many authors can hold.
    expect(
      relationTargets([
        { props: { a: { type: "text", relationTo: "users" } } },
        { props: { b: { type: "relation" } } },
        { props: { c: { type: "relation", relationTo: "" } } },
        { props: { d: { type: "relation", relationTo: 7 } } },
        { props: { e: null } },
        { props: null },
        {},
      ]).size
    ).toBe(0);
  });
});

/** Reads that record what they were asked, over the rows given. */
function reads(options: {
  targets?: string[];
  collection?: unknown;
  rows?: unknown[];
}): EntriesReads & { finds: EntriesFindArgs[]; configs: string[] } {
  const finds: EntriesFindArgs[] = [];
  const configs: string[] = [];
  return {
    finds,
    configs,
    targets: () => new Set(options.targets ?? ["posts"]),
    collection: async slug => {
      configs.push(slug);
      if (options.collection instanceof Error) throw options.collection;
      return (
        options.collection ?? {
          fields: [{ name: "headline" }, { name: "title" }, { name: "body" }],
          admin: { useAsTitle: "headline" },
        }
      );
    },
    find: async args => {
      finds.push(args);
      const rows = options.rows ?? [];
      return {
        items: rows,
        meta: {
          total: rows.length,
          page: 1,
          limit: args.limit,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
          // Something the Direct API's meta may carry beyond paging, which
          // the route must not pass on unread.
          hidden: [{ scopeKind: "collection", scopeSlug: "x", count: 3 }],
        },
      };
    },
  };
}

describe("one read", () => {
  it("refuses a collection no block names, before reading anything", async () => {
    const r = reads({ targets: ["posts"] });

    const refusal = readEntries({ collection: "users", limit: 10 }, r);

    await expect(refusal).rejects.toSatisfy(NextlyError.isForbidden);
    // Nothing was read: neither the configuration nor the rows. A refusal made
    // after a read could answer differently for a collection that exists.
    expect(r.configs).toEqual([]);
    expect(r.finds).toEqual([]);
  });

  it("refuses with the SAME answer whether or not the collection exists", async () => {
    // An undeclared slug that exists, and a declared one whose collection does
    // not: both must be the generic forbidden refusal, with nothing naming the
    // slug in what the caller is told.
    const undeclared = await readEntries(
      { collection: "users", limit: 10 },
      reads({ targets: ["posts"] })
    ).catch((error: unknown) => error);
    const missing = await readEntries(
      { collection: "ghosts", limit: 10 },
      reads({
        targets: ["ghosts"],
        collection: NextlyError.notFound({ logContext: { x: 1 } }),
      })
    ).catch((error: unknown) => error);

    for (const error of [undeclared, missing]) {
      expect(NextlyError.isForbidden(error)).toBe(true);
      expect((error as NextlyError).publicMessage).toBe(
        (undeclared as NextlyError).publicMessage
      );
      expect((error as NextlyError).publicMessage).not.toMatch(/users|ghosts/);
    }
  });

  it("selects only the title field the collection nominates", async () => {
    const r = reads({});

    await readEntries({ collection: "posts", limit: 10 }, r);

    expect(r.finds).toEqual([
      {
        collection: "posts",
        select: { id: true, headline: true },
        limit: 10,
      },
    ]);
  });

  it("falls back to the conventional title field when none is nominated", async () => {
    const r = reads({
      collection: { fields: [{ name: "body" }, { name: "name" }] },
    });

    await readEntries({ collection: "posts", limit: 10 }, r);

    expect(r.finds[0]?.select).toEqual({ id: true, name: true });
  });

  it("searches the title field, case-insensitively through `contains`", async () => {
    const r = reads({});

    await readEntries({ collection: "posts", search: "Hello", limit: 10 }, r);

    expect(r.finds[0]?.where).toEqual({ headline: { contains: "Hello" } });
  });

  it("resolves ids in one page, combined with a search when both are asked", async () => {
    const r = reads({});

    await readEntries({ collection: "posts", ids: ["a", "b"], limit: 10 }, r);
    await readEntries(
      { collection: "posts", ids: ["a"], search: "x", limit: 10 },
      r
    );

    expect(r.finds[0]).toMatchObject({
      where: { id: { in: ["a", "b"] } },
      limit: 2,
    });
    expect(r.finds[1]?.where).toEqual({
      and: [{ id: { in: ["a"] } }, { headline: { contains: "x" } }],
    });
  });

  it("answers each row as its id and title, and nothing else", async () => {
    const answer = await readEntries(
      { collection: "posts", limit: 10 },
      reads({
        rows: [
          {
            id: "a",
            headline: "  First ",
            body: "secret",
            createdAt: "2026-01-01",
          },
          { id: 42, headline: "Numbered" },
        ],
      })
    );

    expect(answer.items).toEqual([
      { id: "a", title: "First" },
      { id: "42", title: "Numbered" },
    ]);
  });

  it("labels a row whose title is absent, empty or unreadable neutrally — never with another field", async () => {
    // Field-level read access removes the title from the row; the row still
    // carries other fields the read returned, and none of them may stand in.
    const answer = await readEntries(
      { collection: "posts", limit: 10 },
      reads({
        rows: [
          { id: "stripped", title: "Not the title field", body: "b" },
          { id: "blank", headline: "   " },
          { id: "object", headline: { nested: true } },
        ],
      })
    );

    expect(answer.items).toEqual([
      { id: "stripped", title: ENTRIES_UNTITLED },
      { id: "blank", title: ENTRIES_UNTITLED },
      { id: "object", title: ENTRIES_UNTITLED },
    ]);
  });

  it("skips a row without a usable id", async () => {
    const answer = await readEntries(
      { collection: "posts", limit: 10 },
      reads({ rows: [{ headline: "No id" }, { id: "", headline: "Empty" }] })
    );

    expect(answer.items).toEqual([]);
  });

  it("passes on the read's paging, and nothing else the meta carried", async () => {
    const answer = await readEntries(
      { collection: "posts", limit: 10 },
      reads({ rows: [{ id: "a", headline: "A" }] })
    );

    expect(answer.meta).toEqual({
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  });

  it("matches nothing for a search on a collection with no title field, after only the gate's read", async () => {
    const r = reads({
      collection: { fields: [{ name: "body" }] },
      rows: [{ id: "p1" }],
    });

    const answer = await readEntries(
      { collection: "posts", search: "x", limit: 10 },
      r
    );

    expect(answer.items).toEqual([]);
    // Only the smallest read core's gate can judge: no filter, id alone.
    expect(r.finds).toEqual([
      { collection: "posts", select: { id: true }, limit: 1 },
    ]);
  });

  it("refuses a caller who may not read the collection, even for a search that cannot match", async () => {
    // Whether a search can match must not decide whether access is checked.
    const r = reads({ collection: { fields: [{ name: "body" }] } });
    const refusing = {
      ...r,
      find: async () => {
        throw NextlyError.forbidden();
      },
    };

    await expect(
      readEntries({ collection: "posts", search: "x", limit: 10 }, refusing)
    ).rejects.toSatisfy(NextlyError.isForbidden);
  });

  it("lists a collection with no title field by id alone, selecting no other field", async () => {
    const r = reads({
      collection: { fields: [{ name: "body" }] },
      rows: [{ id: "a", body: "b" }],
    });

    const answer = await readEntries({ collection: "posts", limit: 10 }, r);

    expect(r.finds[0]?.select).toEqual({ id: true });
    expect(answer.items).toEqual([{ id: "a", title: ENTRIES_UNTITLED }]);
  });

  it("lets a failure that is not a missing collection through, unchanged", async () => {
    const fault = vi.fn(async () => {
      throw new Error("database down");
    });
    await expect(
      readEntries(
        { collection: "posts", limit: 10 },
        { ...reads({}), collection: fault }
      )
    ).rejects.toThrow("database down");
  });

  it("matches nothing, rather than failing, when the caller may not filter on the title", async () => {
    // Core refuses a filter on a field the caller may not read, so the search
    // matches nothing for them; a listing without a search still lists.
    const r = reads({ rows: [{ id: "p1" }] });
    const refused = {
      ...r,
      find: async (args: EntriesFindArgs) => {
        if (args.where !== undefined) {
          // As core refuses it: a validation error naming the code.
          throw NextlyError.validation({
            errors: [
              {
                path: "where.title",
                code: "FIELD_NOT_FILTERABLE",
                message: "Not filterable.",
              },
            ],
          });
        }
        return r.find(args);
      },
    };

    const searched = await readEntries(
      { collection: "posts", search: "launch", limit: 10 },
      refused
    );
    expect(searched.items).toEqual([]);
    // The control: any other failure of a search still fails.
    await expect(
      readEntries(
        { collection: "posts", search: "launch", limit: 10 },
        {
          ...r,
          find: async () => {
            throw new Error("database down");
          },
        }
      )
    ).rejects.toThrow("database down");
  });

  it("matches a number title exactly, and only by a search that is a number", async () => {
    const numbered = {
      fields: [{ name: "issue", type: "number" }],
      admin: { useAsTitle: "issue" },
    };
    const r = reads({ collection: numbered, rows: [{ id: "i1", issue: 42 }] });

    await readEntries({ collection: "posts", search: "42", limit: 10 }, r);
    expect(r.finds[0]?.where).toEqual({ issue: { equals: 42 } });

    // Words cannot match a number: no filter is sent, only the gate's read.
    const words = await readEntries(
      { collection: "posts", search: "launch", limit: 10 },
      r
    );
    expect(words.items).toEqual([]);
    expect(r.finds[1]).toEqual({
      collection: "posts",
      select: { id: true },
      limit: 1,
    });
  });

  it("reads in the language being edited, the gate's read included", async () => {
    const r = reads({
      collection: { fields: [{ name: "body" }] },
      rows: [{ id: "p1" }],
    });
    await readEntries({ collection: "posts", limit: 10, locale: "de" }, r);
    await readEntries(
      { collection: "posts", search: "x", limit: 10, locale: "de" },
      r
    );
    expect(r.finds.map(find => find.locale)).toEqual(["de", "de"]);
  });
});

describe("the language a read names", () => {
  it("is parsed from the query, and an empty one is none", () => {
    expect(
      parseEntriesQuery(url({ collection: "posts", locale: "de" })).locale
    ).toBe("de");
    expect(
      parseEntriesQuery(url({ collection: "posts", locale: "" })).locale
    ).toBeUndefined();
  });

  it("matches nothing, after the gate's read, for a title field that is neither text nor a number", async () => {
    // contains on a boolean, a date or JSON fails on PostgreSQL alone.
    const r = reads({
      collection: {
        fields: [{ name: "featured", type: "checkbox" }],
        admin: { useAsTitle: "featured" },
      },
      rows: [{ id: "p1" }],
    });

    const answer = await readEntries(
      { collection: "posts", search: "yes", limit: 10 },
      r
    );

    expect(answer.items).toEqual([]);
    expect(r.finds).toEqual([
      { collection: "posts", select: { id: true }, limit: 1 },
    ]);
  });

  it("follows item schemas as deep as the engine's bound, and no deeper", () => {
    const nest = (depth: number): Record<string, unknown> =>
      depth === 0
        ? { post: { type: "relation", relationTo: `level-${depth}` } }
        : {
            list: { type: "array", of: "object", item: nest(depth - 1) },
            post: { type: "relation", relationTo: `level-${depth}` },
          };
    const found = relationTargets([{ props: nest(ITEM_SCHEMA_MAX_DEPTH + 1) }]);
    // The relation at the bound itself is reached; one level past it is not.
    expect(found.has("level-1")).toBe(true);
    expect(found.has("level-0")).toBe(false);
  });
});
