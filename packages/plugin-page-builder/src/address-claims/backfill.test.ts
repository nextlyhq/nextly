/**
 * The start-up pass over a site's pages: that it reconciles each page from
 * its row as committed when its turn comes, under the page's own lock, and
 * that it reports a pass that did not settle every page as incomplete, so
 * saves keep claiming the pages in a list's way.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  backfillPageClaims,
  publishedPagesInTransaction,
  type BackfillDeps,
  type PagesInTransactionRead,
} from "./backfill";
import {
  claimOrWait,
  claimSpaceOrWait,
  dropStaleClaims,
  lockHolder,
  reconcileHolder,
  type Claims,
  type Tx,
} from "./claim-store";

vi.mock("./claim-store", () => ({
  claimOrWait: vi.fn(async () => "claimed"),
  claimSpaceOrWait: vi.fn(async () => "waiting"),
  dropStaleClaims: vi.fn(async () => undefined),
  lockHolder: vi.fn(async () => undefined),
  reconcileHolder: vi.fn(async () => true),
}));

const TX = {} as Tx;

/** A pass over `walk`, answering a page's current row from `now`. */
function depsOver(
  walk: Record<string, unknown>[],
  now: Record<string, Record<string, unknown> | undefined>
): BackfillDeps & {
  find: ReturnType<typeof vi.fn>;
  readPage: ReturnType<typeof vi.fn>;
} {
  const find = vi.fn(async (args: Record<string, unknown>) => {
    const where = args.where as { and?: unknown };
    // The first batch is the walk; one resuming after it finds nothing.
    return { items: where.and === undefined ? walk : [] };
  });
  const readPage = vi.fn(async (tx: Tx, id: string) => {
    // A page is read again on the pass's own transaction, never through a
    // second connection, which on a pool of one waits for this one.
    if (tx !== TX) throw new Error("page read off the pass's transaction");
    return now[id] ?? null;
  });
  return {
    pages: "pages",
    claims: {} as Claims,
    locales: ["en"],
    nextly: { find },
    readPage,
    withTransaction: async work => work(TX),
    warn: () => undefined,
    find,
  };
}

/** The paths `reconcileHolder` was asked to hold, call by call. */
function reconciledPaths(): string[][] {
  return vi
    .mocked(reconcileHolder)
    .mock.calls.map(call =>
      call[3].addresses.map(at => `/${at.segments.join("/")}`)
    );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backfillPageClaims", () => {
  it("reconciles a page from its row as it is now, not as the walk read it", async () => {
    const deps = depsOver([{ id: "p", slug: "about", status: "published" }], {
      p: { id: "p", slug: "about-us", status: "published" },
    });
    expect(await backfillPageClaims(deps)).toBe(true);
    expect(reconciledPaths()).toEqual([["/about-us"]]);
    // The page's lock is taken before its row is read again, so a save of
    // it either committed first or waits for the pass.
    const reread = deps.readPage.mock.invocationCallOrder[0];
    expect(vi.mocked(lockHolder).mock.invocationCallOrder[0]).toBeLessThan(
      reread ?? 0
    );
    expect(vi.mocked(lockHolder).mock.calls[0]?.[2]).toEqual({
      collection: "pages",
      id: "p",
    });
  });

  it("leaves a page deleted since the walk read it alone", async () => {
    const deps = depsOver(
      [{ id: "p", slug: "about", status: "published" }],
      {}
    );
    expect(await backfillPageClaims(deps)).toBe(true);
    expect(reconcileHolder).not.toHaveBeenCalled();
  });

  it("is complete when a clashing page is left waiting", async () => {
    vi.mocked(reconcileHolder).mockRejectedValueOnce(
      NextlyError.conflict({ reason: "state" })
    );
    const page = { id: "p", slug: "about", status: "published" };
    expect(await backfillPageClaims(depsOver([page], { p: page }))).toBe(true);
    expect(claimOrWait).toHaveBeenCalledTimes(1);
  });

  it("leaves a clashing page's list waiting for its later pages", async () => {
    vi.mocked(reconcileHolder).mockRejectedValueOnce(
      NextlyError.conflict({ reason: "state" })
    );
    const page = {
      id: "p",
      slug: "news",
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "list",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts", paginate: true },
            slots: { children: [], empty: [] },
          },
        ],
      },
    };
    expect(await backfillPageClaims(depsOver([page], { p: page }))).toBe(true);
    expect(
      vi
        .mocked(claimSpaceOrWait)
        .mock.calls.map(call => [
          `/${call[2].list.segments.join("/")}`,
          call[2].holder.id,
        ])
    ).toEqual([["/news", "p"]]);
  });

  it("waits for the address a clashing page has now, read again under its lock", async () => {
    const page = { id: "p", slug: "about", status: "published" };
    const now: Record<string, Record<string, unknown>> = { p: page };
    // The page moves between the refused reconcile and the wait.
    vi.mocked(reconcileHolder).mockImplementationOnce(async () => {
      now.p = { id: "p", slug: "about-us", status: "published" };
      throw NextlyError.conflict({ reason: "state" });
    });
    expect(await backfillPageClaims(depsOver([page], now))).toBe(true);
    expect(
      vi
        .mocked(claimOrWait)
        .mock.calls.map(call => `/${call[2].address.segments.join("/")}`)
    ).toEqual(["/about-us"]);
    expect(lockHolder).toHaveBeenCalledTimes(2);
  });

  it("resumes each batch after the last page read, not at a page number", async () => {
    const walk = Array.from({ length: 100 }, (_, at) => ({
      id: `p${String(at).padStart(3, "0")}`,
      slug: `page-${at}`,
      status: "published",
      createdAt: `2026-01-01T00:00:${String(at % 60).padStart(2, "0")}.000Z`,
    }));
    const deps = depsOver(
      walk,
      Object.fromEntries(walk.map(row => [row.id, row]))
    );
    expect(await backfillPageClaims(deps)).toBe(true);
    const reads = deps.find.mock.calls.map(
      call => call[0] as Record<string, unknown>
    );
    expect(reads).toHaveLength(2);
    expect(reads[1]?.page).toBeUndefined();
    expect(JSON.stringify(reads[1]?.where)).toContain(
      JSON.stringify({ id: { greater_than: "p099" } })
    );
    expect(JSON.stringify(reads[1]?.where)).toContain(
      JSON.stringify({ createdAt: { greater_than: walk[99]?.createdAt } })
    );
  });

  it("is incomplete when a page could not be claimed", async () => {
    vi.mocked(reconcileHolder).mockRejectedValueOnce(new Error("lost"));
    const first = { id: "p", slug: "about", status: "published" };
    const second = { id: "q", slug: "contact", status: "published" };
    expect(
      await backfillPageClaims(
        depsOver([first, second], { p: first, q: second })
      )
    ).toBe(false);
    // The pass still settles the pages after the one that failed.
    expect(reconciledPaths()).toEqual([["/about"], ["/contact"]]);
  });

  it("gives up a clashing page's stale claims and waits after it records its current ones", async () => {
    vi.mocked(reconcileHolder).mockRejectedValueOnce(
      NextlyError.conflict({ reason: "state" })
    );
    const page = { id: "p", slug: "about", status: "published" };
    expect(await backfillPageClaims(depsOver([page], { p: page }))).toBe(true);
    const dropped = vi.mocked(dropStaleClaims).mock;
    expect(dropped.calls[0]?.[3].addresses.map(at => at.segments)).toEqual([
      ["about"],
    ]);
    // After the current claims are taken, as reconciling orders it.
    expect(dropped.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(claimOrWait).mock.invocationCallOrder[0] ?? Infinity
    );
  });

  it("stops writing once a newer pass has started, and is not complete", async () => {
    const first = { id: "p", slug: "about", status: "published" };
    const second = { id: "q", slug: "contact", status: "published" };
    let current = true;
    const deps = {
      ...depsOver([first, second], { p: first, q: second }),
      current: () => current,
    };
    vi.mocked(reconcileHolder).mockImplementationOnce(async () => {
      current = false;
      return true;
    });
    expect(await backfillPageClaims(deps)).toBe(false);
    expect(reconciledPaths()).toEqual([["/about"]]);
  });

  it("is incomplete when the pages could not be read", async () => {
    const deps = depsOver([], {});
    deps.find.mockRejectedValueOnce(new Error("down"));
    expect(await backfillPageClaims(deps)).toBe(false);
  });
});

describe("publishedPagesInTransaction", () => {
  /**
   * A read over `stored`'s published pages as the facade answers one: on
   * the save's transaction only, by id ascending, after the id the where
   * names, `limit` to a batch.
   */
  function readOver(stored: readonly Record<string, unknown>[]) {
    return vi.fn<PagesInTransactionRead>(async (tx, options) => {
      if (tx !== TX) throw new Error("pages read off the save's transaction");
      const after = JSON.stringify(options.where).match(
        /"greater_than":"([^"]+)"/
      )?.[1];
      const data = stored
        .filter(row => row.status === "published")
        .filter(row => after === undefined || String(row.id) > after)
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
        .slice(0, options.pagination.limit);
      return { data };
    });
  }

  async function walked(read: PagesInTransactionRead): Promise<string[][]> {
    const batches: string[][] = [];
    for await (const batch of publishedPagesInTransaction(read, TX)) {
      batches.push(batch.map(row => String(row.id)));
    }
    return batches;
  }

  it("reads every published page on the save's transaction, a batch after the last id", async () => {
    // 100 to a batch: 230 published pages take three reads, and a draft
    // among them is never answered.
    const ids = Array.from(
      { length: 230 },
      (_, at) => `p${String(at).padStart(3, "0")}`
    );
    const read = readOver([
      ...ids.map(id => ({ id, status: "published" })),
      { id: "p050x", status: "draft" },
    ]);
    const batches = await walked(read);
    expect(batches.map(batch => batch.length)).toEqual([100, 100, 30]);
    expect(batches.flat()).toEqual(ids);
    expect(read).toHaveBeenCalledTimes(3);
    const [first, second] = read.mock.calls;
    expect(first?.[1].where).toEqual({ status: { equals: "published" } });
    expect(second?.[1].where).toEqual({
      and: [
        { status: { equals: "published" } },
        { id: { greater_than: "p099" } },
      ],
    });
    for (const call of read.mock.calls) {
      expect(call[1].sort).toEqual({ field: "id", direction: "asc" });
      // No row lock: the save holds claims locks another page's save,
      // holding its own row, may be waiting for.
      expect(call[2]).toEqual({ lock: "none" });
    }
  });

  it("stops on a short batch, reading no further", async () => {
    const read = readOver([
      { id: "a", status: "published" },
      { id: "b", status: "published" },
    ]);
    expect(await walked(read)).toEqual([["a", "b"]]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("refuses to resume after a page with no id", async () => {
    const read = vi.fn<PagesInTransactionRead>(async () => ({
      data: Array.from({ length: 100 }, () => ({ status: "published" })),
    }));
    await expect(walked(read)).rejects.toSatisfy((error: unknown) =>
      NextlyError.isCode(error, "INTERNAL_ERROR")
    );
  });
});
