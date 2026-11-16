// @vitest-environment jsdom

/**
 * A list split into pages, rendered: which entries each page shows, and the
 * links between pages.
 *
 * What separates a correct list from a plausible broken one:
 *
 * - page `n` shows the entries from `offset + (n - 1) × limit`, the stored
 *   offset applied once, through a window the read itself moves, so a
 *   provider that knows nothing of page numbers still reads the right rows;
 * - only the list the route names is paged: a second list split into pages
 *   shows its first page and draws no links;
 * - the links name the route's addresses, mark the current page, and leave
 *   out what leads nowhere (previous on page 1, next on the last);
 * - a list with one page, or a read that failed, draws no links;
 * - a list whose source is a named query is paged the same way: its run is
 *   asked for the page's window, its links are counted from the run's total,
 *   and a run that returns no total fails visibly rather than guess a count.
 */
import {
  defineNamedQuery,
  type BlockDocument,
  type BlockNode,
  type NamedQueryRunArgs,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  BlocksDataProvider,
  BlocksQuery,
  ListPageContext,
  NamedQueryFailure,
  NamedQueryHost,
  PageContext,
} from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { coreBlocks } from "./index";
import { pageStops } from "./list-pages";

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

function list(id: string, props: Record<string, unknown>): BlockNode {
  return node(id, "core/collection-loop", props, {
    children: [itemTitle(`${id}-title`)],
    empty: [node(`${id}-empty`, "core/text", { text: "Nothing yet" })],
  });
}

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

/** `count` posts, titled `Post 1` onward, behind a reader with totals. */
function posts(
  count: number,
  options: { readonly fails?: boolean; readonly total?: number } = {}
): { provider: BlocksDataProvider; queries: BlocksQuery[] } {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `p${String(index + 1)}`,
    title: `Post ${String(index + 1)}`,
  }));
  const queries: BlocksQuery[] = [];
  return {
    queries,
    provider: {
      find: query => {
        queries.push(query);
        if (options.fails === true) {
          return Promise.reject(new Error("database unreachable"));
        }
        // Deliberately blind to `page`: only the offset moves the window.
        const start = query.offset ?? 0;
        return Promise.resolve({
          items: rows.slice(start, start + (query.limit ?? 10)),
          total: options.total ?? rows.length,
        });
      },
    },
  };
}

/** Page `page` of the list `nodeId`, served under `/news`. */
function listPage(nodeId: string, page: number): ListPageContext {
  return {
    nodeId,
    page,
    href: at => (at === 1 ? "/news" : `/news/page/${String(at)}`),
  };
}

async function drawn(
  document: BlockDocument,
  ctx: Partial<PageContext>
): Promise<HTMLElement> {
  const stream = await renderToReadableStream(
    <PageRenderer
      document={document}
      blocks={createBlockResolver(coreBlocks)}
      context={{
        entry: null,
        resolveMedia: () => Promise.resolve(null),
        resolveEntryPath: () => Promise.resolve(null),
        ...ctx,
      }}
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

function titles(host: Element): string[] {
  return Array.from(host.querySelectorAll("h3")).map(
    heading => heading.textContent ?? ""
  );
}

/** Each link in the list's page row: its text, address and whether current. */
function links(
  host: Element
): { text: string; href: string; current: boolean }[] {
  const nav = host.querySelector('nav[aria-label="Pages"]');
  return Array.from(nav?.querySelectorAll("a") ?? []).map(link => ({
    text: (link.textContent ?? "").trim(),
    href: link.getAttribute("href") ?? "",
    current: link.getAttribute("aria-current") === "page",
  }));
}

const NEWS = { collection: "posts", limit: 10, paginate: true };

describe("a list split into pages, rendered", () => {
  it("shows the page's entries, the stored offset applied once before paging", async () => {
    const { provider, queries } = posts(25);
    const host = await drawn(page(list("news", { ...NEWS, offset: 10 })), {
      data: provider,
      listPage: listPage("news", 2),
    });
    // Offset 10, page 2 of 10: entries 21 to 25, and page 2 is the last.
    expect(titles(host)).toEqual([
      "Post 21",
      "Post 22",
      "Post 23",
      "Post 24",
      "Post 25",
    ]);
    expect(queries.map(query => query.offset)).toEqual([20]);
    expect(links(host)).toEqual([
      { text: "‹ Previous", href: "/news", current: false },
      { text: "1", href: "/news", current: false },
      { text: "2", href: "/news/page/2", current: true },
    ]);
  });

  it("links every page from the first, with no previous", async () => {
    const { provider } = posts(30);
    const host = await drawn(page(list("news", NEWS)), {
      data: provider,
      listPage: listPage("news", 1),
    });
    expect(titles(host)).toHaveLength(10);
    expect(links(host)).toEqual([
      { text: "1", href: "/news", current: true },
      { text: "2", href: "/news/page/2", current: false },
      { text: "3", href: "/news/page/3", current: false },
      { text: "Next ›", href: "/news/page/2", current: false },
    ]);
    const next = host.querySelector('a[rel="next"]');
    expect(next?.getAttribute("href")).toBe("/news/page/2");
    expect(host.querySelector('a[rel="prev"]')).toBeNull();
  });

  it("pages only the list the route names", async () => {
    const { provider, queries } = posts(30);
    const host = await drawn(page(list("news", NEWS), list("other", NEWS)), {
      data: provider,
      listPage: listPage("news", 3),
    });
    // The named list shows page 3; the other its first page, unlinked.
    expect(queries.map(query => query.offset ?? 0).sort()).toEqual([0, 20]);
    expect(host.querySelectorAll('nav[aria-label="Pages"]')).toHaveLength(1);
  });

  it("draws no links for a list with one page", async () => {
    const { provider } = posts(4);
    const host = await drawn(page(list("news", NEWS)), {
      data: provider,
      listPage: listPage("news", 1),
    });
    expect(titles(host)).toHaveLength(4);
    expect(host.querySelector("nav")).toBeNull();
  });

  it("draws no links when its read failed, and shows the empty state", async () => {
    const { provider } = posts(30, { fails: true });
    const host = await drawn(page(list("news", NEWS)), {
      data: provider,
      listPage: listPage("news", 2),
    });
    expect(host.textContent).toContain("Nothing yet");
    expect(host.querySelector("nav")).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 2.5])(
    "draws no links for a provider total of %s",
    async total => {
      const { provider } = posts(30, { total });
      const host = await drawn(page(list("news", NEWS)), {
        data: provider,
        listPage: listPage("news", 1),
      });
      expect(titles(host)).toHaveLength(10);
      expect(host.querySelector("nav")).toBeNull();
    }
  );

  it("links a later page by the route's count where the read reports no total", async () => {
    // A provider may leave `total` out; the route counted three pages to
    // serve page 2, and the links follow that count.
    const { provider } = posts(30, { total: Number.NaN });
    const host = await drawn(page(list("news", NEWS)), {
      data: provider,
      listPage: { ...listPage("news", 2), pages: 3 },
    });
    expect(titles(host)[0]).toBe("Post 11");
    expect(links(host).map(link => link.text)).toEqual([
      "‹ Previous",
      "1",
      "2",
      "3",
      "Next ›",
    ]);
  });

  it("shows its first page, unlinked, where no route pages it", async () => {
    const { provider, queries } = posts(30);
    const host = await drawn(page(list("news", NEWS)), { data: provider });
    expect(titles(host)[0]).toBe("Post 1");
    expect(queries.map(query => query.offset)).toEqual([undefined]);
    expect(host.querySelector("nav")).toBeNull();
  });

  it("ignores a page the route names for a list not split into pages", async () => {
    const { provider } = posts(30);
    const host = await drawn(
      page(list("news", { collection: "posts", limit: 10 })),
      { data: provider, listPage: listPage("news", 2) }
    );
    expect(titles(host)[0]).toBe("Post 1");
    expect(host.querySelector("nav")).toBeNull();
  });
});

/**
 * A named query over `count` rows titled `Post 1` onward, cutting them to
 * the window it is asked for, with their total unless `counts` is false.
 * Records each window and each failure the host is told of.
 */
function countedQuery(count: number, counts = true, declares = true) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `p${String(index + 1)}`,
    title: `Post ${String(index + 1)}`,
  }));
  const windows: NamedQueryRunArgs["window"][] = [];
  const failures: NamedQueryFailure[] = [];
  const definition = defineNamedQuery({
    name: "posts.counted",
    label: "Counted posts",
    reads: { collections: ["posts"] },
    rows: {
      key: "id",
      fields: [
        { name: "id", type: "text" },
        { name: "title", type: "text" },
      ],
    },
    total: declares,
    run: ({ window }) => {
      windows.push(window);
      const shown = rows.slice(window.offset, window.offset + window.limit);
      return Promise.resolve(
        counts ? { rows: shown, total: rows.length } : { rows: shown }
      );
    },
  });
  const host: NamedQueryHost = {
    definitionOf: name => (name === definition.name ? definition : undefined),
    reader: {
      find: () => Promise.reject(new Error("not read")),
      count: () => Promise.reject(new Error("not read")),
    },
    today: () => Promise.resolve("2026-11-06"),
    report: failure => failures.push(failure),
  };
  return { host, windows, failures };
}

const NAMED_NEWS = {
  namedQuery: { name: "posts.counted", params: {} },
  limit: 10,
  paginate: true,
};

describe("a named query's list split into pages, rendered", () => {
  it("asks the run for the page's window, the stored offset applied once before paging", async () => {
    const { host: namedQueries, windows } = countedQuery(25);
    const drawnPage = await drawn(
      page(list("news", { ...NAMED_NEWS, offset: 5 })),
      { namedQueries, listPage: listPage("news", 2) }
    );
    // Offset 5, page 2 of 10: rows 16 to 25.
    expect(windows).toEqual([{ limit: 10, offset: 15 }]);
    expect(titles(drawnPage)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Post ${String(index + 16)}`)
    );
  });

  it("counts its links from the run's total, less the offset", async () => {
    const { host: namedQueries } = countedQuery(25);
    const drawnPage = await drawn(
      page(list("news", { ...NAMED_NEWS, offset: 5 })),
      { namedQueries, listPage: listPage("news", 1) }
    );
    // 25 rows less 5 skipped is two pages; a count that ignored the offset
    // would link a third.
    expect(links(drawnPage)).toEqual([
      { text: "1", href: "/news", current: true },
      { text: "2", href: "/news/page/2", current: false },
      { text: "Next ›", href: "/news/page/2", current: false },
    ]);
  });

  it("fails visibly, with no links, when its run returns no total", async () => {
    const { host: namedQueries, failures } = countedQuery(25, false);
    const authored = await drawn(page(list("news", NAMED_NEWS)), {
      namedQueries,
      listPage: listPage("news", 1),
      diagnostics: true,
    });
    expect(titles(authored)).toEqual([]);
    expect(authored.querySelector("nav")).toBeNull();
    const note =
      authored.querySelector("[data-nx-list-diagnostic]")?.textContent ?? "";
    expect(note).toContain(
      "Counted posts doesn't count its entries, so this list can't be split into pages."
    );
    // A refused setting, not a failed read: the note doesn't say otherwise.
    expect(note).not.toContain("couldn't load");
    expect(failures.map(failure => failure.code)).toEqual(["uncounted"]);
    // A visitor sees the empty state alone.
    const visited = await drawn(page(list("news", NAMED_NEWS)), {
      namedQueries,
      listPage: listPage("news", 1),
    });
    expect(visited.textContent).toContain("Nothing yet");
    expect(visited.querySelector("[data-nx-list-diagnostic]")).toBeNull();
    expect(visited.querySelector("nav")).toBeNull();
  });

  it("fails visibly when its query returns a total it no longer declares", async () => {
    // A declaration changed to uncounted after the page was saved, whose
    // run still returns a number: the declaration, not the number, decides.
    const { host: namedQueries, failures } = countedQuery(25, true, false);
    const authored = await drawn(page(list("news", NAMED_NEWS)), {
      namedQueries,
      listPage: listPage("news", 1),
      diagnostics: true,
    });
    expect(titles(authored)).toEqual([]);
    expect(authored.querySelector("nav")).toBeNull();
    expect(failures.map(failure => failure.code)).toEqual(["uncounted"]);
  });

  it("draws the same run's rows where no route pages the list", async () => {
    // The control for the failure above: the run itself is fine, and only
    // a list the route pages needs its total.
    const { host: namedQueries } = countedQuery(25, false);
    const drawnPage = await drawn(page(list("news", NAMED_NEWS)), {
      namedQueries,
    });
    expect(titles(drawnPage)).toHaveLength(10);
    expect(drawnPage.querySelector("nav")).toBeNull();
  });
});

describe("the page numbers a row shows", () => {
  const spelled = (page: number, pages: number) =>
    pageStops(page, pages)
      .map(stop => ("gap" in stop ? "…" : String(stop.page)))
      .join(" ");

  it("shows every page when there are few", () => {
    expect(spelled(1, 7)).toBe("1 2 3 4 5 6 7");
  });

  it("keeps the first, the last and those around the current page", () => {
    expect(spelled(1, 20)).toBe("1 2 … 20");
    expect(spelled(10, 20)).toBe("1 … 9 10 11 … 20");
    expect(spelled(20, 20)).toBe("1 … 19 20");
  });

  it("shows a single left-out page rather than a gap for it", () => {
    expect(spelled(4, 20)).toBe("1 2 3 4 5 … 20");
    expect(spelled(17, 20)).toBe("1 … 16 17 18 19 20");
  });
});
