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
 * Single is never walked. Either ends with
 * health reporting an index that never saw those documents as EXACT, which is
 * the one answer a safe delete must never be handed.
 *
 * @module plugin-registry-paging.test
 */
import { describe, expect, it } from "vitest";

import { registeredCollectionSlugs, singlesDeclaringBlocks } from "./plugin";

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
function singles(
  pages: { rows: unknown[]; total: number }[],
  config: unknown = { singles: [] }
) {
  let call = 0;
  return {
    config,
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

/** A code-first Single the configuration no longer declares. */
const SLUG_CODE_GONE = {
  slug: "gone",
  source: "code",
  fields: [{ type: "blocks", name: "content" }],
};
/** A code-first Single the configuration still declares. */
const SLUG_CODE_HOME = {
  slug: "home",
  source: "code",
  fields: [{ type: "blocks", name: "content" }],
};
/** A Single the Builder made, which no configuration ever declares. */
const SLUG_BUILDER_MADE = {
  slug: "made",
  source: "builder",
  fields: [{ type: "blocks", name: "content" }],
};

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

/** The slugs a listing of the Singles holding blocks names, or `undefined` for a refusal. */
async function slugsOf(
  ctx: Parameters<typeof singlesDeclaringBlocks>[0]
): Promise<string[] | undefined> {
  return (await singlesDeclaringBlocks(ctx))?.map(single => single.slug);
}

describe("listing the Singles that hold blocks while the registry changes", () => {
  const withBlocks = {
    slug: "with",
    fields: [{ type: "blocks", name: "content" }],
  };
  const withoutBlocks = {
    slug: "without",
    fields: [{ type: "text", name: "title" }],
  };

  it("REFUSES when the population shrinks between pages", async () => {
    // A Single missed by the shift could be the one holding blocks, and a
    // listing without it would let the usage index call itself whole.
    await expect(
      slugsOf(
        singles([
          { rows: [withoutBlocks, withoutBlocks], total: 4 },
          { rows: [withoutBlocks], total: 3 },
        ])
      )
    ).resolves.toBeUndefined();
  });

  it("lists a Single whose blocks field is NESTED", async () => {
    // Its blocks are out of the index's reach, which the backfill can say
    // only if the Single is listed; leaving it out made the index call itself
    // whole over content it never saw.
    await expect(
      slugsOf(
        singles([
          {
            rows: [
              {
                slug: "nested",
                fields: [
                  {
                    type: "group",
                    name: "hero",
                    fields: [{ type: "blocks", name: "content" }],
                  },
                ],
              },
            ],
            total: 1,
          },
        ])
      )
    ).resolves.toEqual(["nested"]);
  });

  it("lists a Single behind a field-group reference", async () => {
    await expect(
      slugsOf(
        singles([
          {
            rows: [
              {
                slug: "grouped",
                fields: [
                  { type: "fieldGroup", name: "seo", fieldGroup: "seo" },
                ],
              },
            ],
            total: 1,
          },
        ])
      )
    ).resolves.toEqual(["grouped"]);
  });

  it("leaves out a removed code-first Single whose registry row survives", async () => {
    /*
     * Removing a code-first Single from config leaves its registry row readable
     * until the destructive cleanup runs, carrying `source: "code"` — which
     * `PluginSinglesService.list` documents and deliberately does not filter,
     * because filtering after pagination returns short pages. Listed here, a
     * removed Single would be walked, and its rows counted, for content the app
     * no longer has.
     */
    await expect(
      slugsOf(
        singles([{ rows: [SLUG_CODE_GONE], total: 1 }], {
          singles: [{ slug: "still-here" }],
        })
      )
    ).resolves.toEqual([]);
  });

  it("CONTROL: lists a code-first Single still declared", async () => {
    // Without this, filtering every `code` row would satisfy the case above and
    // hide every configured Single from the index.
    await expect(
      slugsOf(
        singles([{ rows: [SLUG_CODE_HOME], total: 1 }], {
          singles: [{ slug: "home" }],
        })
      )
    ).resolves.toEqual(["home"]);
  });

  it("lists a BUILDER-made Single, whose registry row IS its declaration", async () => {
    // Configuration says nothing about one, so absence from it is not evidence
    // that it was removed.
    await expect(
      slugsOf(
        singles([{ rows: [SLUG_BUILDER_MADE], total: 1 }], { singles: [] })
      )
    ).resolves.toEqual(["made"]);
  });

  it("lists everything when the configuration cannot be enumerated", async () => {
    // An unreadable config is not an empty one: read as declaring nothing,
    // every row would be an orphan and the site's Singles would go unwalked.
    await expect(
      slugsOf(singles([{ rows: [SLUG_CODE_HOME], total: 1 }], {}))
    ).resolves.toEqual(["home"]);
  });

  it("CONTROL: lists none for a steady registry holding no blocks", async () => {
    await expect(
      slugsOf(singles([{ rows: [withoutBlocks, withoutBlocks], total: 2 }]))
    ).resolves.toEqual([]);
  });

  it("CONTROL: still lists a Single that does hold blocks", async () => {
    await expect(
      slugsOf(singles([{ rows: [withBlocks], total: 1 }]))
    ).resolves.toEqual(["with"]);
  });
});
