/**
 * One page's move off the empty seed, against a Direct API double: what a
 * page that cannot be read answers, as against one that is gone.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { movePageOffSeed, type EmptySeedMoveDeps } from "./empty-seed";

/** A Direct API whose by-id read of the page is refused as not found. */
function unreadable(stillListed: boolean) {
  const rewrite = vi.fn();
  const deps = {
    nextly: {
      findByID: vi.fn(async () => {
        throw NextlyError.notFound();
      }),
      find: vi.fn(async () => ({
        items: stillListed ? [{ id: "page" }] : [],
        meta: { hasNext: false },
      })),
      findSingle: vi.fn(),
    },
    pagesSlug: "pages",
    emptySeed: { mark: { read: vi.fn(), write: vi.fn() }, rewrite },
  } as unknown as Pick<EmptySeedMoveDeps, "nextly" | "pagesSlug" | "emptySeed">;
  return { deps, rewrite };
}

describe("moving one page off the empty seed", () => {
  it("leaves a page it cannot read for a later pass, rather than calling it moved or gone", async () => {
    // A read hook on the page refuses as not found, about something the page
    // relates to: the page itself is still listed.
    const { deps, rewrite } = unreadable(true);

    await expect(movePageOffSeed(deps, "page", "seed")).resolves.toBe(
      "refused"
    );
    expect(rewrite).not.toHaveBeenCalled();
  });

  it("answers unchanged for a page deleted since the scan listed it", async () => {
    const { deps, rewrite } = unreadable(false);

    await expect(movePageOffSeed(deps, "page", "seed")).resolves.toBe(
      "unchanged"
    );
    expect(rewrite).not.toHaveBeenCalled();
  });
});
