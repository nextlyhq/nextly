/**
 * The start-up pass over a site's pages: that it reconciles each page from
 * its row as committed when its turn comes, under the page's own lock, and
 * that it reports a pass that did not settle every page as incomplete, so
 * saves keep claiming the pages in a list's way.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { backfillPageClaims, type BackfillDeps } from "./backfill";
import {
  claimOrWait,
  lockHolder,
  reconcileHolder,
  type Claims,
  type Tx,
} from "./claim-store";

vi.mock("./claim-store", () => ({
  claimOrWait: vi.fn(async () => "claimed"),
  lockHolder: vi.fn(async () => undefined),
  reconcileHolder: vi.fn(async () => true),
}));

const TX = {} as Tx;

/** A pass over `walk`, answering a page's current row from `now`. */
function depsOver(
  walk: Record<string, unknown>[],
  now: Record<string, Record<string, unknown> | undefined>
): BackfillDeps & { find: ReturnType<typeof vi.fn> } {
  const find = vi.fn(async (args: Record<string, unknown>) => {
    const where = args.where as { id?: { equals: string }; and?: unknown };
    if (where.id !== undefined) {
      const row = now[where.id.equals];
      return { items: row === undefined ? [] : [row] };
    }
    // The first batch is the walk; one resuming after it finds nothing.
    return { items: where.and === undefined ? walk : [] };
  });
  return {
    pages: "pages",
    claims: {} as Claims,
    locales: ["en"],
    nextly: { find },
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
    const reread = deps.find.mock.invocationCallOrder[1];
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
    const reads = deps.find.mock.calls
      .map(call => call[0] as Record<string, unknown>)
      .filter(args => !("id" in (args.where as object)));
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

  it("is incomplete when the pages could not be read", async () => {
    const deps = depsOver([], {});
    deps.find.mockRejectedValueOnce(new Error("down"));
    expect(await backfillPageClaims(deps)).toBe(false);
  });
});
