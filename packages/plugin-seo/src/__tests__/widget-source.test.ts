/**
 * The SEO issues source: what it counts, what it refuses to claim, and what it
 * does when it cannot read a collection.
 *
 * The service is a stub here so each case can put one shape of data in front of
 * the resolver. What the stub cannot prove -- that the real managed service
 * accepts these arguments, and that boot publishes the source at all -- is
 * covered by `widget-source.integration.test.ts` against a real instance.
 */
import { describe, expect, it, vi } from "vitest";

import {
  ISSUE_SCAN_ROW_BUDGET,
  issuesFor,
  SEO_ISSUES_SOURCE_ID,
  seoIssuesWidgetSource,
} from "../widget-source";

const caller = { user: { id: "user-1", roles: ["editor"] } };
const countQuery = { source: SEO_ISSUES_SOURCE_ID, op: "count" as const };

/**
 * A collection service holding `rows`, paged the way the managed one pages.
 *
 * 1-indexed by `page`, because that is what the real service reads -- a stub
 * that honoured an offset would let a paging bug pass here and fail in
 * production.
 */
function servicesWith(
  rows: Record<string, Record<string, unknown>[]>,
  options: { lifecycle?: boolean; denied?: string[] } = {}
) {
  const listEntries = vi.fn(
    async (
      slug: string,
      query: { pagination?: { limit?: number; page?: number } },
      _opts: unknown
    ) => {
      if (options.denied?.includes(slug)) {
        throw new Error(`denied: ${slug}`);
      }
      const all = rows[slug] ?? [];
      const limit = query.pagination?.limit ?? 200;
      const page = query.pagination?.page ?? 1;
      const start = (page - 1) * limit;
      const data = all.slice(start, start + limit);
      return {
        data,
        pagination: { hasMore: start + data.length < all.length },
      };
    }
  );
  const getCollection = vi.fn(async (slug: string) => {
    if (options.denied?.includes(slug)) throw new Error(`denied: ${slug}`);
    return { status: options.lifecycle === true };
  });
  return { collections: { getCollection, listEntries } };
}

/** A document whose SEO group is filled in completely. */
const clean = {
  seo: {
    metaTitle: "T",
    metaDescription: "D",
    canonical: "https://example.com/x",
    ogImage: "media-1",
    noindex: false,
  },
};

async function countFor(
  services: ReturnType<typeof servicesWith>,
  collections: string[],
  signal?: AbortSignal
) {
  const { resolve } = seoIssuesWidgetSource(collections);
  return resolve(
    countQuery,
    caller,
    { services } as never,
    signal === undefined ? undefined : { signal }
  );
}

describe("which issues a document has", () => {
  it("finds none when every field is filled in", () => {
    expect(issuesFor(clean)).toEqual([]);
  });

  it("names every empty field", () => {
    expect(issuesFor({ seo: {} })).toHaveLength(4);
  });

  it("treats a whitespace-only value as empty", () => {
    // A field someone typed a space into is not filled in, and a check that
    // only tested for null would count it as done.
    expect(issuesFor({ seo: { ...clean.seo, metaTitle: "   " } })).toEqual([
      "Missing meta title",
    ]);
  });

  it("counts a document with no seo group at all", () => {
    // A collection extended after its rows were written has documents with no
    // `seo` key. Reading that as "nothing missing" would hide the entire
    // backlog the card exists to surface.
    expect(issuesFor({ title: "x" })).toHaveLength(4);
  });

  it("reports a noindexed document as ONE issue, not five", () => {
    // 🔴 The other checks ask how a page appears in search, and this page is
    // deliberately not in search -- so they describe problems it cannot have.
    // Counting all five would also weigh one hidden page five times an ordinary
    // one, which is how a count stops being trusted.
    expect(issuesFor({ seo: { noindex: true } })).toEqual([
      "Hidden from search engines",
    ]);
  });
});

describe("counting across collections", () => {
  it("sums the issues in every configured collection", async () => {
    const services = servicesWith({
      pages: [{ seo: {} }, clean],
      posts: [{ seo: { metaTitle: "T" } }],
    });

    // 4 from the empty page, 0 from the clean one, 3 from the post.
    expect(await countFor(services, ["pages", "posts"])).toEqual({
      op: "count",
      total: 7,
    });
  });

  it("scopes every read to the caller", async () => {
    // 🔴 The whole authorization story. A count assembled as `system` would be
    // the same figure for everyone, and would tell an author how much content
    // exists that they cannot read.
    const services = servicesWith({ pages: [clean] });
    await countFor(services, ["pages"]);

    const opts = services.collections.listEntries.mock.calls[0]?.[2];
    expect(opts).toMatchObject({ as: "user", user: caller.user });
  });

  it("counts a collection the caller cannot read as zero", async () => {
    // The managed service THROWS on a full denial rather than returning an
    // empty page, so an uncaught refusal would blank the whole card over one
    // unreadable collection.
    const services = servicesWith(
      { pages: [{ seo: {} }], secret: [{ seo: {} }] },
      { denied: ["secret"] }
    );

    expect(await countFor(services, ["pages", "secret"])).toEqual({
      op: "count",
      total: 4,
    });
  });

  it("asks only for published documents where a lifecycle exists", async () => {
    // A draft's SEO is not what search engines see, so a missing title on one
    // is not yet a problem the site has.
    const services = servicesWith({ pages: [clean] }, { lifecycle: true });
    await countFor(services, ["pages"]);

    expect(services.collections.listEntries.mock.calls[0]?.[1]).toMatchObject({
      where: { status: { equals: "published" } },
    });
  });

  it("does not filter on status where the collection has no lifecycle", async () => {
    // The must-differ half: such a collection has no `status` column, and may
    // define an ordinary field by that name, so filtering would drop live rows.
    const services = servicesWith({ pages: [clean] }, { lifecycle: false });
    await countFor(services, ["pages"]);

    expect(
      services.collections.listEntries.mock.calls[0]?.[1]
    ).not.toHaveProperty("where");
  });
});

describe("the row budget", () => {
  it("says the total is a floor once it binds", async () => {
    // One issue per row, so the total is the number of rows read and the bound
    // is visible in the number as well as in the flag.
    const rows = Array.from({ length: ISSUE_SCAN_ROW_BUDGET + 50 }, () => ({
      seo: { ...clean.seo, metaTitle: "" },
    }));

    expect(await countFor(servicesWith({ pages: rows }), ["pages"])).toEqual({
      op: "count",
      total: ISSUE_SCAN_ROW_BUDGET,
      atLeast: true,
    });
  });

  it("claims nothing when the corpus fits inside it", async () => {
    // The must-differ half: an `atLeast` set unconditionally satisfies the case
    // above on its own, and would make every exact count read as approximate.
    const rows = Array.from({ length: 3 }, () => ({
      seo: { ...clean.seo, metaTitle: "" },
    }));

    expect(await countFor(servicesWith({ pages: rows }), ["pages"])).toEqual({
      op: "count",
      total: 3,
    });
  });

  it("bounds the whole answer, not each collection", async () => {
    // A per-collection budget multiplies by however many collections a project
    // configures, which is the opposite of a bound.
    const rows = (n: number) =>
      Array.from({ length: n }, () => ({
        seo: { ...clean.seo, metaTitle: "" },
      }));
    const services = servicesWith({
      a: rows(ISSUE_SCAN_ROW_BUDGET),
      b: rows(ISSUE_SCAN_ROW_BUDGET),
    });

    const result = await countFor(services, ["a", "b"]);
    expect(result).toEqual({
      op: "count",
      total: ISSUE_SCAN_ROW_BUDGET,
      atLeast: true,
    });
  });
});

describe("cancellation", () => {
  it("stops scanning once the host has stopped waiting", async () => {
    const controller = new AbortController();
    controller.abort();
    const services = servicesWith({ pages: [{ seo: {} }] });

    const result = await countFor(services, ["pages"], controller.signal);

    expect(services.collections.listEntries).not.toHaveBeenCalled();
    expect(result).toEqual({ op: "count", total: 0 });
  });

  it("reads normally when the signal is live", async () => {
    // The must-differ half: a resolver that returned early regardless would
    // satisfy the case above while answering nothing for anyone.
    const controller = new AbortController();
    const services = servicesWith({ pages: [{ seo: {} }] });

    expect(await countFor(services, ["pages"], controller.signal)).toEqual({
      op: "count",
      total: 4,
    });
  });
});

describe("the published source", () => {
  it("declares the plugin namespace and the op it can answer", () => {
    const { source } = seoIssuesWidgetSource(["pages"]);

    expect(source.id).toBe(SEO_ISSUES_SOURCE_ID);
    expect(source.id.startsWith("plugin:")).toBe(true);
    expect(source.kind).toBe("plugin");
    expect(source.supports).toEqual(["count"]);
  });

  it("refuses an op it did not publish", async () => {
    // Validation refuses these before the resolver is reached; the arm exists
    // so a source that later declares an op it cannot answer fails loudly
    // rather than returning a count shaped like something else.
    const { resolve } = seoIssuesWidgetSource(["pages"]);

    await expect(
      resolve(
        { source: SEO_ISSUES_SOURCE_ID, op: "list" } as never,
        caller,
        { services: servicesWith({}) } as never,
        undefined
      )
    ).rejects.toThrow(/answers "count"/);
  });
});
