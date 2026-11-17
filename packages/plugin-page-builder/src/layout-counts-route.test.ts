/**
 * The header & footer set counts read: which sets are answered (the caller's
 * own read of them), how the pages are counted (as the system, numbers only),
 * and what it skips when there is nothing to answer.
 *
 * The rule itself is held by `layout-page-counts.test.ts`; against a real
 * database by `__tests__/layout-page-counts.integration.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import { LAYOUT_COUNTS_ROUTE_PATH } from "./layout-counts-contract";
import {
  layoutCountsRoute,
  readLayoutPageCounts,
  type LayoutCountsContext,
  type LayoutCountsDirectApi,
} from "./layout-counts-route";

interface Site {
  /** Sets, with whether each is published. */
  sets: { id: string; published: boolean }[];
  /** Set ids a row rule hides from the caller. */
  hidden?: string[];
  pages: { id: string; layout: string | null; noHeaderFooter?: boolean }[];
  defaultLayout: string | null;
}

function fake(site: Site) {
  const calls: Record<string, unknown>[] = [];
  const nextly = {
    find: vi.fn(async (args: Record<string, unknown>) => {
      calls.push(args);
      const limit = Number(args.limit);
      const page = Number(args.page);
      const rows: Record<string, unknown>[] =
        args.collection === "layouts"
          ? site.sets
              .filter(set => args.status !== "published" || set.published)
              .filter(
                set =>
                  args.overrideAccess === true ||
                  !(site.hidden ?? []).includes(set.id)
              )
              .map(set => ({ id: set.id }))
          : site.pages.map(row => ({
              id: row.id,
              layout: row.layout,
              noHeaderFooter: row.noHeaderFooter ?? false,
              // What the select must keep out: nothing beyond the rule's columns.
              title: `Title of ${row.id}`,
              slug: `slug-${row.id}`,
            }));
      return {
        items: rows.slice((page - 1) * limit, page * limit),
        meta: { hasNext: page * limit < rows.length },
      };
    }),
    findSingle: vi.fn(async () => ({ defaultLayout: site.defaultLayout })),
  } as unknown as LayoutCountsDirectApi;
  return { nextly, calls };
}

function context(): LayoutCountsContext {
  return {
    self: { collections: {}, singles: {} },
    caller: { identity: async () => ({ user: { id: "author" } }) },
  } as unknown as LayoutCountsContext;
}

const site: Site = {
  sets: [
    { id: "main", published: true },
    { id: "landing", published: true },
    { id: "unfinished", published: false },
    { id: "secret", published: true },
  ],
  hidden: ["secret"],
  pages: [
    { id: "home", layout: null },
    { id: "about", layout: "landing" },
    { id: "soon", layout: "unfinished" },
    { id: "bare", layout: "landing", noHeaderFooter: true },
    { id: "private", layout: "secret" },
  ],
  defaultLayout: "main",
};

describe("the set counts read", () => {
  it("answers each set the caller may read, counting every page as the system", async () => {
    const { nextly } = fake(site);

    const answer = await readLayoutPageCounts(context(), nextly);

    expect(answer).toEqual({
      main: { pages: 2, floor: false },
      landing: { pages: 1, floor: false },
      unfinished: { pages: 1, floor: false },
    });
  });

  it("reads the sets as the caller and the pages and published sets as the system", async () => {
    const { nextly, calls } = fake(site);

    await readLayoutPageCounts(context(), nextly);

    const listing = calls.find(
      call => call.collection === "layouts" && call.status === "all"
    );
    expect(listing).toMatchObject({
      overrideAccess: false,
      user: { id: "author" },
      select: { id: true },
    });
    const published = calls.find(
      call => call.collection === "layouts" && call.status === "published"
    );
    expect(published).toMatchObject({
      overrideAccess: true,
      select: { id: true },
    });
    const pages = calls.find(call => call.collection === "pages");
    expect(pages).toMatchObject({
      overrideAccess: true,
      select: { id: true, layout: true, noHeaderFooter: true },
    });
  });

  it("answers numbers only, with nothing of the pages behind them", async () => {
    const { nextly } = fake(site);

    const answer = await readLayoutPageCounts(context(), nextly);

    const text = JSON.stringify(answer);
    for (const page of site.pages) {
      expect(text).not.toContain(page.id);
      expect(text).not.toContain(`Title of ${page.id}`);
      expect(text).not.toContain(`slug-${page.id}`);
    }
    for (const count of Object.values(answer)) {
      expect(Object.keys(count).sort()).toEqual(["floor", "pages"]);
    }
  });

  it("reads nothing more when the caller may read no set", async () => {
    const { nextly, calls } = fake({
      ...site,
      hidden: site.sets.map(s => s.id),
    });

    await expect(readLayoutPageCounts(context(), nextly)).resolves.toEqual({});
    expect(calls).toHaveLength(1);
    expect(nextly.findSingle).not.toHaveBeenCalled();
  });

  it("does not ask which sets are published when the site has no default", async () => {
    const { nextly, calls } = fake({ ...site, defaultLayout: null });

    const answer = await readLayoutPageCounts(context(), nextly);

    expect(answer.main).toEqual({ pages: 0, floor: false });
    expect(calls.some(call => call.status === "published")).toBe(false);
  });

  it("reads only the pages naming the caller's sets, and no published sets, when the caller may not read the default", async () => {
    const { nextly, calls } = fake({
      ...site,
      hidden: ["main", "secret"],
    });

    const answer = await readLayoutPageCounts(context(), nextly);

    // The default's id is not theirs to learn, so its pages decide nothing.
    expect(answer).toEqual({
      landing: { pages: 1, floor: false },
      unfinished: { pages: 1, floor: false },
    });
    expect(calls.some(call => call.status === "published")).toBe(false);
    const pages = calls.find(call => call.collection === "pages");
    expect(pages?.where).toEqual({
      layout: { in: ["landing", "unfinished"] },
    });
  });

  it("says the counts are floors when the page read stopped at its bound", async () => {
    const { nextly } = fake(site);

    const answer = await readLayoutPageCounts(context(), nextly, {
      pages: { rowsPerRead: 2, mostReads: 1 },
    });

    // home and about only: the default's and landing's.
    expect(answer).toEqual({
      main: { pages: 1, floor: true },
      landing: { pages: 1, floor: true },
      unfinished: { pages: 0, floor: true },
    });
  });

  it("is a GET on the counts path, needing read on the sets' collection as the site named it", () => {
    const route = layoutCountsRoute();
    const collection = vi.fn(
      (slug: string, action: string) => `${action}:${slug}`
    );

    expect(route.method).toBe("GET");
    expect(route.path).toBe(LAYOUT_COUNTS_ROUTE_PATH);
    expect(
      route.requiredPermission({ collection } as unknown as Parameters<
        typeof route.requiredPermission
      >[0])
    ).toBe("read:layouts");
    expect(collection).toHaveBeenCalledWith("layouts", "read");
  });
});
