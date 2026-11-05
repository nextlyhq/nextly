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
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { coreBlocks } from "./index";
import { dayStartIn } from "./list-read";

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
        return Promise.resolve({
          items: matching.slice(start, start + (query.limit ?? 10)),
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

    it("lists a post's categories in the order the post stores them", async () => {
      const { provider, queries } = source({ categories: CATEGORIES });
      const host = await drawn(
        page(
          list({
            collection: "categories",
            relation: { of: "entry", field: "categories" },
          })
        ),
        context({
          data: provider,
          entry: { id: "p1", categories: ["c4", "c1", { id: "c2" }, "c1"] },
        })
      );
      expect(headings(host)).toEqual(["Delta", "Alpha", "Beta"]);
      expect(queries[0]?.filters).toEqual([
        { field: "id", op: "in", value: ["c4", "c1", "c2"] },
      ]);
    });

    it("applies filters, then the offset and limit, to the stored order", async () => {
      const { provider } = source({ categories: CATEGORIES });
      const host = await drawn(
        page(
          list({
            collection: "categories",
            relation: { of: "entry", field: "categories" },
            filters: [{ field: "kind", op: "equals", value: "topic" }],
            offset: 1,
            limit: 1,
          })
        ),
        context({
          data: provider,
          entry: { id: "p1", categories: ["c3", "c4", "c2", "c1"] },
        })
      );
      // Topics in stored order are Delta, Beta, Alpha: skip one, show one.
      expect(headings(host)).toEqual(["Beta"]);
    });

    it("orders by a sort when one is set, in the reader", async () => {
      const { provider, queries } = source({ categories: CATEGORIES });
      await drawn(
        page(
          list({
            collection: "categories",
            relation: { of: "entry", field: "categories" },
            sort: "title",
            offset: 1,
          })
        ),
        context({ data: provider, entry: { id: "p1", categories: ["c2"] } })
      );
      expect(queries[0]).toMatchObject({
        sort: "title",
        offset: 1,
        filters: [{ field: "id", op: "in", value: ["c2"] }],
      });
    });

    it("shows each post's categories inside a list of posts", async () => {
      const { provider } = source({
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
    });

    it("draws the empty state, reading nothing, when the relation holds none", async () => {
      const { provider, queries } = source({ categories: CATEGORIES });
      const host = await drawn(
        page(
          list({
            collection: "categories",
            relation: { of: "entry", field: "categories" },
          })
        ),
        context({ data: provider, entry: { id: "p1", categories: [] } })
      );
      expect(queries).toEqual([]);
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
