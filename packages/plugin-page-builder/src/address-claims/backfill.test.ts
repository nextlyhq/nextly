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
    const where = args.where as { id?: { equals: string } };
    if (where.id !== undefined) {
      const row = now[where.id.equals];
      return { items: row === undefined ? [] : [row] };
    }
    return { items: args.page === 1 ? walk : [] };
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
