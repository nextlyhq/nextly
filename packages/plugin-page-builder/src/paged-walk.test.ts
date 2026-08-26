/**
 * Whether the shared paged walk visits every page and refuses an unfinished one.
 *
 * @module paged-walk.test
 */
import { describe, expect, it } from "vitest";

import { walkPages } from "./paged-walk";

describe("walking a store's pages", () => {
  it("requests pages in order until the store says there are no more", async () => {
    const requested: number[] = [];
    const seen: unknown[] = [];

    await walkPages({
      maxPages: 10,
      describe: "pages",
      fetchPage: async page => {
        requested.push(page);
        return { items: [`item-${page}`], meta: { hasNext: page < 3 } };
      },
      onPage: items => {
        seen.push(...items);
      },
    });

    expect(requested).toEqual([1, 2, 3]);
    expect(seen).toEqual(["item-1", "item-2", "item-3"]);
  });

  it("refuses when the guard runs out before the store does", async () => {
    // The guard running out means later pages were never read. Returning what
    // it had would produce the same numbers a complete walk produces, so a
    // caller would record a finished pass over a set only partly read.
    let requested = 0;

    await expect(
      walkPages({
        maxPages: 3,
        describe: "pages.content",
        fetchPage: async () => {
          requested += 1;
          return { items: [], meta: { hasNext: true } };
        },
        onPage: () => {},
      })
    ).rejects.toThrow(/over pages\.content stopped after 3 pages/);

    // Counted in PAGES REQUESTED, not items collected: this store never yields
    // an item, so an item-count bound would never have terminated.
    expect(requested).toBe(3);
  });
});
