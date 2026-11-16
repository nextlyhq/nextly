/**
 * A routed page whose one paginated list reads a named query: the route
 * counts the list's pages from the run's total, by the list's own window,
 * and answers a page past the last, or any later page of a run that counts
 * nothing, as not found.
 *
 * Driven through the real route and the real named-query host, with only
 * the Direct API below them faked. The render's element is read, not drawn,
 * so each run recorded is the route's count.
 *
 * What separates a correct count from a plausible broken one: the offset is
 * taken off the total before dividing (25 rows, 5 skipped, 10 a page is two
 * pages, where ignoring the offset gives three), and a run with no total
 * gives no later page rather than a guessed one.
 */
import {
  defineNamedQuery,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type NamedQueryRunArgs,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import { throughBoundary } from "./__tests__/through-boundary";
import { coreBlocks } from "./blocks";
import type { NamedQueryLookup } from "./context";
import { createBlocksPage } from "./next";
import type { PageRendererProps } from "./page-renderer";
import { createBlockResolver } from "./resolver";

/** What Next.js's `notFound()` throws, for the App Router to answer 404. */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

/** The page `news`, holding one list of the named query, split into pages. */
const news: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "list",
      type: "core/collection-loop",
      version: 1,
      props: {
        namedQuery: { name: "posts.counted", params: {} },
        limit: 10,
        offset: 5,
        paginate: true,
      },
      slots: { children: [], empty: [] },
    },
  ],
};

/** A Direct API holding the page `news` and nothing else. */
function instance() {
  return {
    find: vi.fn(
      async (args: {
        collection: string;
        where?: { slug?: { equals?: unknown } };
      }) => {
        const found =
          args.collection === "pages" && args.where?.slug?.equals === "news";
        return {
          items: found ? [{ id: "p1", slug: "news", content: news }] : [],
          meta: { total: found ? 1 : 0 },
        };
      }
    ),
    findByID: vi.fn(async () => null),
    findSingle: vi.fn(async () => null),
    media: { findByID: vi.fn(async () => null) },
  };
}

/** A query over 25 rows, with their total unless `counts` is false. */
function query(counts: boolean): {
  lookup: NamedQueryLookup;
  windows: NamedQueryRunArgs["window"][];
} {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: `p${String(index + 1)}`,
  }));
  const windows: NamedQueryRunArgs["window"][] = [];
  const definition = defineNamedQuery({
    name: "posts.counted",
    label: "Counted posts",
    reads: { collections: ["posts"] },
    rows: { key: "id", fields: [{ name: "id", type: "text" }] },
    total: true,
    run: ({ window }) => {
      windows.push(window);
      const shown = rows.slice(window.offset, window.offset + window.limit);
      return Promise.resolve(
        counts ? { rows: shown, total: rows.length } : { rows: shown }
      );
    },
  });
  return {
    lookup: {
      definitionOf: name => (name === definition.name ? definition : undefined),
    },
    windows,
  };
}

/** The page of its list the route serves at `slug`. */
async function served(slug: string[], lookup: NamedQueryLookup) {
  const route = createBlocksPage({
    collections: ["pages"],
    field: "content",
    // The route presents only blocks it can resolve, and this page's one
    // list is what it counts.
    blocks: createBlockResolver(coreBlocks),
    // Today is read in the site's zone; none is readable in this process.
    timeZone: "Asia/Karachi",
    namedQueries: lookup,
    nextly: instance() as never,
  });
  const element = await throughBoundary<PageRendererProps>(
    route.ContentPage({ params: { slug } })
  );
  return element.props.context?.listPage;
}

describe("a routed named query's list split into pages", () => {
  it("serves a later page counted from the run's total, less the offset", async () => {
    const { lookup, windows } = query(true);
    const listPage = await served(["news", "page", "2"], lookup);
    expect(listPage).toMatchObject({ nodeId: "list", page: 2, pages: 2 });
    // Counted by the run the list's first page makes, so a kept result
    // serves both: the list's own window, not the page asked for.
    expect(windows).toEqual([{ limit: 10, offset: 5 }]);
  });

  it("answers a page past the last as not found", async () => {
    const { lookup } = query(true);
    await expect(served(["news", "page", "3"], lookup)).rejects.toMatchObject(
      NOT_FOUND
    );
  });

  it("serves no later page of a run that returns no total", async () => {
    const { lookup, windows } = query(false);
    await expect(served(["news", "page", "2"], lookup)).rejects.toMatchObject(
      NOT_FOUND
    );
    // The run was made, and its missing total, not a skipped run, is why.
    expect(windows).toHaveLength(1);
  });

  it("logs the count's failure, since no render follows a page it cannot serve", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { lookup } = query(false);
      await expect(served(["news", "page", "2"], lookup)).rejects.toMatchObject(
        NOT_FOUND
      );
      // One line naming the query and the page, under a reference.
      const lines = warn.mock.calls.map(call => String(call[0]));
      expect(lines.filter(line => line.includes("posts.counted"))).toHaveLength(
        1
      );
      expect(lines.join("\n")).toMatch(/NQ-[0-9A-F]{6}/);
      expect(lines.join("\n")).toContain('"news"');
      expect(lines.join("\n")).toContain("failed: uncounted");
    } finally {
      warn.mockRestore();
    }
  });
});
