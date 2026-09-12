/**
 * Reading the registry while somebody is changing it.
 *
 * Both walks page by position — `page`/`limit` for collections, `offset`/`limit`
 * for Singles — because neither service offers a cursor. So deleting a row the
 * walk has already passed shifts everything behind it back, and the row that
 * crosses the boundary is never read.
 *
 * Both failures are silent and both grant completeness: a missed collection gets
 * no scopes while completion is judged against the shortened list, and a missed
 * Single flips "content this index cannot reach" to "none". Either ends with
 * health reporting an index that never saw those documents as EXACT, which is
 * the one answer a safe delete must never be handed.
 *
 * @module plugin-registry-paging.test
 */
import { describe, expect, it } from "vitest";

import { registeredCollectionSlugs, singlesHoldBlocks } from "./plugin";

/** A collection registry that answers pages from a script, one per call. */
function registry(
  pages: { slugs: string[]; total: number; hasMore: boolean }[]
) {
  let call = 0;
  return {
    services: {
      collections: {
        listCollections: async () => {
          const page = pages[call];
          call += 1;
          if (page === undefined)
            throw new Error("asked for a page past the script");
          return {
            data: page.slugs.map(slug => ({ slug })),
            pagination: { total: page.total, hasMore: page.hasMore },
          };
        },
      },
    },
  } as never;
}

/** A singles registry that answers pages from a script, one per call. */
function singles(pages: { rows: unknown[]; total: number }[]) {
  let call = 0;
  return {
    services: {
      singles: {
        list: async () => {
          const page = pages[call];
          call += 1;
          if (page === undefined)
            throw new Error("asked for a page past the script");
          return { data: page.rows, total: page.total };
        },
      },
    },
  } as never;
}

describe("enumerating the collection registry while it changes", () => {
  it("REFUSES when the population shrinks between pages", async () => {
    // A row deleted behind the cursor. The second page starts one row late, so
    // the row that crossed the boundary is never read — and a short list here is
    // indistinguishable from a small site.
    await expect(
      registeredCollectionSlugs(
        registry([
          { slugs: ["a", "b"], total: 4, hasMore: true },
          { slugs: ["d"], total: 3, hasMore: false },
        ])
      )
    ).resolves.toBeUndefined();
  });

  it("REFUSES when the population grows between pages", async () => {
    await expect(
      registeredCollectionSlugs(
        registry([
          { slugs: ["a", "b"], total: 4, hasMore: true },
          { slugs: ["c", "d", "e"], total: 5, hasMore: false },
        ])
      )
    ).resolves.toBeUndefined();
  });

  it("CONTROL: reads every page of a registry that holds still", async () => {
    // Without this, refusing unconditionally would satisfy both cases above and
    // make the backfill unable to run on any site at all.
    await expect(
      registeredCollectionSlugs(
        registry([
          { slugs: ["a", "b"], total: 4, hasMore: true },
          { slugs: ["c", "d"], total: 4, hasMore: false },
        ])
      )
    ).resolves.toEqual(["a", "b", "c", "d"]);
  });

  it("CONTROL: a single page is read without a second call", async () => {
    await expect(
      registeredCollectionSlugs(
        registry([{ slugs: ["only"], total: 1, hasMore: false }])
      )
    ).resolves.toEqual(["only"]);
  });

  it("REFUSES a listing that reports no total", async () => {
    await expect(
      registeredCollectionSlugs({
        services: {
          collections: {
            listCollections: async () => ({
              data: [{ slug: "a" }],
              pagination: { hasMore: false },
            }),
          },
        },
      } as never)
    ).resolves.toBeUndefined();
  });
});

describe("asking whether a Single holds blocks while the registry changes", () => {
  const withBlocks = { fields: [{ type: "blocks", name: "content" }] };
  const withoutBlocks = { fields: [{ type: "text", name: "title" }] };

  it("withholds completeness when the population shrinks between pages", async () => {
    // `true` means "content this index cannot reach", which is what keeps health
    // incomplete. A Single missed by the shift could be the one holding blocks.
    await expect(
      singlesHoldBlocks(
        singles([
          { rows: [withoutBlocks, withoutBlocks], total: 4 },
          { rows: [withoutBlocks], total: 3 },
        ])
      )
    ).resolves.toBe(true);
  });

  it("CONTROL: answers false for a steady registry holding no blocks", async () => {
    // Without this, returning `true` unconditionally would satisfy the case
    // above and withhold completeness from every site for ever.
    await expect(
      singlesHoldBlocks(
        singles([{ rows: [withoutBlocks, withoutBlocks], total: 2 }])
      )
    ).resolves.toBe(false);
  });

  it("CONTROL: still finds a Single that does hold blocks", async () => {
    await expect(
      singlesHoldBlocks(singles([{ rows: [withBlocks], total: 1 }]))
    ).resolves.toBe(true);
  });
});
