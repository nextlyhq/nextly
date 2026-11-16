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
  pageAddressPath,
  pagesSearchPath,
  type PagesSearchOrder,
} from "./pages-search-contract";
import {
  parsePageAddressQuery,
  parsePagesSearchQuery,
  readPageAddress,
  readPagesSearch,
  type PagesFindArgs,
  type PageAddressReads,
  type PagesSearchReads,
  type PagesSearchRequest,
  findPageCollection,
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
      order: "title",
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
      order: "collection",
      locale: "fr",
    });
    // Round-tripped through the route's own parser, so the two spellings are
    // held together by behaviour rather than by a second copy of the names.
    expect(parsePagesSearchQuery(`http://nextly.test${written}`)).toEqual({
      search: "about",
      limit: 3,
      exclude: { collection: "pages", id: "p:1" },
      order: "collection",
      locale: "fr",
    });
  });
});

/** A registry record as the collection listing answers it. */
function record(
  slug: string,
  options: {
    fields?: unknown[];
    label?: string;
    labels?: { singular: string; plural: string };
    status?: boolean;
    useAsTitle?: string;
  } = {}
): Record<string, unknown> {
  return {
    slug,
    label: options.label ?? slug,
    ...(options.labels === undefined ? {} : { labels: options.labels }),
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

/** Whether a read is one of the publishing-state reads, by core's reserved keys. */
const isWorkflowRead = (args: PagesFindArgs): boolean =>
  args.where !== undefined &&
  (Object.hasOwn(args.where, "_pendingChange") ||
    Object.hasOwn(args.where, "_inRelease"));

/**
 * Reads over these registry records, answering each search read with `answer`
 * and each publishing-state read with `workflow` (none matching, unless
 * given). The two are recorded apart, so `find` holds the search reads alone.
 */
function readsOver(
  records: unknown[],
  answer: (args: PagesFindArgs) => ReturnType<PagesSearchReads["find"]>,
  stores: string[] = [],
  workflowAnswer: (
    args: PagesFindArgs
  ) => ReturnType<PagesSearchReads["find"]> = async () => rows([])
) {
  const find = vi.fn(answer);
  const workflow = vi.fn(workflowAnswer);
  const warn = vi.fn();
  const reads: PagesSearchReads = {
    collections: async () => records,
    stores: () => new Set(stores),
    pagesCollection: () => "pages",
    find: args => (isWorkflowRead(args) ? workflow(args) : find(args)),
    warn,
  };
  return { reads, find, workflow, warn };
}

const request = (
  over: Partial<PagesSearchRequest> = {}
): PagesSearchRequest => ({
  limit: PAGES_SEARCH_LIMIT_DEFAULT,
  order: "title",
  ...over,
});

/** The collections a run read, in the order it read them. */
const readCollections = (find: ReturnType<typeof vi.fn>) =>
  find.mock.calls.map(call => (call[0] as PagesFindArgs).collection);

describe("the language a search reads in", () => {
  it("reads every page of the search in the locale the request names", async () => {
    const { reads, find } = readsOver([record("pages")], async () =>
      rows([{ id: "p-1", title: "Tarifs" }])
    );

    await readPagesSearch(request({ locale: "fr", search: "tar" }), reads);

    expect(find).toHaveBeenCalled();
    for (const [args] of find.mock.calls) {
      expect((args as PagesFindArgs).locale).toBe("fr");
    }
  });

  it("names no locale when the request names none, so core reads the default", async () => {
    const { reads, find } = readsOver([record("pages")], async () => rows([]));

    await readPagesSearch(request(), reads);

    expect(find).toHaveBeenCalled();
    for (const [args] of find.mock.calls) {
      expect(args).not.toHaveProperty("locale");
    }
  });
});

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
  it("names a collection's pages by its plural, where it has one", async () => {
    const { reads } = readsOver(
      [
        record("landing", {
          label: "Landing page",
          labels: { singular: "Landing page", plural: "Landing pages" },
        }),
        record("pages", { label: "Page" }),
      ],
      async args =>
        rows([{ id: `${args.collection}-1`, title: args.collection }], 1)
    );

    const answer = await readPagesSearch(request({ limit: 5 }), reads);
    const byCollection = Object.fromEntries(
      answer.items.map(item => [item.collection, item.collectionPluralLabel])
    );
    // A heading over the group says "Landing pages"; a collection without a
    // plural sends none, and the panel falls back to its name.
    expect(byCollection).toEqual({
      landing: "Landing pages",
      pages: undefined,
    });
  });

  it("gives each page the version it was read at, for a rename to send back", async () => {
    const { reads } = readsOver(
      [record("pages", { label: "Page" })],
      async () =>
        rows(
          [
            { id: "p1", title: "About", _rev: "6" },
            { id: "p2", title: "Contact" },
          ],
          2
        )
    );

    const answer = await readPagesSearch(request({ limit: 5 }), reads);
    const revs = Object.fromEntries(
      answer.items.map(item => [item.id, item.rev])
    );
    // A row a server without versions answers carries none.
    expect(revs).toEqual({ p1: "6", p2: undefined });
  });

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
        // A page never published, as the admin's pill calls it.
        state: "draft",
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
      // The cursor for the next page, there because there is one.
      nextBefore: expect.any(String),
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

  it("drops a collection whose read fails for another reason, tells the operator, and answers from the rest", async () => {
    const { reads, warn } = readsOver(
      [record("pages"), record("landing")],
      async args => {
        if (args.collection === "landing") {
          throw NextlyError.validation({
            errors: [
              {
                path: "where.other",
                code: "FIELD_NOT_FILTERABLE",
                message: "x",
              },
            ],
          });
        }
        return rows([{ id: "p1", title: "Healthy" }]);
      }
    );

    // With a search, where a refusal misread as the title's is ALSO an empty
    // answer for that collection: only the operator's notice tells them apart.
    const answer = await readPagesSearch(request({ search: "a" }), reads);

    expect(answer.items.map(item => item.id)).toEqual(["p1"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({
      collection: "landing",
      code: "VALIDATION_ERROR",
    });
  });

  it("drops a collection whose table cannot be read, and answers from the rest", async () => {
    const { reads, warn } = readsOver(
      [record("pages"), record("landing")],
      async args => {
        if (args.collection === "landing") {
          throw new Error("no such column: landing.content");
        }
        return rows([{ id: "p1", title: "Healthy" }]);
      }
    );

    const answer = await readPagesSearch(request(), reads);

    expect(answer.items.map(item => item.collection)).toEqual(["pages"]);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ collection: "landing" });
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
      (args.offset ?? 0) === 0
        ? pageOf([shut("a"), shut("b")], 4, true)
        : pageOf([open("c"), open("d")], 4, false)
    );

    const answer = await readPagesSearch(request({ limit: 2 }), reads);

    expect(answer.items.map(item => item.id)).toEqual(["c", "d"]);
    // The next read repeats the first, order included, from the row after
    // the last one read.
    const [first, second] = find.mock.calls.map(
      call => call[0] as PagesFindArgs
    );
    expect(second).toEqual({ ...first, offset: 2 });
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
      (args.offset ?? 0) === 0
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

describe("a collection whose schema is not live", () => {
  it("is read only when the registry says its table matches its schema", async () => {
    const { reads, find } = readsOver(
      ["synced", "applied", "pending", "generated", "failed", undefined].map(
        state => ({
          ...record(`c-${state ?? "unstated"}`),
          ...(state === undefined ? {} : { migrationStatus: state }),
        })
      ),
      async () => rows([])
    );

    await readPagesSearch(request(), reads);

    expect(readCollections(find).sort()).toEqual([
      "c-applied",
      "c-synced",
      "c-unstated",
    ]);
  });
});

describe("a Page Builder field inside a group", () => {
  const grouped = record("landing", {
    fields: [
      { name: "title", type: "text" },
      {
        name: "hero",
        type: "group",
        fields: [{ name: "body", type: "blocks" }],
      },
    ],
  });

  it("lists a page whose group predates the field, which core cannot tell from a withheld one", async () => {
    const { reads } = readsOver([grouped], async () =>
      withheldRows([{ id: "l1", title: "Older", hero: {} }])
    );

    const answer = await readPagesSearch(request(), reads);

    expect(answer.items.map(item => item.id)).toEqual(["l1"]);
  });

  it("leaves out a page whose group core withheld, the key it selected", async () => {
    const { reads } = readsOver([grouped], async () =>
      withheldRows([
        { id: "l1", title: "Open", hero: { body: null } },
        { id: "l2", title: "Withheld" },
      ])
    );

    const answer = await readPagesSearch(request(), reads);

    expect(answer.items.map(item => item.id)).toEqual(["l1"]);
  });
});

/** A query's URL with the cursor `before`, and whatever else is asked. */
const withCursor = (before: string, params: Record<string, string> = {}) =>
  url({ ...params, before });

describe("the cursor, parsed at the boundary", () => {
  it("reads back the cursor an answer wrote, through the client's path", async () => {
    const { reads } = readsOver([record("pages")], async () =>
      rows(
        [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
        3
      )
    );
    const first = await readPagesSearch(request({ limit: 2 }), reads);
    const before = first.meta.nextBefore ?? "";
    expect(before).not.toBe("");

    const parsed = parsePagesSearchQuery(
      `http://nextly.test${pagesSearchPath({ limit: 2, before })}`
    );
    expect(parsed.before).toEqual({ page: 2, at: { pages: 2 } });
  });

  it("refuses a value that is not a cursor the route wrote, without echoing it", () => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    for (const before of [
      "not-a-cursor",
      encode({ page: 1, at: {} }),
      encode({ page: 2, at: { pages: -1 } }),
      encode({ page: 2, at: { pages: 1.5 } }),
      encode({ page: 2, at: {}, extra: true }),
      "x".repeat(5000),
    ]) {
      const error = refusedQuery({ before });
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(error.publicData)).toContain('"before');
      expect(JSON.stringify(error.publicData)).not.toContain(before);
    }
  });
});

/**
 * Reads over an in-memory table per collection, each already in its database
 * order, answering `limit` rows from `offset` as core's read does.
 */
function readsOverTables(
  tables: Record<string, Record<string, unknown>[]>,
  status = false
) {
  return readsOver(
    Object.keys(tables).map(slug => record(slug, { status })),
    async args => {
      const table = tables[args.collection] ?? [];
      const from = args.offset ?? 0;
      const items = table.slice(from, from + args.limit);
      return {
        items,
        meta: {
          total: table.length,
          page: 1,
          limit: args.limit,
          totalPages: Math.ceil(table.length / args.limit),
          hasNext: from + items.length < table.length,
          hasPrev: from > 0,
        },
      };
    }
  );
}

/** Every page of a search, walked by its cursor, and the reads it made. */
async function walk(
  reads: PagesSearchReads,
  limit: number,
  order: PagesSearchOrder = "title"
): Promise<{ pages: string[][]; metas: PagesSearchResponseMeta[] }> {
  const pages: string[][] = [];
  const metas: PagesSearchResponseMeta[] = [];
  let before: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const parsed = parsePagesSearchQuery(
      `http://nextly.test${pagesSearchPath({ limit, order, ...(before === undefined ? {} : { before }) })}`
    );
    const answer = await readPagesSearch(parsed, reads);
    pages.push(answer.items.map(item => item.title));
    metas.push(answer.meta);
    if (!answer.meta.hasNext) break;
    before = answer.meta.nextBefore;
  }
  return { pages, metas };
}

type PagesSearchResponseMeta = Awaited<
  ReturnType<typeof readPagesSearch>
>["meta"];

/** A titled row whose Page Builder field the caller may read. */
const titled = (id: string) => ({ id, title: id, content: null });

describe("paging by cursor", () => {
  it("continues each page exactly where the last ended, across collections, with nothing repeated or skipped", async () => {
    const { reads } = readsOverTables({
      landing: ["A1", "C1", "E1", "G1"].map(titled),
      pages: ["B2", "D2", "F2"].map(titled),
    });

    const { pages, metas } = await walk(reads, 2);

    expect(pages).toEqual([["A1", "B2"], ["C1", "D2"], ["E1", "F2"], ["G1"]]);
    expect(metas.map(meta => [meta.page, meta.hasNext, meta.hasPrev])).toEqual([
      [1, true, false],
      [2, true, true],
      [3, true, true],
      [4, false, true],
    ]);
    // The last page names no next one.
    expect(metas.at(-1)).not.toHaveProperty("nextBefore");
  });

  it("reads each collection from its position, never re-reading earlier rows", async () => {
    const { reads, find } = readsOverTables({
      landing: ["A1", "C1", "E1"].map(titled),
      pages: ["B2", "D2"].map(titled),
    });
    const first = await readPagesSearch(request({ limit: 2 }), reads);
    find.mockClear();

    await readPagesSearch(
      parsePagesSearchQuery(
        withCursor(first.meta.nextBefore ?? "", { limit: "2" })
      ),
      reads
    );

    const offsets = Object.fromEntries(
      find.mock.calls.map(call => {
        const args = call[0] as PagesFindArgs;
        return [args.collection, args.offset];
      })
    );
    expect(offsets).toEqual({ landing: 1, pages: 1 });
  });

  it("stops a page where a collection's bounded read ran out, and the next page reads it on", async () => {
    // Seven withheld rows ahead of "B": a limit of 2 reads three pages of two
    // (six rows) and finds nothing, so "B" is not read on the first page.
    const shut = (id: string) => ({ id, title: id });
    const { reads } = readsOverTables({
      landing: [
        ...["A0", "A1", "A2", "A3", "A4", "A5", "A6"].map(shut),
        titled("B"),
      ],
      pages: ["C", "D"].map(titled),
    });

    const { pages } = await walk(reads, 2);

    // Without the stop, "C" and "D" would be listed ahead of "B".
    expect(pages.flat()).toEqual(["B", "C", "D"]);
  });

  it("says there is no next page once every collection's matches are read and taken", async () => {
    const { reads } = readsOverTables({ pages: ["A", "B"].map(titled) });

    const answer = await readPagesSearch(request({ limit: 2 }), reads);

    expect(answer.meta.hasNext).toBe(false);
    expect(answer.meta).not.toHaveProperty("nextBefore");
  });
});

describe("where a page is served", () => {
  it("names a Pages item's path from where the host serves pages, and no other collection's", async () => {
    const withSlug = [
      { name: "title", type: "text" },
      { name: "slug", type: "text" },
      { name: "content", type: "blocks" },
    ];
    const { reads, find } = readsOver(
      [
        record("pages", { fields: withSlug }),
        record("posts", { fields: withSlug }),
      ],
      async args =>
        args.collection === "pages"
          ? rows([{ id: "p1", title: "Pricing", slug: "pricing" }])
          : rows([
              { id: "b1", title: "Pricing update", slug: "pricing-update" },
            ])
    );

    const answer = await readPagesSearch(request({ limit: 10 }), {
      ...reads,
      pagePath: () => "/{slug}",
    });

    expect(answer.items.find(item => item.id === "p1")?.path).toBe("/pricing");
    // A collection whose address is the host's own code has none to give.
    expect(answer.items.find(item => item.id === "b1")).not.toHaveProperty(
      "path"
    );
    // The slug is read only where a path is resolved from it.
    const select = (collection: string) =>
      (
        find.mock.calls.find(
          call => (call[0] as PagesFindArgs).collection === collection
        )?.[0] as PagesFindArgs | undefined
      )?.select;
    expect(select("pages")).toHaveProperty("slug", true);
    expect(select("posts")).not.toHaveProperty("slug");
  });

  it("reads every field the host's path names, and only declared ones", async () => {
    const { reads, find } = readsOver(
      [
        record("pages", {
          fields: [
            { name: "title", type: "text" },
            { name: "slug", type: "text" },
            { name: "noHeaderFooter", type: "text" },
            { name: "content", type: "blocks" },
          ],
        }),
      ],
      async () =>
        rows([
          {
            id: "p1",
            title: "Pricing",
            slug: "pricing",
            noHeaderFooter: "bare",
          },
        ])
    );

    const answer = await readPagesSearch(request({ limit: 10 }), {
      ...reads,
      pagePath: () => "/{noHeaderFooter}/{slug}/{ghost}",
    });

    const select = (find.mock.calls[0]?.[0] as PagesFindArgs).select;
    expect(select).toHaveProperty("noHeaderFooter", true);
    expect(select).toHaveProperty("slug", true);
    // A placeholder naming no field is never asked of the database.
    expect(select).not.toHaveProperty("ghost");
    expect(answer.items[0]).not.toHaveProperty("path");
  });

  it("names the path a template of several fields resolves to", async () => {
    const { reads } = readsOver(
      [
        record("pages", {
          fields: [
            { name: "title", type: "text" },
            { name: "slug", type: "text" },
            { name: "noHeaderFooter", type: "text" },
            { name: "content", type: "blocks" },
          ],
        }),
      ],
      async args =>
        rows([
          Object.fromEntries(
            Object.entries({
              id: "p1",
              title: "Pricing",
              slug: "pricing",
              noHeaderFooter: "bare",
            }).filter(([name]) => name === "id" || args.select[name] === true)
          ),
        ])
    );

    const answer = await readPagesSearch(request({ limit: 10 }), {
      ...reads,
      pagePath: () => "/{noHeaderFooter}/{slug}",
    });

    expect(answer.items[0]?.path).toBe("/bare/pricing");
  });

  it("gives no path where the host states none", async () => {
    const { reads } = readsOver([record("pages")], async () =>
      rows([{ id: "p1", title: "Pricing", slug: "pricing" }])
    );
    const answer = await readPagesSearch(request({ limit: 10 }), reads);
    expect(answer.items[0]).not.toHaveProperty("path");
  });
});

describe("listing by collection", () => {
  it("lists the plugin's Pages first, then the others by name, each in title order, across pages", async () => {
    // Titles that would interleave by title, so a merge by title cannot
    // produce this order: "A1" sorts first overall but its collection is not
    // Pages, and "B3"'s collection sorts after "landing" by name.
    const { reads } = readsOverTables({
      posts: ["B3"].map(titled),
      landing: ["A1", "C1"].map(titled),
      pages: ["D2", "E2", "F2"].map(titled),
    });

    const { pages, metas } = await walk(reads, 2, "collection");

    expect(pages).toEqual([
      ["D2", "E2"],
      ["F2", "A1"],
      ["C1", "B3"],
    ]);
    expect(metas.at(-1)?.hasNext).toBe(false);
  });

  it("stops at a collection whose bounded read ran out, so no later collection's page comes first", async () => {
    // Seven withheld rows ahead of "B" in Pages: the first page's bounded read
    // finds none of Pages' openable rows, and "A" must still wait for "B".
    const shut = (id: string) => ({ id, title: id });
    const { reads } = readsOverTables({
      pages: [
        ...["A0", "A1", "A2", "A3", "A4", "A5", "A6"].map(shut),
        titled("B"),
      ],
      landing: ["A"].map(titled),
    });

    const { pages } = await walk(reads, 2, "collection");

    expect(pages.flat()).toEqual(["B", "A"]);
  });
});

describe("where each page stands in publishing", () => {
  /** The ids a publishing-state read asked about. */
  const askedIds = (args: PagesFindArgs) =>
    ((args.where?.id as { in?: unknown } | undefined)?.in ?? []) as string[];

  const lifecycleRows = async () =>
    rows([
      { id: "d", title: "Draft page", status: "draft" },
      { id: "c", title: "Edited page", status: "published" },
      { id: "p", title: "Plain page", status: "published" },
      { id: "s", title: "Scheduled page", status: "published" },
    ]);

  it("calls a page draft, changed or scheduled by core's own workflow filters, and a plain published page nothing", async () => {
    const { reads, workflow } = readsOver(
      [record("pages", { status: true })],
      lifecycleRows,
      [],
      async args =>
        Object.hasOwn(args.where ?? {}, "_pendingChange")
          ? rows(
              askedIds(args)
                .filter(id => id === "c" || id === "s")
                .map(id => ({ id }))
            )
          : rows(
              askedIds(args)
                .filter(id => id === "s")
                .map(id => ({ id }))
            )
    );

    const answer = await readPagesSearch(request(), reads);

    expect(answer.items.map(item => [item.id, item.state])).toEqual([
      ["d", "draft"],
      ["c", "changed"],
      ["p", undefined],
      // A scheduled publish is what the author must know first.
      ["s", "scheduled"],
    ]);
    expect(answer.items[2]).not.toHaveProperty("state");
    // The pending changes are said apart from the state, which a schedule
    // takes over: "s" shows Scheduled and still holds them.
    expect(answer.items.map(item => [item.id, item.pendingChange])).toEqual([
      ["d", undefined],
      ["c", true],
      ["p", undefined],
      ["s", true],
    ]);
    // One read per filter, over the page's ids only, selecting only ids.
    expect(workflow.mock.calls.map(call => call[0])).toEqual([
      {
        collection: "pages",
        where: { id: { in: ["d", "c", "p", "s"] }, _pendingChange: true },
        select: { id: true },
        limit: 4,
      },
      {
        collection: "pages",
        where: { id: { in: ["d", "c", "p", "s"] }, _inRelease: true },
        select: { id: true },
        limit: 4,
      },
    ]);
  });

  it("reads nothing more, and says nothing, for a collection without the lifecycle", async () => {
    const { reads, workflow } = readsOver([record("landing")], async () =>
      rows([{ id: "l1", title: "Launch" }])
    );

    const answer = await readPagesSearch(request(), reads);

    expect(workflow).not.toHaveBeenCalled();
    expect(answer.items[0]).not.toHaveProperty("state");
  });

  it("tells a caller core refuses releases nothing about them, and warns no one", async () => {
    const { reads, warn } = readsOver(
      [record("pages", { status: true })],
      lifecycleRows,
      [],
      async args => {
        if (Object.hasOwn(args.where ?? {}, "_inRelease")) {
          throw NextlyError.validation({
            errors: [
              {
                path: "where._inRelease",
                code: "FILTER_UNKNOWN_FIELD",
                message: "x",
              },
            ],
          });
        }
        return rows([{ id: "c" }]);
      }
    );

    const answer = await readPagesSearch(request(), reads);

    expect(answer.items.map(item => item.state)).toEqual([
      "draft",
      "changed",
      undefined,
      undefined,
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the list when a state read fails, and tells the operator", async () => {
    const { reads, warn } = readsOver(
      [record("pages", { status: true })],
      lifecycleRows,
      [],
      async () => {
        throw new Error("versions table missing");
      }
    );

    const answer = await readPagesSearch(request(), reads);

    expect(answer.items).toHaveLength(4);
    expect(answer.items[0]?.state).toBe("draft");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("what a page write cannot supply", () => {
  /** A context whose registry holds just these records. */
  function over(records: Record<string, unknown>[]) {
    return {
      self: { collections: {} },
      services: {
        collections: {
          listCollections: async () => ({
            data: records,
            pagination: { hasMore: false },
          }),
        },
      },
    };
  }

  it("names the other required fields without a default, and an extra unique one", async () => {
    const fields = [
      { name: "title", type: "text", required: true },
      { name: "slug", type: "text", unique: true, required: true },
      { name: "content", type: "blocks" },
      { name: "seoTitle", type: "text", required: true },
      { name: "theme", type: "text", required: true, defaultValue: "light" },
      { name: "code", type: "text", unique: true },
    ];
    const found = await findPageCollection(
      over([record("pages", { fields })]),
      {},
      "pages"
    );
    // The title, slug and page field are what a write fills; a default fills
    // the theme. Only the SEO title is left for the entry's own form.
    expect(found?.needsMore).toEqual(["seoTitle"]);
    expect(found?.uncopyable).toBe(true);
  });

  it("finds nothing missing where a title, a slug and the page are enough", async () => {
    const found = await findPageCollection(
      over([record("pages")]),
      {},
      "pages"
    );
    expect(found?.needsMore).toBeUndefined();
    expect(found?.uncopyable).toBeUndefined();
  });
});

describe("one page's address", () => {
  const FIELDS = [
    { name: "title", type: "text" },
    { name: "slug", type: "text" },
    { name: "section", type: "text" },
    { name: "content", type: "blocks" },
  ];

  /** The search's reads over `records`, and the saved-page read recorded. */
  function addressReads(
    records: unknown[],
    saved: Record<string, unknown> | null
  ): { reads: PageAddressReads; readSaved: ReturnType<typeof vi.fn> } {
    const { reads } = readsOver(records, async () => rows([]));
    const readSaved = vi.fn(async () => saved);
    return { reads: { ...reads, readSaved }, readSaved };
  }

  it("resolves the saved page's path as the search does, reading only what it names", async () => {
    const { reads, readSaved } = addressReads(
      [record("pages", { fields: FIELDS })],
      { id: "p-1", title: "Pricing", slug: "pricing", section: "plans" }
    );

    const answer = await readPageAddress(
      { page: { collection: "pages", id: "p-1" }, locale: "fr" },
      { ...reads, pagePath: () => "/{section}/{slug}" }
    );

    expect(answer).toEqual({ path: "/plans/pricing" });
    expect(readSaved).toHaveBeenCalledWith({
      collection: "pages",
      id: "p-1",
      select: { id: true, section: true, slug: true },
      locale: "fr",
    });
  });

  it("has none for another collection's page, nor where the host states no path", async () => {
    const { reads, readSaved } = addressReads(
      [
        record("pages", { fields: FIELDS }),
        record("landing", { fields: FIELDS }),
      ],
      { id: "l-1", title: "Promo", slug: "promo" }
    );

    await expect(
      readPageAddress(
        { page: { collection: "landing", id: "l-1" } },
        { ...reads, pagePath: () => "/{slug}" }
      )
    ).resolves.toEqual({ path: null });
    await expect(
      readPageAddress({ page: { collection: "pages", id: "p-1" } }, reads)
    ).resolves.toEqual({ path: null });
    // Neither is read: there is no address to make.
    expect(readSaved).not.toHaveBeenCalled();
  });

  it("has none for a page the caller cannot read, or one with no slug yet", async () => {
    const gone = addressReads([record("pages", { fields: FIELDS })], null);
    await expect(
      readPageAddress(
        { page: { collection: "pages", id: "gone" } },
        { ...gone.reads, pagePath: () => "/{slug}" }
      )
    ).resolves.toEqual({ path: null });

    const unslugged = addressReads([record("pages", { fields: FIELDS })], {
      id: "p-2",
      title: "Draft",
    });
    await expect(
      readPageAddress(
        { page: { collection: "pages", id: "p-2" } },
        { ...unslugged.reads, pagePath: () => "/{slug}" }
      )
    ).resolves.toEqual({ path: null });
  });

  it("reads the client's path at the boundary, and refuses a page it does not name", () => {
    const written = pageAddressPath({ collection: "pages", id: "p:1" }, "fr");
    expect(parsePageAddressQuery(`http://nextly.test${written}`)).toEqual({
      page: { collection: "pages", id: "p:1" },
      locale: "fr",
    });
    expect(() =>
      parsePageAddressQuery("http://nextly.test/pages/address?collection=pages")
    ).toThrow();
  });
});
