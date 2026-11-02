/**
 * What the pages search decides: which queries it accepts, which collections
 * it reads at all, what it asks of each read, and how the answers merge.
 *
 * The reads are injected, so each assertion here is about the decision and not
 * about a database. What the route BINDS those reads to — the Direct API, as
 * the caller — is `pages-search-route.binding.test.ts`; that the reads mean
 * what they say on a real database is the integration suite.
 *
 * @module pages-search-route.test
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  PAGES_SEARCH_LIMIT_DEFAULT,
  PAGES_SEARCH_LIMIT_MAX,
  PAGES_SEARCH_MAX,
  PAGES_SEARCH_ROUTE_PATH,
  PAGES_UNTITLED,
  pagesSearchPath,
} from "./pages-search-contract";
import {
  parsePagesSearchQuery,
  readPagesSearch,
  type PagesFindArgs,
  type PagesSearchReads,
  type PagesSearchRequest,
} from "./pages-search-route";

const BASE = `http://nextly.test/plugins/x${PAGES_SEARCH_ROUTE_PATH}`;

/** The route's URL for these query parameters. */
function url(params: Record<string, string>): string {
  return `${BASE}?${new URLSearchParams(params).toString()}`;
}

/** The validation error a refused query throws, or a failure naming what was thrown instead. */
function refusedQuery(params: Record<string, string>): NextlyError {
  try {
    parsePagesSearchQuery(url(params));
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
  throw new Error(`expected ${JSON.stringify(params)} to be refused`);
}

describe("the query, parsed at the boundary", () => {
  it("reads an empty query as every page, with the default limit", () => {
    // The positive control: every refusal below is satisfied by a parser that
    // refuses everything.
    expect(parsePagesSearchQuery(BASE)).toEqual({
      limit: PAGES_SEARCH_LIMIT_DEFAULT,
    });
  });

  it("trims the search, and reads an empty one as none", () => {
    expect(parsePagesSearchQuery(url({ q: "  about us " })).search).toBe(
      "about us"
    );
    expect(parsePagesSearchQuery(url({ q: "   " }))).not.toHaveProperty(
      "search"
    );
  });

  it("refuses a search longer than the ceiling without echoing it, and accepts one at it", () => {
    const atCeiling = "a".repeat(PAGES_SEARCH_MAX);
    expect(parsePagesSearchQuery(url({ q: atCeiling })).search).toBe(atCeiling);

    const error = refusedQuery({ q: `${atCeiling}a` });
    expect(error.code).toBe("VALIDATION_ERROR");
    // The PARAMETER is named and the value is not echoed back.
    expect(JSON.stringify(error.publicData)).toContain('"q"');
    expect(JSON.stringify(error.publicData)).not.toContain(atCeiling);
  });

  it("caps a limit above the ceiling rather than refusing it", () => {
    expect(parsePagesSearchQuery(url({ limit: "500" })).limit).toBe(
      PAGES_SEARCH_LIMIT_MAX
    );
    expect(parsePagesSearchQuery(url({ limit: "7" })).limit).toBe(7);
  });

  it("refuses a limit that is not a positive whole number", () => {
    for (const limit of ["0", "-1", "2.5", "ten", ""]) {
      expect(refusedQuery({ limit }).code).toBe("VALIDATION_ERROR");
    }
  });

  it("splits exclude at its FIRST separator, so an id may hold one", () => {
    expect(
      parsePagesSearchQuery(url({ exclude: "pages:urn:page:7" })).exclude
    ).toEqual({ collection: "pages", id: "urn:page:7" });
  });

  it("refuses an exclude that names no page, without echoing it", () => {
    for (const exclude of ["pages", "pages:", ":7", " : "]) {
      const error = refusedQuery({ exclude });
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(error.publicData)).toContain('"exclude');
    }
    const long = `pages:${"x".repeat(500)}`;
    const error = refusedQuery({ exclude: long });
    expect(JSON.stringify(error.publicData)).not.toContain("x".repeat(500));
  });
});

describe("the client's path", () => {
  it("writes each parameter the route reads, and leaves out what was not asked", () => {
    expect(pagesSearchPath()).toBe(PAGES_SEARCH_ROUTE_PATH);
    const written = pagesSearchPath({
      q: "about",
      limit: 3,
      exclude: { collection: "pages", id: "p:1" },
    });
    // Round-tripped through the route's own parser, so the two spellings are
    // held together by behaviour rather than by a second copy of the names.
    expect(parsePagesSearchQuery(`http://nextly.test${written}`)).toEqual({
      search: "about",
      limit: 3,
      exclude: { collection: "pages", id: "p:1" },
    });
  });
});

/** A registry record as the collection listing answers it. */
function record(
  slug: string,
  options: {
    fields?: unknown[];
    label?: string;
    status?: boolean;
    useAsTitle?: string;
  } = {}
): Record<string, unknown> {
  return {
    slug,
    label: options.label ?? slug,
    fields: options.fields ?? [
      { name: "title", type: "text" },
      { name: "content", type: "blocks" },
    ],
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.useAsTitle === undefined
      ? {}
      : { admin: { useAsTitle: options.useAsTitle } }),
  };
}

/** A page of rows, as one list read answers. */
function rows(items: unknown[], total = items.length) {
  return {
    items,
    meta: {
      total,
      page: 1,
      limit: 10,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
  };
}

/** Reads over these registry records, answering each read with `answer`. */
function readsOver(
  records: unknown[],
  answer: (args: PagesFindArgs) => ReturnType<PagesSearchReads["find"]>,
  stores: string[] = []
) {
  const find = vi.fn(answer);
  const reads: PagesSearchReads = {
    collections: async () => records,
    stores: () => new Set(stores),
    find,
  };
  return { reads, find };
}

const request = (
  over: Partial<PagesSearchRequest> = {}
): PagesSearchRequest => ({
  limit: PAGES_SEARCH_LIMIT_DEFAULT,
  ...over,
});

/** The collections a run read, in the order it read them. */
const readCollections = (find: ReturnType<typeof vi.fn>) =>
  find.mock.calls.map(call => (call[0] as PagesFindArgs).collection);

describe("which collections are searched", () => {
  it("reads only a collection with a Page Builder field, never another", async () => {
    const { reads, find } = readsOver(
      [
        record("pages"),
        record("posts", { fields: [{ name: "title", type: "text" }] }),
      ],
      async () => rows([])
    );

    await readPagesSearch(request(), reads);

    expect(readCollections(find)).toEqual(["pages"]);
  });

  it("never reads a composition store, though it holds a blocks field", async () => {
    const { reads, find } = readsOver(
      [record("pages"), record("components"), record("patterns")],
      async () => rows([]),
      ["components", "patterns"]
    );

    await readPagesSearch(request(), reads);

    expect(readCollections(find)).toEqual(["pages"]);
  });

  it("finds a blocks field inside an unnamed group, which lives at the top level", async () => {
    const { reads, find } = readsOver(
      [
        record("landing", {
          fields: [
            { name: "title", type: "text" },
            { type: "group", fields: [{ name: "body", type: "blocks" }] },
          ],
        }),
      ],
      async () => rows([{ id: "l1", title: "Launch" }])
    );

    const answer = await readPagesSearch(request(), reads);

    expect(readCollections(find)).toEqual(["landing"]);
    expect(answer.items[0]?.field).toBe("body");
  });

  it("answers an empty list, reading nothing, where no collection has the field", async () => {
    const { reads, find } = readsOver(
      [record("posts", { fields: [{ name: "title", type: "text" }] })],
      async () => rows([{ id: "x", title: "Never read" }])
    );

    const answer = await readPagesSearch(request(), reads);

    expect(find).not.toHaveBeenCalled();
    expect(answer.items).toEqual([]);
    expect(answer.meta.total).toBe(0);
  });
});

describe("what each read asks for", () => {
  it("searches the title field in the database, selecting only what an item needs", async () => {
    const { reads, find } = readsOver(
      [
        record("pages", {
          useAsTitle: "headline",
          fields: [
            { name: "headline", type: "text" },
            { name: "secret", type: "text" },
            { name: "content", type: "blocks" },
          ],
        }),
      ],
      async () => rows([])
    );

    await readPagesSearch(request({ search: "abo", limit: 3 }), reads);

    expect(find.mock.calls[0]?.[0]).toEqual({
      collection: "pages",
      where: { headline: { contains: "abo" } },
      select: { id: true, headline: true },
      sort: "headline",
      limit: 3,
    });
  });

  it("selects the status column only where the collection has the lifecycle", async () => {
    const { reads, find } = readsOver(
      [record("pages", { status: true }), record("landing")],
      async () => rows([])
    );

    await readPagesSearch(request(), reads);

    const select = (slug: string) =>
      find.mock.calls
        .map(call => call[0] as PagesFindArgs)
        .find(args => args.collection === slug)?.select;
    expect(select("pages")).toEqual({ id: true, title: true, status: true });
    expect(select("landing")).toEqual({ id: true, title: true });
  });

  it("drops the excluded page in the database, in its own collection only", async () => {
    const { reads, find } = readsOver(
      [record("pages"), record("landing")],
      async () => rows([])
    );

    await readPagesSearch(
      request({ search: "a", exclude: { collection: "pages", id: "p7" } }),
      reads
    );

    const whereOf = (slug: string) =>
      find.mock.calls
        .map(call => call[0] as PagesFindArgs)
        .find(args => args.collection === slug)?.where;
    expect(whereOf("pages")).toEqual({
      and: [{ title: { contains: "a" } }, { id: { not_equals: "p7" } }],
    });
    expect(whereOf("landing")).toEqual({ title: { contains: "a" } });
  });
});

describe("the merged answer", () => {
  it("merges two collections by title, capped at the limit, with the total of both", async () => {
    const { reads } = readsOver(
      [
        record("pages", { label: "Page", status: true }),
        record("landing", { label: "Landing page" }),
      ],
      async args =>
        args.collection === "pages"
          ? rows(
              [
                { id: "p1", title: "beta", status: "draft" },
                { id: "p2", title: "Delta", status: "published" },
              ],
              4
            )
          : rows(
              [
                { id: 1, title: "Alpha" },
                { id: 2, title: "Charlie" },
              ],
              2
            )
    );

    const answer = await readPagesSearch(request({ limit: 3 }), reads);

    // Case does not decide the order: "beta" sorts between "Alpha" and
    // "Charlie", which a plain code-point sort would put last.
    expect(answer.items).toEqual([
      {
        id: "1",
        collection: "landing",
        collectionLabel: "Landing page",
        field: "content",
        title: "Alpha",
      },
      {
        id: "p1",
        collection: "pages",
        collectionLabel: "Page",
        field: "content",
        title: "beta",
        status: "draft",
      },
      {
        id: "2",
        collection: "landing",
        collectionLabel: "Landing page",
        field: "content",
        title: "Charlie",
      },
    ]);
    expect(answer.meta).toEqual({
      total: 6,
      page: 1,
      limit: 3,
      totalPages: 2,
      hasNext: true,
      hasPrev: false,
    });
  });

  it("labels a page with no readable title neutrally, never with another field", async () => {
    const { reads } = readsOver([record("pages")], async () =>
      rows([
        { id: "p1", slug: "hidden-slug" },
        { id: "p2", title: "   " },
        { id: "p3", title: "Kept" },
      ])
    );

    const answer = await readPagesSearch(request(), reads);

    expect(answer.items.map(item => [item.id, item.title])).toEqual([
      ["p3", "Kept"],
      ["p1", PAGES_UNTITLED],
      ["p2", PAGES_UNTITLED],
    ]);
  });

  it("sends a status only when the row holds one the lifecycle admits", async () => {
    const { reads } = readsOver(
      [record("pages", { status: true }), record("landing")],
      async args =>
        args.collection === "pages"
          ? rows([
              { id: "p1", title: "A", status: "published" },
              { id: "p2", title: "B", status: "archived" },
            ])
          : rows([{ id: "l1", title: "C", status: "published" }])
    );

    const answer = await readPagesSearch(request(), reads);

    expect(answer.items.map(item => item.status)).toEqual([
      "published",
      undefined,
      undefined,
    ]);
    expect(answer.items[1]).not.toHaveProperty("status");
    expect(answer.items[2]).not.toHaveProperty("status");
  });
});

describe("what core refuses", () => {
  it("leaves out a collection core refuses this caller, and answers from the rest", async () => {
    const { reads } = readsOver(
      [record("pages"), record("landing")],
      async args => {
        if (args.collection === "landing") throw NextlyError.forbidden();
        return rows([{ id: "p1", title: "Readable" }]);
      }
    );

    const answer = await readPagesSearch(request(), reads);

    expect(answer.items.map(item => item.collection)).toEqual(["pages"]);
    expect(answer.meta.total).toBe(1);
  });

  it("answers a search on a title the caller may not read with nothing", async () => {
    const { reads, find } = readsOver([record("pages")], async () => {
      throw NextlyError.validation({
        errors: [
          { path: "where.title", code: "FIELD_NOT_FILTERABLE", message: "x" },
        ],
      });
    });

    const answer = await readPagesSearch(request({ search: "a" }), reads);

    expect(answer.items).toEqual([]);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("lists pages unordered, untitled, when the caller may not order by their title", async () => {
    const { reads, find } = readsOver([record("pages")], async args => {
      if (args.sort !== undefined) {
        throw NextlyError.validation({
          errors: [
            { path: "sort.title", code: "FIELD_NOT_SORTABLE", message: "x" },
          ],
        });
      }
      return rows([{ id: "p1" }]);
    });

    const answer = await readPagesSearch(request(), reads);

    expect(find).toHaveBeenCalledTimes(2);
    expect(find.mock.calls[1]?.[0]).not.toHaveProperty("sort");
    expect(answer.items.map(item => [item.id, item.title])).toEqual([
      ["p1", PAGES_UNTITLED],
    ]);
  });

  it("does not swallow a validation error about something else", async () => {
    const { reads } = readsOver([record("pages")], async () => {
      throw NextlyError.validation({
        errors: [
          { path: "where.other", code: "FIELD_NOT_FILTERABLE", message: "x" },
        ],
      });
    });

    // With a search, because there a refusal read as the title's is answered
    // with an EMPTY list: only a rethrow tells the two readings apart.
    await expect(
      readPagesSearch(request({ search: "a" }), reads)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
