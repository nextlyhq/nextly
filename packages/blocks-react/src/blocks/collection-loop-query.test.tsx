// @vitest-environment jsdom

/**
 * A collection list's stored query, as the renderer reads it: filters, sort
 * keys and a window sent to the page's data source, the empty state when
 * nothing matches, what an author is told when a read fails or a sort falls
 * back, and lists of a relation's entries, in the relation's stored order.
 *
 * Drawn through the real `PageRenderer` and core blocks, against a data
 * source that records what it was asked and answers like the public reader:
 * filters, `in` and the id order, in the database's own order otherwise.
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  BlocksDataProvider,
  BlocksFilter,
  BlocksQuery,
  PageContext,
} from "../context";
import { LIST_ACTION_ATTRIBUTE } from "../editor-markers";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { coreBlocks } from "./index";
import { dayStartIn, listEntryCount } from "./list-read";

const node = (
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  slots?: Record<string, BlockNode[]>
): BlockNode =>
  ({
    id,
    type,
    version: 1,
    props,
    ...(slots === undefined ? {} : { slots }),
  }) as BlockNode;

/** A heading bound to the list item's title, so each entry shows its own. */
const itemTitle = (id: string): BlockNode =>
  ({
    id,
    type: "core/heading",
    version: 1,
    props: { text: "?", level: "h3" },
    bindings: { text: { $bind: "title", source: "item" } },
  }) as BlockNode;

const emptyText = node("none", "core/heading", {
  text: "Nothing here yet",
  level: "h3",
});

function list(
  props: Record<string, unknown>,
  children: BlockNode[] = [itemTitle("t")],
  empty: BlockNode[] = [emptyText]
): BlockNode {
  return node("list", "core/collection-loop", props, { children, empty });
}

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

type Row = Record<string, unknown>;

/** Whether a row meets one reader filter, as the database would judge it. */
function meets(row: Row, filter: BlocksFilter): boolean {
  const value = row[filter.field];
  const wanted = filter.value;
  switch (filter.op) {
    case "in":
      return Array.isArray(wanted) && wanted.some(item => item === value);
    case "equals":
      return value === wanted;
    case "gte":
      return String(value) >= String(wanted);
    case "lt":
      return String(value) < String(wanted);
    default:
      return true;
  }
}

/** A source over fixed rows per collection, recording each query. */
function source(rows: Record<string, Row[]>): {
  provider: BlocksDataProvider;
  queries: BlocksQuery[];
} {
  const queries: BlocksQuery[] = [];
  return {
    queries,
    provider: {
      find: query => {
        queries.push(query);
        const matching = (rows[query.collection] ?? []).filter(row =>
          (query.filters ?? []).every(filter => meets(row, filter))
        );
        const start = query.offset ?? 0;
        // A selection keeps the id and the named fields a row has, as the
        // reader does: a field the public may not read is not on the row.
        const select = query.select;
        const shaped =
          select === undefined || select.length === 0
            ? matching
            : matching.map(row =>
                Object.fromEntries(
                  Object.entries(row).filter(
                    ([name]) => name === "id" || select.includes(name)
                  )
                )
              );
        return Promise.resolve({
          items: shaped.slice(start, start + (query.limit ?? 10)),
        });
      },
    },
  };
}

function context(overrides: Partial<PageContext>): PageContext {
  return {
    entry: null,
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
    ...overrides,
  };
}

async function drawn(
  document: BlockDocument,
  ctx: PageContext
): Promise<HTMLElement> {
  const stream = await renderToReadableStream(
    <PageRenderer
      document={document}
      blocks={createBlockResolver(coreBlocks)}
      context={ctx}
      bindings={{}}
    />,
    {
      onError(error: unknown) {
        throw error;
      },
    }
  );
  await stream.allReady;
  const host = window.document.createElement("div");
  host.innerHTML = await new Response(stream).text();
  return host;
}

function headings(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("h3")).map(
    heading => heading.textContent ?? ""
  );
}

function note(host: HTMLElement): Element | null {
  return host.querySelector("[data-nx-list-diagnostic]");
}

const POSTS: Row[] = [
  { id: "p1", title: "One" },
  { id: "p2", title: "Two" },
  { id: "p3", title: "Three" },
];

describe("a collection list's query, rendered", () => {
  it("sends its filters, sort keys and window to the reader, and draws each entry", async () => {
    const { provider, queries } = source({ posts: POSTS });
    const host = await drawn(
      page(
        list({
          collection: "posts",
          filters: [
            { field: "title", op: "contains", value: "o" },
            { field: "rank", op: "greater_than", value: 2 },
            { field: "tags", op: "not_in", value: ["a", "b"] },
            { field: "author", op: "exists", value: true },
          ],
          sort: "-publishedAt,title",
          limit: 2,
          offset: 1,
        })
      ),
      context({ data: provider })
    );
    expect(queries).toEqual([
      {
        collection: "posts",
        filters: [
          { field: "title", op: "contains", value: "o" },
          { field: "rank", op: "gt", value: 2 },
          { field: "tags", op: "not_in", value: ["a", "b"] },
          { field: "author", op: "exists", value: true },
        ],
        sort: "-publishedAt,title",
        limit: 2,
        offset: 1,
      },
    ]);
    expect(headings(host)).toEqual(["Two", "Three"]);
  });

  it("draws its empty state when nothing matches, and no entry", async () => {
    const { provider } = source({ posts: [] });
    const host = await drawn(
      page(list({ collection: "posts" })),
      context({ data: provider })
    );
    expect(headings(host)).toEqual(["Nothing here yet"]);
    expect(note(host)).toBeNull();
  });

  describe("a read that fails", () => {
    const failing: BlocksDataProvider = {
      find: () => Promise.reject(new Error("connection refused")),
    };

    it("shows visitors the empty state and nothing about why on a published page", async () => {
      const host = await drawn(
        page(list({ collection: "posts" })),
        context({ data: failing })
      );
      expect(headings(host)).toEqual(["Nothing here yet"]);
      expect(note(host)).toBeNull();
      expect(host.textContent).not.toContain("connection refused");
    });

    it("tells an author in the editor or a preview what failed, above the empty state", async () => {
      const host = await drawn(
        page(list({ collection: "posts" })),
        context({ data: failing, diagnostics: true })
      );
      expect(headings(host)).toEqual(["Nothing here yet"]);
      expect(note(host)?.getAttribute("data-nx-list-diagnostic")).toBe(
        "query-failed"
      );
      expect(note(host)?.textContent).toContain("connection refused");
      expect(note(host)?.textContent).toContain("Only you see this message.");
    });

    it("does not read a stored filter row it cannot read, and says so", async () => {
      const { provider, queries } = source({ posts: POSTS });
      const host = await drawn(
        page(
          list({
            collection: "posts",
            filters: [{ field: "title", op: "like", value: "o" }],
          })
        ),
        context({ data: provider, diagnostics: true })
      );
      expect(queries).toEqual([]);
      expect(headings(host)).toEqual(["Nothing here yet"]);
      expect(note(host)?.textContent).toContain('"like"');
    });
  });

  it("lists in id order when its stored sort names a protected field, and tells an author", async () => {
    // A list stored before sorts were judged at save: its sort names a field
    // whose read rule now denies the public, which the reader refuses.
    const queries: BlocksQuery[] = [];
    const reader: BlocksDataProvider = {
      find: query => {
        queries.push(query);
        if (query.sort !== undefined && query.sort.length > 0) {
          return Promise.reject(
            Object.assign(new Error("Validation failed."), {
              code: "VALIDATION_ERROR",
              publicData: {
                errors: [
                  { path: "sort.internalScore", code: "FIELD_NOT_SORTABLE" },
                ],
              },
            })
          );
        }
        return Promise.resolve({ items: POSTS });
      },
    };
    const stored = page(list({ collection: "posts", sort: "-internalScore" }));
    const published = await drawn(stored, context({ data: reader }));
    expect(headings(published)).toEqual(["One", "Two", "Three"]);
    expect(note(published)).toBeNull();
    expect(queries.map(query => query.sort)).toEqual(["-internalScore", []]);

    const editing = await drawn(
      stored,
      context({ data: reader, diagnostics: true })
    );
    expect(headings(editing)).toEqual(["One", "Two", "Three"]);
    expect(note(editing)?.getAttribute("data-nx-list-diagnostic")).toBe(
      "sort-fallback"
    );
    expect(note(editing)?.textContent).toContain('"internalScore"');
    expect(note(editing)?.textContent).toContain("ID order");
  });

  it("offers one action, on a fallen-back sort's note, only where the editor can act on it", async () => {
    const refusing: BlocksDataProvider = {
      find: query =>
        query.sort !== undefined && query.sort.length > 0
          ? Promise.reject(
              Object.assign(new Error("Validation failed."), {
                code: "VALIDATION_ERROR",
                publicData: {
                  errors: [{ path: "sort.rating", code: "FIELD_NOT_SORTABLE" }],
                },
              })
            )
          : Promise.resolve({ items: POSTS }),
    };
    const stored = page(list({ collection: "posts", sort: "-rating" }));
    const action = (host: HTMLElement) =>
      note(host)?.querySelectorAll(`[${LIST_ACTION_ATTRIBUTE}]`) ?? [];
    // On the editor's canvas: one button, naming what it does.
    const canvas = await drawn(
      stored,
      context({ data: refusing, diagnostics: true, listNoteActions: true })
    );
    expect([...action(canvas)].map(each => each.outerHTML)).toEqual([
      `<button type="button" ${LIST_ACTION_ATTRIBUTE}="choose-sort-field">Choose a field</button>`,
    ]);
    // In a preview, where nothing could act on it, the note is words alone.
    const preview = await drawn(
      stored,
      context({ data: refusing, diagnostics: true })
    );
    expect(note(preview)).not.toBeNull();
    expect(action(preview)).toHaveLength(0);
    // A failed read's note stays words alone, even on the canvas.
    const failing: BlocksDataProvider = {
      find: () => Promise.reject(new Error("The database is away.")),
    };
    const failed = await drawn(
      page(list({ collection: "posts" })),
      context({ data: failing, diagnostics: true, listNoteActions: true })
    );
    expect(note(failed)?.getAttribute("data-nx-list-diagnostic")).toBe(
      "query-failed"
    );
    expect(action(failed)).toHaveLength(0);
  });

  describe("a date filter compares whole days", () => {
    const after = (field: string) =>
      list({
        collection: "posts",
        filters: [{ field, op: "greater_than", value: "2026-09-01" }],
      });

    it("in the site's time zone for a field holding an instant", async () => {
      const { provider, queries } = source({ posts: [] });
      await drawn(
        page(after("publishedAt")),
        context({ data: provider, timeZone: "Asia/Karachi" })
      );
      // After the 1st is from the start of the 2nd in Karachi, UTC+5.
      expect(queries[0]?.filters).toEqual([
        { field: "publishedAt", op: "gte", value: "2026-09-01T19:00:00.000Z" },
      ]);
    });

    it("as the day itself for a field holding a calendar day", async () => {
      const { provider, queries } = source({ posts: [] });
      await drawn(
        page(after("eventDay")),
        context({
          data: provider,
          timeZone: "Asia/Karachi",
          fieldShapes: {
            fieldsOf: () => [
              { name: "eventDay", type: "date", dateOnly: true },
            ],
          },
        })
      );
      expect(queries[0]?.filters).toEqual([
        { field: "eventDay", op: "gte", value: "2026-09-02T00:00:00.000Z" },
      ]);
    });

    it("compares a day-shaped value on a field not holding a date as stored", async () => {
      // A text field's value spelled like a day is text: it is not moved to
      // the start of a day in the site's zone.
      const { provider, queries } = source({ posts: [] });
      await drawn(
        page(
          list({
            collection: "posts",
            filters: [
              { field: "code", op: "greater_than", value: "2026-09-01" },
            ],
          })
        ),
        context({
          data: provider,
          timeZone: "Asia/Karachi",
          fieldShapes: {
            fieldsOf: () => [{ name: "code", type: "text" }],
          },
        })
      );
      expect(queries[0]?.filters).toEqual([
        { field: "code", op: "gt", value: "2026-09-01" },
      ]);
    });

    it("finds each day's start on a day the clocks change", () => {
      // New York springs forward on 8 March 2026: that day starts at UTC-5,
      // the next at UTC-4.
      expect(dayStartIn("2026-03-08", "America/New_York")).toBe(
        "2026-03-08T05:00:00.000Z"
      );
      expect(dayStartIn("2026-03-09", "America/New_York")).toBe(
        "2026-03-09T04:00:00.000Z"
      );
      // Santiago changes its clocks at local midnight. On 6 September 2026
      // midnight never happens, so the day starts at 01:00 (UTC-3); on 5
      // April 2026 the clocks go back from midnight to 23:00 the day before,
      // so the day starts at the later midnight (UTC-4).
      expect(dayStartIn("2026-09-06", "America/Santiago")).toBe(
        "2026-09-06T04:00:00.000Z"
      );
      expect(dayStartIn("2026-04-05", "America/Santiago")).toBe(
        "2026-04-05T04:00:00.000Z"
      );
    });
  });

  describe("a related source", () => {
    const CATEGORIES: Row[] = [
      { id: "c1", title: "Alpha", kind: "topic" },
      { id: "c2", title: "Beta", kind: "topic" },
      { id: "c3", title: "Gamma", kind: "series" },
      { id: "c4", title: "Delta", kind: "topic" },
    ];

    /** A post-related list, the categories of the page's entry. */
    const postCategories = (props: Record<string, unknown> = {}) =>
      page(
        list({
          collection: "categories",
          relation: { of: "entry", field: "categories" },
          ...props,
        })
      );

    /**
     * A page showing post `p1`: the route's own read of it, and the source,
     * which holds the post as the public reads it. The two agree unless a
     * test says otherwise.
     */
    function postPage(
      categories: unknown[],
      overrides: { publicPost?: Row; ctx?: Partial<PageContext> } = {}
    ) {
      const read = source({
        posts: [
          overrides.publicPost ?? { id: "p1", title: "Post", categories },
        ],
        categories: CATEGORIES,
      });
      return {
        ...read,
        ctx: context({
          data: read.provider,
          entry: { id: "p1", title: "Post", categories },
          entryCollection: "posts",
          ...overrides.ctx,
        }),
      };
    }

    /** The reads made of the related collection, not of the entry. */
    const relatedReads = (queries: readonly BlocksQuery[]) =>
      queries.filter(query => query.collection === "categories");

    it("lists a post's categories in the order the post stores them", async () => {
      const { ctx, queries } = postPage(["c4", "c1", { id: "c2" }, "c1"]);
      const host = await drawn(postCategories(), ctx);
      expect(headings(host)).toEqual(["Delta", "Alpha", "Beta"]);
      // The relation is read as the public reads the post: by id, with only
      // the relation field, before the related entries are.
      expect(queries[0]).toEqual({
        collection: "posts",
        filters: [{ field: "id", op: "equals", value: "p1" }],
        select: ["categories"],
        limit: 1,
      });
      expect(relatedReads(queries)[0]?.filters).toEqual([
        { field: "id", op: "in", value: ["c4", "c1", "c2"] },
      ]);
    });

    it("reads the relation as the public sees it, not as the route's entry holds it", async () => {
      const { ctx, queries } = postPage(["c1", "c2"], {
        publicPost: { id: "p1", title: "Post", categories: ["c3"] },
      });
      const host = await drawn(postCategories(), ctx);
      expect(headings(host)).toEqual(["Gamma"]);
      expect(relatedReads(queries)[0]?.filters).toEqual([
        { field: "id", op: "in", value: ["c3"] },
      ]);
    });

    it("draws the empty state when the public may not read the relation, reading none of the route's ids", async () => {
      // The route's entry carries the relation; the public's read of the
      // post comes back without it, as a field visitors may not read does.
      const { ctx, queries } = postPage(["c1", "c2"], {
        publicPost: { id: "p1", title: "Post" },
      });
      const host = await drawn(postCategories(), ctx);
      expect(headings(host)).toEqual(["Nothing here yet"]);
      expect(relatedReads(queries)).toEqual([]);
      expect(note(host)).toBeNull();

      const author = postPage(["c1", "c2"], {
        publicPost: { id: "p1", title: "Post" },
        ctx: { diagnostics: true },
      });
      const shown = await drawn(postCategories(), author.ctx);
      expect(headings(shown)).toEqual(["Nothing here yet"]);
      expect(note(shown)?.getAttribute("data-nx-list-diagnostic")).toBe(
        "query-failed"
      );
      expect(note(shown)?.textContent).toContain('"categories"');
      expect(relatedReads(author.queries)).toEqual([]);
    });

    it("draws the empty state when the public may not read the entry at all", async () => {
      const read = source({ posts: [], categories: CATEGORIES });
      const host = await drawn(
        postCategories(),
        context({
          data: read.provider,
          entry: { id: "p1", categories: ["c1"] },
          entryCollection: "posts",
          diagnostics: true,
        })
      );
      expect(headings(host)).toEqual(["Nothing here yet"]);
      expect(note(host)?.getAttribute("data-nx-list-diagnostic")).toBe(
        "query-failed"
      );
      expect(relatedReads(read.queries)).toEqual([]);
    });

    it("tells the author a page that is no entry has no related entries to show", async () => {
      // A Single's page: no entry for the relation to be read from.
      const read = source({ categories: CATEGORIES });
      const host = await drawn(
        postCategories(),
        context({ data: read.provider, entry: null, diagnostics: true })
      );
      expect(headings(host)).toEqual(["Nothing here yet"]);
      expect(note(host)?.textContent).toBe(
        "This list couldn't load its entries, so visitors see its empty state. This page isn't an entry in a collection, so it has no related entries to show. Only you see this message."
      );
      expect(read.queries).toEqual([]);
    });

    it("reads nothing of a relation whose entry's collection it is not told", async () => {
      const read = source({ categories: CATEGORIES });
      const host = await drawn(
        postCategories(),
        context({
          data: read.provider,
          entry: { id: "p1", categories: ["c1"] },
          diagnostics: true,
        })
      );
      expect(headings(host)).toEqual(["Nothing here yet"]);
      expect(note(host)?.getAttribute("data-nx-list-diagnostic")).toBe(
        "query-failed"
      );
      expect(read.queries).toEqual([]);
    });

    it("claims the relation's read from the page's allowance", async () => {
      // One read left: the list's own, so the relation's is refused and no
      // related entry is read.
      let left = 1;
      const { ctx, queries } = postPage(["c1"], {
        ctx: { queries: { take: () => left-- > 0 } },
      });
      const host = await drawn(postCategories(), ctx);
      expect(headings(host)).toEqual(["Nothing here yet"]);
      expect(queries).toEqual([]);
    });

    it("applies filters, then the offset and limit, to the stored order", async () => {
      const { ctx } = postPage(["c3", "c4", "c2", "c1"]);
      const host = await drawn(
        postCategories({
          filters: [{ field: "kind", op: "equals", value: "topic" }],
          offset: 1,
          limit: 1,
        }),
        ctx
      );
      // Topics in stored order are Delta, Beta, Alpha: skip one, show one.
      expect(headings(host)).toEqual(["Beta"]);
    });

    it("orders by a sort when one is set, in the reader", async () => {
      const { ctx, queries } = postPage(["c2"]);
      await drawn(postCategories({ sort: "title", offset: 1 }), ctx);
      expect(relatedReads(queries)[0]).toMatchObject({
        sort: "title",
        offset: 1,
        filters: [{ field: "id", op: "in", value: ["c2"] }],
      });
    });

    describe("with more related entries than one read takes", () => {
      /** 250 entries whose titles repeat, so ties are broken by the id. */
      const MANY: Row[] = Array.from({ length: 250 }, (_, index) => ({
        id: `c${String(index).padStart(3, "0")}`,
        title: `T${String((index * 37) % 60).padStart(2, "0")}`,
        kind: index % 3 === 0 ? "series" : "topic",
      }));

      /** The order a reader sorts in: each key, then the id. */
      const ordered = (rows: readonly Row[], sort: string): Row[] => {
        const keys = sort === "" ? [] : sort.split(",");
        const compare = (a: Row, b: Row): number => {
          for (const key of [...keys, "id"]) {
            const field = key.replace(/^-/, "");
            const sign = key.startsWith("-") ? -1 : 1;
            const left = String(a[field]);
            const right = String(b[field]);
            if (left !== right) return left < right ? -sign : sign;
          }
          return 0;
        };
        return [...rows].sort(compare);
      };

      /**
       * A source that sorts and windows as the reader does, and refuses an
       * `in` row or a page of more than 100, as the list entries route does.
       */
      function boundedSource(): {
        provider: BlocksDataProvider;
        queries: BlocksQuery[];
      } {
        const queries: BlocksQuery[] = [];
        const rows: Record<string, Row[]> = {
          posts: [{ id: "p1", title: "Post", categories: [] }],
          categories: MANY,
        };
        return {
          queries,
          provider: {
            find: query => {
              queries.push(query);
              const ins = (query.filters ?? []).filter(row => row.op === "in");
              if (
                (query.limit ?? 10) > 100 ||
                ins.some(
                  row => Array.isArray(row.value) && row.value.length > 100
                )
              ) {
                return Promise.reject(
                  Object.assign(new Error("Too many values."), {
                    code: "VALIDATION_ERROR",
                  })
                );
              }
              const matching = (rows[query.collection] ?? []).filter(row =>
                (query.filters ?? []).every(filter => meets(row, filter))
              );
              const sort = typeof query.sort === "string" ? query.sort : "";
              const start = query.offset ?? 0;
              return Promise.resolve({
                items: ordered(matching, sort).slice(
                  start,
                  start + (query.limit ?? 10)
                ),
              });
            },
          },
        };
      }

      /** A post page whose public read holds every one of MANY's ids, shuffled. */
      function manyPage(read: ReturnType<typeof boundedSource>): PageContext {
        const stored = MANY.map(row => row.id).sort((a, b) =>
          String(a).split("").reverse().join("") <
          String(b).split("").reverse().join("")
            ? -1
            : 1
        );
        const post = read.provider;
        return context({
          data: {
            find: query =>
              query.collection === "posts"
                ? Promise.resolve({
                    items: [{ id: "p1", categories: stored }],
                  })
                : post.find(query),
          },
          entry: { id: "p1" },
          entryCollection: "posts",
          diagnostics: true,
        });
      }

      const titles = (rows: readonly Row[]) =>
        rows.map(row => String(row.title));

      it.each([
        ["title", 40, 30],
        ["-title", 0, 7],
        ["kind,-title", 90, 20],
        ["title", 230, 100],
      ])(
        "sorts by %s across every read, then skips %i and shows %i",
        async (sort, offset, limit) => {
          const read = boundedSource();
          const host = await drawn(
            postCategories({ sort, offset, limit }),
            manyPage(read)
          );
          expect(note(host)).toBeNull();
          expect(headings(host)).toEqual(
            titles(ordered(MANY, sort).slice(offset, offset + limit))
          );
          for (const query of relatedReads(read.queries)) {
            expect(query.limit ?? 10).toBeLessThanOrEqual(100);
          }
        }
      );

      it("applies its filters before the window", async () => {
        const read = boundedSource();
        const host = await drawn(
          postCategories({
            sort: "-title",
            filters: [{ field: "kind", op: "equals", value: "series" }],
            offset: 5,
            limit: 10,
          }),
          manyPage(read)
        );
        const series = MANY.filter(row => row.kind === "series");
        expect(headings(host)).toEqual(
          titles(ordered(series, "-title").slice(5, 15))
        );
      });

      it("claims each read after the first from the page's allowance", async () => {
        const read = boundedSource();
        let left = 3;
        const host = await drawn(postCategories({ sort: "title", limit: 5 }), {
          ...manyPage(read),
          queries: { take: () => left-- > 0 },
        });
        // The list's read and the relation's are claimed; the related
        // entries take more than the one left, so the list says it failed.
        expect(headings(host)).toEqual(["Nothing here yet"]);
        expect(note(host)?.getAttribute("data-nx-list-diagnostic")).toBe(
          "query-failed"
        );
        expect(note(host)?.textContent).toContain("used up the reads");
      });
    });

    it("shows each post's categories inside a list of posts, from the rows the list read", async () => {
      const { provider, queries } = source({
        posts: [
          { id: "p1", title: "First post", categories: ["c2", "c1"] },
          { id: "p2", title: "Second post", categories: ["c3"] },
        ],
        categories: CATEGORIES,
      });
      const host = await drawn(
        page(
          node(
            "posts",
            "core/collection-loop",
            { collection: "posts" },
            {
              children: [
                itemTitle("post-title"),
                node(
                  "cats",
                  "core/collection-loop",
                  {
                    collection: "categories",
                    relation: { of: "item", field: "categories" },
                  },
                  { children: [itemTitle("cat-title")] }
                ),
              ],
            }
          )
        ),
        context({ data: provider })
      );
      expect(headings(host)).toEqual([
        "First post",
        "Beta",
        "Alpha",
        "Second post",
        "Gamma",
      ]);
      // The outer list's rows are already the public's, so no post is read
      // again for its relation.
      expect(
        queries.filter(query => query.collection === "posts")
      ).toHaveLength(1);
    });

    it("draws the empty state, reading no related entry, when the relation holds none", async () => {
      const { ctx, queries } = postPage([]);
      const host = await drawn(postCategories(), ctx);
      expect(relatedReads(queries)).toEqual([]);
      expect(headings(host)).toEqual(["Nothing here yet"]);
    });

    it("fails, and says so, when there is no item to read the relation of", async () => {
      const { provider } = source({ categories: CATEGORIES });
      const host = await drawn(
        page(
          list({
            collection: "categories",
            relation: { of: "item", field: "categories" },
          })
        ),
        context({ data: provider, diagnostics: true })
      );
      expect(headings(host)).toEqual(["Nothing here yet"]);
      expect(note(host)?.getAttribute("data-nx-list-diagnostic")).toBe(
        "query-failed"
      );
    });
  });
});

describe("a list's empty state, as an author looks at it", () => {
  it("draws the empty state alone, reading nothing, when the author chose to see it", async () => {
    const { provider, queries } = source({ posts: POSTS });
    const host = await drawn(
      page(list({ collection: "posts" })),
      context({
        data: provider,
        diagnostics: true,
        listsShowingEmpty: new Set(["list"]),
      })
    );
    expect(headings(host)).toEqual(["Nothing here yet"]);
    expect(queries).toEqual([]);
    const marked = host.querySelector("[data-nx-list-shows]");
    expect(marked?.getAttribute("data-nx-list-shows")).toBe("empty");
    expect(marked?.getAttribute("data-nx-list-empty-because")).toBe("chosen");
  });

  it("never hides a published page's entries, whatever the context names", async () => {
    const { provider } = source({ posts: POSTS });
    const host = await drawn(
      page(list({ collection: "posts" })),
      context({ data: provider, listsShowingEmpty: new Set(["list"]) })
    );
    expect(headings(host)).toEqual(["One", "Two", "Three"]);
    expect(host.querySelector("[data-nx-list-shows]")).toBeNull();
  });

  it("says why it draws its empty state: nothing matched, or the read failed", async () => {
    const { provider } = source({ posts: [] });
    const none = await drawn(
      page(list({ collection: "posts" })),
      context({ data: provider, diagnostics: true })
    );
    expect(
      none
        .querySelector("[data-nx-list-shows]")
        ?.getAttribute("data-nx-list-empty-because")
    ).toBe("none");
    const failed = await drawn(
      page(list({ collection: "posts" })),
      context({
        data: { find: () => Promise.reject(new Error("down")) },
        diagnostics: true,
      })
    );
    expect(
      failed
        .querySelector("[data-nx-list-shows]")
        ?.getAttribute("data-nx-list-empty-because")
    ).toBe("failed");
  });

  it("marks nothing on a list showing its entries, or for a visitor", async () => {
    const { provider } = source({ posts: POSTS });
    const shown = await drawn(
      page(list({ collection: "posts" })),
      context({ data: provider, diagnostics: true })
    );
    expect(shown.querySelector("[data-nx-list-shows]")).toBeNull();
    const visitor = await drawn(
      page(list({ collection: "posts" })),
      context({ data: source({ posts: [] }).provider })
    );
    expect(headings(visitor)).toEqual(["Nothing here yet"]);
    expect(visitor.querySelector("[data-nx-list-shows]")).toBeNull();
  });
});

describe("a list's count, for the editor", () => {
  /** A source that answers with the total of what matched, as the reader does. */
  function counting(rows: Row[]) {
    const read = source({ posts: rows });
    return {
      queries: read.queries,
      provider: {
        find: async (query: BlocksQuery) => {
          const answer = await read.provider.find(query);
          const total = rows.filter(row =>
            (query.filters ?? []).every(filter => meets(row, filter))
          ).length;
          return { ...answer, total };
        },
      } satisfies BlocksDataProvider,
    };
  }

  it("counts from the very read the list makes, sort and window included", async () => {
    const props = {
      collection: "posts",
      filters: [
        { field: "title", op: "contains", value: "o" },
        { field: "publishedAt", op: "greater_than", value: "2026-09-01" },
      ],
      sort: "-title",
      limit: 2,
      offset: 1,
    };
    const ctx = context({ timeZone: "Asia/Karachi", locale: "fr" });
    const drawnRead = counting(POSTS);
    await drawn(page(list(props)), { ...ctx, data: drawnRead.provider });
    const counted = counting(POSTS);
    await listEntryCount(props, ctx, counted.provider);
    // The same query, so a provider keeping its answers counts the rows it
    // drew rather than reading again.
    expect(counted.queries).toEqual(drawnRead.queries);
  });

  it("shows what the window leaves of the matching entries, never fewer than none", async () => {
    const ten = Array.from({ length: 10 }, (_, index) => ({
      id: `p${String(index)}`,
      title: "Post",
    }));
    const count = (props: Record<string, unknown>) =>
      listEntryCount(
        { collection: "posts", ...props },
        context({}),
        counting(ten).provider
      );
    await expect(count({ offset: 2, limit: 3 })).resolves.toEqual({
      matching: 10,
      shown: 3,
    });
    await expect(count({ offset: 8, limit: 3 })).resolves.toEqual({
      matching: 10,
      shown: 2,
    });
    await expect(count({ offset: 12, limit: 3 })).resolves.toEqual({
      matching: 10,
      shown: 0,
    });
    // No limit stored is the list's own default.
    await expect(count({})).resolves.toEqual({ matching: 10, shown: 10 });
  });

  it("makes no count where the list's read cannot answer it", async () => {
    const { provider, queries } = counting(POSTS);
    // A related source's ids are read first, and no collection is no list.
    for (const props of [
      { collection: "posts", relation: { of: "entry", field: "related" } },
      { collection: " " },
      {
        collection: "posts",
        filters: [{ field: "title", op: "like", value: "o" }],
      },
    ]) {
      await expect(
        listEntryCount(props, context({}), provider)
      ).resolves.toBeUndefined();
    }
    expect(queries).toEqual([]);
    // A provider that gives no total says nothing to count by.
    await expect(
      listEntryCount(
        { collection: "posts" },
        context({}),
        source({ posts: POSTS }).provider
      )
    ).resolves.toBeUndefined();
  });

  it("counts by the id order the list falls back to when its sort is refused", async () => {
    const queries: BlocksQuery[] = [];
    const provider: BlocksDataProvider = {
      find: query => {
        queries.push(query);
        return query.sort === "internalScore"
          ? Promise.reject(
              Object.assign(new Error("Not sortable."), {
                code: "INVALID_INPUT",
              })
            )
          : Promise.resolve({ items: POSTS, total: 3 });
      },
    };
    await expect(
      listEntryCount(
        { collection: "posts", sort: "internalScore" },
        context({}),
        provider
      )
    ).resolves.toEqual({ matching: 3, shown: 3 });
    expect(queries.map(query => query.sort)).toEqual(["internalScore", []]);
  });
});
