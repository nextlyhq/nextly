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

/**
 * A page of rows, as one list read answers. Each row carries the Page Builder
 * field (`content`, empty) unless it states it, as a row does whose field the
 * caller may read; {@link withheldRows} models one whose field core withheld.
 */
function rows(items: Record<string, unknown>[], total = items.length) {
  return withheldRows(
    items.map(row => ({ content: null, ...row })),
    total
  );
}

/** A page of rows exactly as given, the builder field absent where not stated. */
function withheldRows(items: unknown[], total = items.length) {
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
      async () => rows([{ id: "l1", title: "Launch", body: null }])
    );

    const answer = await readPagesSearch(request(), reads);

    expect(readCollections(find)).toEqual(["landing"]);
    expect(answer.items[0]?.field).toBe("body");
  });

  it("opens a blocks field inside a named group by its form path, as the editor does", async () => {
    const { reads, find } = readsOver(
      [
        record("landing", {
          fields: [
            { name: "title", type: "text" },
            {
              name: "hero",
              type: "group",
              fields: [{ name: "body", type: "blocks" }],
            },
          ],
        }),
      ],
      async () => rows([{ id: "l1", title: "Launch", hero: { body: null } }])
    );

    const answer = await readPagesSearch(request(), reads);

    expect(answer.items.map(item => item.field)).toEqual(["hero.body"]);
    // The group is selected, since the field is stored under its key.
    expect((find.mock.calls[0]?.[0] as PagesFindArgs).select).toMatchObject({
      hero: true,
    });
  });

  it("never reads a collection whose only blocks field is inside a repeater, which the editor does not open", async () => {
    const { reads, find } = readsOver(
      [
        record("landing", {
          fields: [
            { name: "title", type: "text" },
            {
              name: "sections",
              type: "repeater",
              fields: [{ name: "body", type: "blocks" }],
            },
          ],
        }),
      ],
      async () => rows([{ id: "l1", title: "Launch" }])
    );

    await readPagesSearch(request(), reads);

    expect(find).not.toHaveBeenCalled();
  });

  it("names the first field that holds pages, passing over one that holds only components or patterns", async () => {
    const { reads, find } = readsOver(
      [
        record("landing", {
          fields: [
            { name: "title", type: "text" },
            { name: "parts", type: "blocks", blocks: { kinds: ["component"] } },
            { name: "body", type: "blocks" },
          ],
        }),
        record("library", {
          fields: [
            { name: "title", type: "text" },
            { name: "pattern", type: "blocks", blocks: { kinds: ["pattern"] } },
          ],
        }),
      ],
      async () => rows([{ id: "l1", title: "Launch", body: null }])
    );

    const answer = await readPagesSearch(request(), reads);

    expect(readCollections(find)).toEqual(["landing"]);
    expect(answer.items.map(item => item.field)).toEqual(["body"]);
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
      select: { id: true, headline: true, content: true },
      sort: ["headline", "id"],
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
    expect(select("pages")).toEqual({
      id: true,
      title: true,
      status: true,
      content: true,
    });
    expect(select("landing")).toEqual({ id: true, title: true, content: true });
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
                { id: "p1", title: "Beta", status: "draft" },
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
        title: "Beta",
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

    // In the order the database answered: one collection is never re-sorted.
    expect(answer.items.map(item => [item.id, item.title])).toEqual([
      ["p1", PAGES_UNTITLED],
      ["p2", PAGES_UNTITLED],
      ["p3", "Kept"],
    ]);
  });

  it("never ranks a row the database cut above one it kept", async () => {
    // SQLite orders by code point, so "Zeta" precedes "alpha" and a limit of
    // one keeps "Zeta" and cuts "alpha". A merge in any other order would
    // rank "apple" first while "alpha", which that order puts before it, was
    // never read.
    const { reads } = readsOver(
      [record("pages"), record("landing")],
      async args =>
        args.collection === "pages"
          ? rows([{ id: "p1", title: "Zeta" }], 2)
          : rows([{ id: "l1", title: "apple" }], 1)
    );

    const answer = await readPagesSearch(request({ limit: 1 }), reads);

    expect(answer.items.map(item => item.title)).toEqual(["Zeta"]);
  });

  it("takes each collection's rows in the database's own order, whatever its collation", async () => {
    // A case-insensitive collation (MySQL's default) answers "apple" before
    // "Banana". The merge keeps that order within the collection rather than
    // re-sorting it, so what the limit cut stays behind what it kept.
    const { reads } = readsOver(
      [record("pages"), record("landing")],
      async args =>
        args.collection === "pages"
          ? rows([
              { id: "p1", title: "apple" },
              { id: "p2", title: "Banana" },
            ])
          : rows([{ id: "l1", title: "Avocado" }])
    );

    const answer = await readPagesSearch(request(), reads);

    expect(answer.items.map(item => item.title)).toEqual([
      "Avocado",
      "apple",
      "Banana",
    ]);
  });

  it("asks each collection for its rows by title, then id, so a limit cuts a stable prefix", async () => {
    const { reads, find } = readsOver([record("pages")], async () => rows([]));

    await readPagesSearch(request(), reads);

    expect((find.mock.calls[0]?.[0] as PagesFindArgs).sort).toEqual([
      "title",
      "id",
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

  it("lists pages by id, untitled, when the caller may not order by their title", async () => {
    const { reads, find } = readsOver([record("pages")], async args => {
      if (args.sort?.includes("title")) {
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
    expect((find.mock.calls[1]?.[0] as PagesFindArgs).sort).toEqual(["id"]);
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

describe("the Page Builder field the caller may not read", () => {
  it("leaves out a page whose builder field core withheld, and does not count it", async () => {
    const { reads } = readsOver([record("pages")], async () =>
      withheldRows(
        [
          { id: "p1", title: "Readable", content: null },
          // Core's field-level read left `content` out of this row.
          { id: "p2", title: "Withheld" },
        ],
        2
      )
    );

    const answer = await readPagesSearch(request(), reads);

    expect(answer.items.map(item => item.id)).toEqual(["p1"]);
    expect(answer.meta.total).toBe(1);
  });
});

describe("how many collections are read at once", () => {
  it("reads at most two at a time, however many page collections there are", async () => {
    let open = 0;
    let most = 0;
    const { reads, find } = readsOver(
      ["a", "b", "c", "d", "e"].map(slug => record(slug)),
      async () => {
        open += 1;
        most = Math.max(most, open);
        // Held open across a turn of the event loop, so reads that were
        // started together are all open at once.
        await new Promise(resolve => setTimeout(resolve, 5));
        open -= 1;
        return rows([]);
      }
    );

    await readPagesSearch(request(), reads);

    // Every collection is still read: the bound orders the reads, it does
    // not drop any.
    expect(find).toHaveBeenCalledTimes(5);
    expect(most).toBe(2);
  });
});

describe("rows whose Page Builder field is withheld row by row", () => {
  /** One page of a longer read: these rows, the full match count, and whether more follow. */
  const pageOf = (items: unknown[], total: number, hasNext: boolean) => ({
    items,
    meta: {
      total,
      page: 1,
      limit: 2,
      totalPages: Math.ceil(total / 2),
      hasNext,
      hasPrev: false,
    },
  });
  /** A row the caller may open, and one whose builder field core withheld. */
  const open = (id: string) => ({ id, title: id, content: null });
  const shut = (id: string) => ({ id, title: id });

  it("reads on past withheld rows, in the same order, until it has the limit", async () => {
    const { reads, find } = readsOver([record("pages")], async args =>
      (args.page ?? 1) === 1
        ? pageOf([shut("a"), shut("b")], 4, true)
        : pageOf([open("c"), open("d")], 4, false)
    );

    const answer = await readPagesSearch(request({ limit: 2 }), reads);

    expect(answer.items.map(item => item.id)).toEqual(["c", "d"]);
    // The next page repeats the first read, order included, one page on.
    const [first, second] = find.mock.calls.map(
      call => call[0] as PagesFindArgs
    );
    expect(second).toEqual({ ...first, page: 2 });
    expect(answer.meta.total).toBe(2);
  });

  it("stops at its bound however much is withheld, and counts what it did not read", async () => {
    const { reads, find } = readsOver([record("pages")], async () =>
      pageOf([shut("x"), shut("y")], 1000, true)
    );

    const answer = await readPagesSearch(request({ limit: 2 }), reads);

    // Three pages of two rows read, none openable: the 994 matches never
    // read are counted, since none was judged, and nothing is claimed of them.
    expect(find).toHaveBeenCalledTimes(3);
    expect(answer.items).toEqual([]);
    expect(answer.meta.total).toBe(994);
    expect(answer.meta.hasNext).toBe(true);
  });

  it("counts the openable rows read plus the matches beyond them, once it has the limit", async () => {
    const { reads, find } = readsOver([record("pages")], async args =>
      (args.page ?? 1) === 1
        ? pageOf([shut("a"), open("b")], 10, true)
        : pageOf([open("c"), shut("d")], 10, true)
    );

    const answer = await readPagesSearch(request({ limit: 2 }), reads);

    expect(find).toHaveBeenCalledTimes(2);
    expect(answer.items.map(item => item.id)).toEqual(["b", "c"]);
    // Two openable among the four read, and six matches not read.
    expect(answer.meta.total).toBe(8);
  });
});
