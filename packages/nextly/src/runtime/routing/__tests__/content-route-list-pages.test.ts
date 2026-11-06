/**
 * The later pages of an entry's paginated list, served at
 * `<address>/page/<n>`, against a stubbed reader (no DB).
 *
 * What separates a correct route from a plausible broken one:
 *
 * - page `n` from 2 renders the entry at the front of the path, told which
 *   page, and only up to the count the route is given;
 * - `/page/1` redirects permanently to the entry's own address, so page one
 *   has one address, the homepage's included;
 * - every other spelling of a number answers not found WITHOUT a read, so a
 *   malformed address costs nothing and is never a duplicate page;
 * - an entry stored at an address that looks like a page is served as itself;
 * - a route given no count serves no later pages at all, as before;
 * - the build pre-renders each later page, within the route's limit.
 *
 * `next/navigation` is stood in for, so a not-found and a redirect are told
 * apart by what they throw.
 */
import { describe, expect, it, vi } from "vitest";

import type { FindArgs } from "../../../direct-api/types/collections";
import type { ListResult } from "../../../direct-api/types/shared";
import {
  createContentRoute,
  createPublicContentRoute,
  type ContentRouteConfig,
  type RenderContext,
} from "../content-route";
import type { ContentEntry, NextlyContentReader } from "../resolve-content";

vi.mock("../../next-api", () => ({
  loadNextModule: () => ({
    notFound: () => {
      throw new Error("not found");
    },
    permanentRedirect: (path: string) => {
      throw new Error(`permanent redirect to ${path}`);
    },
  }),
  requireNextApi: (module: Record<string, unknown>, _: string, name: string) =>
    module[name],
}));

interface Row extends Record<string, unknown> {
  id: string;
  slug: string;
}

/** A reader over `rows`, matching by slug, recording every read. */
function reader(rows: Row[]): {
  nextly: NextlyContentReader;
  reads: FindArgs[];
} {
  const reads: FindArgs[] = [];
  const nextly: NextlyContentReader = {
    find: async (args): Promise<ListResult<Record<string, unknown>>> => {
      reads.push(args);
      const slug = (args.where as { slug?: { equals?: unknown } } | undefined)
        ?.slug?.equals;
      const items =
        slug === undefined ? rows : rows.filter(row => row.slug === slug);
      return {
        items,
        meta: {
          total: items.length,
          page: 1,
          limit: items.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
    findByID: async () => null,
  };
  return { nextly, reads };
}

/** What a render was given: which entry, and which page of its list. */
interface Drawn {
  readonly id: unknown;
  readonly page: number | undefined;
}

const ROWS: Row[] = [
  { id: "home", slug: "" },
  { id: "news", slug: "news" },
  { id: "plain", slug: "plain" },
  // An entry of its own at an address that looks like a page of `news`.
  { id: "news-page-9", slug: "news/page/9" },
];

/** `news` and the homepage have three pages; nothing else paginates. */
const listPages: NonNullable<ContentRouteConfig<Drawn>["listPages"]> = async (
  entry: ContentEntry
) => (entry.id === "news" || entry.id === "home" ? 3 : null);

function route(withPages = true) {
  const { nextly, reads } = reader(ROWS);
  const { ContentPage } = createContentRoute<Drawn>({
    collections: ["pages"],
    nextly,
    render: (entry, context: RenderContext) => ({
      id: entry.id,
      page: context.page,
    }),
    ...(withPages ? { listPages } : {}),
  });
  return {
    reads,
    serve: (path: string) =>
      ContentPage({ params: { slug: path === "" ? [] : path.split("/") } }),
  };
}

describe("a paginated list's later pages", () => {
  it("renders a later page as the entry, told which page", async () => {
    await expect(route().serve("news/page/2")).resolves.toEqual({
      id: "news",
      page: 2,
    });
    await expect(route().serve("news/page/3")).resolves.toEqual({
      id: "news",
      page: 3,
    });
  });

  it("renders the entry's own address as the first page, with no page set", async () => {
    await expect(route().serve("news")).resolves.toEqual({
      id: "news",
      page: undefined,
    });
  });

  it("answers a page past the last as not found", async () => {
    await expect(route().serve("news/page/4")).rejects.toThrow("not found");
  });

  it("redirects page one permanently to the entry's own address", async () => {
    await expect(route().serve("news/page/1")).rejects.toThrow(
      "permanent redirect to /news"
    );
  });

  it("serves the homepage's later pages and sends its page one to /", async () => {
    await expect(route().serve("page/2")).resolves.toEqual({
      id: "home",
      page: 2,
    });
    await expect(route().serve("page/1")).rejects.toThrow(
      "permanent redirect to /"
    );
  });

  it.each([
    "0",
    "02",
    "-1",
    "1.5",
    "+2",
    "2.0",
    "two",
    "",
    "99999999999999999999",
  ])(
    "answers page %j as not found, reading nothing for the list",
    async segment => {
      const served = route();
      await expect(served.serve(`news/page/${segment}`)).rejects.toThrow(
        "not found"
      );
      // Only the path as written was looked up: the entry at its front was
      // never read, so no count was taken either.
      expect(
        served.reads.map(
          read => (read.where as { slug?: { equals?: unknown } }).slug?.equals
        )
      ).toEqual([`news/page/${segment}`]);
    }
  );

  it("answers a later page of an entry that paginates nothing as not found", async () => {
    await expect(route().serve("plain/page/2")).rejects.toThrow("not found");
  });

  it("serves an entry stored at a page-like address as itself", async () => {
    await expect(route().serve("news/page/9")).resolves.toEqual({
      id: "news-page-9",
      page: undefined,
    });
  });

  it("serves no later pages on a route given no count", async () => {
    await expect(route(false).serve("news/page/2")).rejects.toThrow(
      "not found"
    );
  });
});

describe("the addresses a list's pages are served at", () => {
  function mounted(mountPath?: string) {
    const { nextly } = reader(ROWS);
    const { ContentPage } = createContentRoute<RenderContext>({
      collections: ["pages"],
      nextly,
      render: (_entry, context) => context,
      listPages,
      ...(mountPath === undefined ? {} : { mountPath }),
    });
    return (path: string) =>
      ContentPage({ params: { slug: path === "" ? [] : path.split("/") } });
  }

  it("hands the render each page's address, its own for page one", async () => {
    const context = await mounted()("news/page/2");
    expect(context.listPagePath?.(1)).toBe("/news");
    expect(context.listPagePath?.(3)).toBe("/news/page/3");
    const home = await mounted()("");
    expect(home.listPagePath?.(1)).toBe("/");
    expect(home.listPagePath?.(2)).toBe("/page/2");
  });

  it("names every address under the route's mount, and redirects there", async () => {
    const serve = mounted("/blocks");
    const context = await serve("news");
    expect(context.listPagePath?.(1)).toBe("/blocks/news");
    expect(context.listPagePath?.(2)).toBe("/blocks/news/page/2");
    expect((await serve("")).listPagePath?.(1)).toBe("/blocks");
    await expect(serve("news/page/1")).rejects.toThrow(
      "permanent redirect to /blocks/news"
    );
    await expect(serve("page/1")).rejects.toThrow(
      "permanent redirect to /blocks"
    );
  });

  it("hands a later page the count it was served by, and the own address none", async () => {
    expect((await mounted()("news/page/2")).listPages).toBe(3);
    expect((await mounted()("news")).listPages).toBeUndefined();
  });

  it("hands no addresses where the route serves no later pages", async () => {
    const { nextly } = reader(ROWS);
    const { ContentPage } = createContentRoute<RenderContext>({
      collections: ["pages"],
      nextly,
      render: (_entry, context) => context,
    });
    const context = await ContentPage({ params: { slug: ["news"] } });
    expect(context.listPagePath).toBeUndefined();
  });

  it.each([
    "blocks",
    "/blocks/",
    "/blocks?x",
    "//blocks",
    "/a b",
    "/docs/../blocks",
    "/docs/./blocks",
    "/docs/%2e%2e/blocks",
    "/docs\\blocks",
  ])("refuses the mount path %j when the route is built", mountPath => {
    expect(() => mounted(mountPath)).toThrow(/mountPath/);
  });
});

describe("a page count the route cannot trust", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -2, 2.5])(
    "serves no later page, and redirects no page one, for a count of %s",
    async count => {
      const { nextly } = reader(ROWS);
      const { ContentPage } = createContentRoute<Drawn>({
        collections: ["pages"],
        nextly,
        render: entry => ({ id: entry.id, page: undefined }),
        listPages: async () => count,
      });
      const serve = (path: string) =>
        ContentPage({ params: { slug: path.split("/") } });
      await expect(serve("news/page/2")).rejects.toThrow("not found");
      await expect(serve("news/page/1")).rejects.toThrow("not found");
    }
  );
});

describe("pre-rendering a paginated list's later pages", () => {
  function statics(staticParamsLimit?: number) {
    const { nextly } = reader(ROWS);
    return createPublicContentRoute<Drawn>({
      collections: ["pages"],
      nextly,
      render: entry => ({ id: entry.id, page: undefined }),
      listPages,
      ...(staticParamsLimit === undefined ? {} : { staticParamsLimit }),
    }).generateStaticParams();
  }

  it("lists each later page after the entries, up to each list's count", async () => {
    await expect(statics()).resolves.toEqual([
      { slug: [] },
      { slug: ["news"] },
      { slug: ["plain"] },
      { slug: ["news", "page", "9"] },
      { slug: ["page", "2"] },
      { slug: ["page", "3"] },
      { slug: ["news", "page", "2"] },
      { slug: ["news", "page", "3"] },
    ]);
  });

  it("keeps each collection's later pages within that collection's limit", async () => {
    // Two collections, a limit of 3 each: `news` has 3 pages but its
    // collection's own entry leaves room for 2 of them only, though the
    // other collection is empty and leaves its whole share unused.
    const { nextly } = reader([{ id: "news", slug: "news" }]);
    const params = await createPublicContentRoute<Drawn>({
      collections: ["pages", "empty"],
      nextly: {
        ...nextly,
        find: args =>
          args.collection === "empty"
            ? reader([]).nextly.find(args)
            : nextly.find(args),
      },
      render: entry => ({ id: entry.id, page: undefined }),
      listPages: async () => 10,
      staticParamsLimit: 3,
    }).generateStaticParams();
    expect(params).toEqual([
      { slug: ["news"] },
      { slug: ["news", "page", "2"] },
      { slug: ["news", "page", "3"] },
    ]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "refuses a staticParamsLimit of %s when the route is built",
    limit => {
      expect(() => statics(limit)).toThrow(/whole number/);
    }
  );

  it("keeps the later pages within the route's limit", async () => {
    const params = await statics(5);
    expect(params).toHaveLength(5);
    expect(params.slice(4)).toEqual([{ slug: ["page", "2"] }]);
  });
});
