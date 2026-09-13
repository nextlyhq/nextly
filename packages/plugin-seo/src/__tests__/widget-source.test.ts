/**
 * The SEO issues source: what it counts, what it refuses to claim, and what it
 * does when it cannot read a collection.
 *
 * The service is a stub here so each case can put one shape of data in front of
 * the resolver. It pages the way the real managed service pages -- deriving its
 * window as `(page - 1) * limit` -- because a stub that honoured some friendlier
 * arithmetic would let a paging bug pass here and fail in production.
 *
 * What the stub cannot prove -- that the real service accepts these arguments,
 * and that boot publishes the source at all -- is covered by
 * `widget-source.integration.test.ts` against a real instance.
 */
import { NextlyError, text, type FieldConfig } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { defaultSeoFields } from "../fields";
import {
  checksFor,
  ISSUE_SCAN_PAGE_SIZE,
  ISSUE_FIELD,
  ISSUE_SCAN_ROW_BUDGET,
  issuesFor,
  SEO_ISSUES_SOURCE_ID,
  seoIssuesWidgetSource,
} from "../widget-source";

const caller = { user: { id: "user-1", roles: ["editor"] } };
const countQuery = { source: SEO_ISSUES_SOURCE_ID, op: "count" as const };

/** Every default check, which is what a project that overrides nothing gets. */
const allChecks = checksFor(defaultSeoFields());

/**
 * A collection service holding `rows`, paged the way the managed one pages.
 *
 * 1-indexed by `page`, with the window derived as `(page - 1) * limit` -- the
 * arithmetic the real service uses, and the reason a scan may not narrow its
 * page width partway through.
 */
function servicesWith(
  rows: Record<string, Record<string, unknown>[]>,
  options: {
    lifecycle?: boolean;
    denied?: string[];
    broken?: string[];
    /**
     * Rows an `afterRead` hook left of each page. `hasMore` is still derived
     * from the DATABASE total, the way core derives it, which is the whole
     * point: the response no longer says how much was read.
     */
    survivingPerPage?: number;
  } = {}
) {
  const listEntries = vi.fn(
    async (
      slug: string,
      query: { pagination?: { limit?: number; page?: number } },
      _opts: unknown
    ) => {
      if (options.denied?.includes(slug)) throw NextlyError.forbidden();
      if (options.broken?.includes(slug)) throw new Error(`outage: ${slug}`);
      const all = rows[slug] ?? [];
      const limit = query.pagination?.limit ?? 200;
      const page = query.pagination?.page ?? 1;
      const start = (page - 1) * limit;
      const fetched = all.slice(start, start + limit);
      const hasMore = start + fetched.length < all.length;
      const data =
        options.survivingPerPage === undefined
          ? fetched
          : fetched.slice(0, options.survivingPerPage);
      return { data, pagination: { hasMore } };
    }
  );
  const getCollection = vi.fn(async (slug: string) => {
    if (options.denied?.includes(slug)) throw NextlyError.forbidden();
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

/** A document missing only its title, so it contributes exactly one issue. */
const untitled = { seo: { ...clean.seo, metaTitle: "" } };

async function countFor(
  services: ReturnType<typeof servicesWith>,
  collections: string[],
  extra: {
    signal?: AbortSignal;
    where?: Record<string, unknown>;
    installed?: readonly FieldConfig[];
  } = {}
) {
  const { resolve } = seoIssuesWidgetSource(
    collections,
    extra.installed ?? defaultSeoFields()
  );
  return resolve(
    {
      ...countQuery,
      ...(extra.where === undefined ? {} : { where: extra.where }),
    },
    caller,
    { services } as never,
    extra.signal === undefined ? undefined : { signal: extra.signal }
  );
}

describe("which issues a document has", () => {
  it("finds none when every field is filled in", () => {
    expect(issuesFor(clean, allChecks)).toEqual([]);
  });

  it("names every empty field", () => {
    expect(issuesFor({ seo: {} }, allChecks)).toHaveLength(4);
  });

  it("treats a whitespace-only value as empty", () => {
    // A field someone typed a space into is not filled in, and a check that
    // only tested for null would count it as done.
    expect(
      issuesFor({ seo: { ...clean.seo, metaTitle: "   " } }, allChecks)
    ).toEqual(["Missing meta title"]);
  });

  it("counts a document with no seo group at all", () => {
    // A collection extended after its rows were written has documents with no
    // `seo` key. Reading that as "nothing missing" would hide the entire
    // backlog the card exists to surface.
    expect(issuesFor({ title: "x" }, allChecks)).toHaveLength(4);
  });

  it("reports a noindexed document as ONE issue, not five", () => {
    // 🔴 The other checks ask how a page appears in search, and this page is
    // deliberately not in search -- so they describe problems it cannot have.
    // Counting all five would also weigh one hidden page five times an ordinary
    // one, which is how a count stops being trusted.
    expect(issuesFor({ seo: { noindex: true } }, allChecks)).toEqual([
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

    const result = await countFor(services, ["pages"], {
      signal: controller.signal,
    });

    expect(services.collections.listEntries).not.toHaveBeenCalled();
    expect(result).toEqual({ op: "count", total: 0 });
  });

  it("reads normally when the signal is live", async () => {
    // The must-differ half: a resolver that returned early regardless would
    // satisfy the case above while answering nothing for anyone.
    const controller = new AbortController();
    const services = servicesWith({ pages: [{ seo: {} }] });

    expect(
      await countFor(services, ["pages"], { signal: controller.signal })
    ).toEqual({ op: "count", total: 4 });
  });
});

describe("the published source", () => {
  it("declares the plugin namespace and the op it can answer", () => {
    const { source } = seoIssuesWidgetSource(["pages"], defaultSeoFields());

    expect(source.id).toBe(SEO_ISSUES_SOURCE_ID);
    expect(source.id.startsWith("plugin:")).toBe(true);
    expect(source.kind).toBe("plugin");
    expect(source.supports).toEqual(["count"]);
  });

  it("refuses an op it did not publish", async () => {
    // Validation refuses these before the resolver is reached; the arm exists
    // so a source that later declares an op it cannot answer fails loudly
    // rather than returning a count shaped like something else.
    const { resolve } = seoIssuesWidgetSource(["pages"], defaultSeoFields());

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

describe("the fields a project actually configured", () => {
  it("checks nothing the configured set does not install", async () => {
    // 🔴 `seoPlugin({ fields })` REPLACES the default group. A project that
    // configures `focusKeyword` stores no `metaTitle` on any document, so
    // checks that ran regardless would report every document in the site as
    // missing four things it was never asked to store.
    const services = servicesWith({ pages: [{ seo: { focusKeyword: "x" } }] });

    expect(
      await countFor(services, ["pages"], {
        installed: [text({ name: "focusKeyword" })],
      })
    ).toEqual({ op: "count", total: 0 });
  });

  it("still checks the defaults when nothing is overridden", async () => {
    // The must-differ half: a predicate that checked nothing at all satisfies
    // the case above while reporting a clean site for everyone.
    const services = servicesWith({ pages: [{ seo: { focusKeyword: "x" } }] });

    expect(await countFor(services, ["pages"])).toEqual({
      op: "count",
      total: 4,
    });
  });

  it("checks only the defaults that survive a partial override", async () => {
    const services = servicesWith({ pages: [{ seo: {} }] });

    expect(
      await countFor(services, ["pages"], {
        installed: [text({ name: "metaTitle" }), text({ name: "canonical" })],
      })
    ).toEqual({ op: "count", total: 2 });
  });
});

describe("a query that narrows by issue", () => {
  it("counts only the issue the query named", async () => {
    // 🔴 The source PUBLISHES `issue`, so validation admits a `where` naming
    // it. A resolver that accepted the query and counted every issue anyway
    // would answer a narrower question with a wider number, and nothing
    // downstream could tell.
    const services = servicesWith({ pages: [{ seo: {} }] });

    expect(
      await countFor(services, ["pages"], {
        where: { [ISSUE_FIELD]: { equals: "Missing meta title" } },
      })
    ).toEqual({ op: "count", total: 1 });
  });

  it("counts every issue when the query names none", async () => {
    // The must-differ half: a filter that excluded everything satisfies the
    // case above at a total of zero.
    const services = servicesWith({ pages: [{ seo: {} }] });

    expect(await countFor(services, ["pages"])).toEqual({
      op: "count",
      total: 4,
    });
  });

  it("accepts a set of issues", async () => {
    const services = servicesWith({ pages: [{ seo: {} }] });

    expect(
      await countFor(services, ["pages"], {
        where: {
          [ISSUE_FIELD]: {
            in: ["Missing meta title", "Missing canonical URL"],
          },
        },
      })
    ).toEqual({ op: "count", total: 2 });
  });

  it("refuses an operator it cannot honour, rather than ignoring it", async () => {
    // `issue` is a closed set of labels, so a substring match has no meaning
    // over it -- and silently answering the unfiltered total would be worse
    // than refusing.
    const services = servicesWith({ pages: [{ seo: {} }] });

    await expect(
      countFor(services, ["pages"], {
        where: { [ISSUE_FIELD]: { contains: "title" } },
      })
    ).rejects.toThrow(/cannot filter issues/);
  });
});

describe("a failure that is not a denial", () => {
  it("reaches the card instead of becoming a partial count", async () => {
    // 🔴 A denial is an ordinary fact about the reader. An outage is not:
    // folding it into a successful count shows a figure that is quietly too
    // small, with nothing anywhere to say the scan did not finish.
    const services = servicesWith(
      { pages: [{ seo: {} }], broken: [{ seo: {} }] },
      { broken: ["broken"] }
    );

    await expect(countFor(services, ["pages", "broken"])).rejects.toThrow(
      /outage/
    );
  });
});

describe("what the scan reads", () => {
  it("asks for the SEO group alone, not whole documents", async () => {
    // Without a projection every page carries each document whole -- rich
    // text, blocks, every JSON payload -- so the row cap would bound the row
    // COUNT while the bytes behind it stayed unbounded.
    const services = servicesWith({ pages: [clean] });
    await countFor(services, ["pages"]);

    expect(services.collections.listEntries.mock.calls[0]?.[1]).toMatchObject({
      select: { id: true, seo: true },
      depth: 0,
    });
  });

  it("asks every page for the same width, at ascending pages", async () => {
    // 🔴 The managed service derives its window as `(page - 1) * limit`, so a
    // page narrowed to fit a remaining budget moves BACKWARDS -- page 10 at a
    // limit of 50 starts at row 450, not 1800. Holding the width constant is
    // what makes the offsets correct by construction, so the invariant is
    // asserted directly rather than inferred from a total.
    const rows = Array.from({ length: 1000 }, () => untitled);
    const services = servicesWith({ pages: rows });
    await countFor(services, ["pages"]);

    const pagination = services.collections.listEntries.mock.calls.map(
      call =>
        (call[1] as { pagination: { limit: number; page: number } }).pagination
    );
    expect(pagination.length).toBeGreaterThan(1);
    expect(new Set(pagination.map(p => p.limit)).size).toBe(1);
    expect(pagination.map(p => p.page)).toEqual(
      pagination.map((_unused, index) => index + 1)
    );
  });

  it("stops when a hook leaves fewer rows than the page it came from", async () => {
    // 🔴 `data.length` is what survived the collection's `afterRead` hooks;
    // `hasMore` is computed from the database total, before them. A budget
    // charged on rows RETURNED is therefore never spent by a hook that drops
    // them -- and the scan walks the whole collection, issuing a query and
    // running hooks for every page of it, while claiming a bounded read.
    //
    // Charging the fetch cannot be fooled that way.
    const rows = Array.from({ length: 100_000 }, () => untitled);
    const services = servicesWith({ pages: rows }, { survivingPerPage: 0 });

    const result = await countFor(services, ["pages"]);

    expect(services.collections.listEntries).toHaveBeenCalledTimes(
      ISSUE_SCAN_ROW_BUDGET / ISSUE_SCAN_PAGE_SIZE
    );
    expect(result).toEqual({ op: "count", total: 0, atLeast: true });
  });
});

describe("every where shape a validated query may carry", () => {
  it("reads a bare scalar as the equality it is shorthand for", async () => {
    // 🔴 `validateReadWidgetQuery` accepts `where: { issue: "..." }` as the same
    // request as the `equals` object. Reading only the object form answered the
    // narrowed question with the unfiltered total -- and nothing downstream
    // could tell, because the number is a plausible one.
    const services = servicesWith({ pages: [{ seo: {} }] });

    expect(
      await countFor(services, ["pages"], {
        where: { [ISSUE_FIELD]: "Missing meta title" },
      })
    ).toEqual({ op: "count", total: 1 });
  });

  it("combines an `and` of conditions", async () => {
    const services = servicesWith({ pages: [{ seo: {} }] });

    expect(
      await countFor(services, ["pages"], {
        where: {
          and: [
            {
              [ISSUE_FIELD]: {
                in: ["Missing meta title", "Missing social image"],
              },
            },
            { [ISSUE_FIELD]: { not_equals: "Missing social image" } },
          ],
        },
      })
    ).toEqual({ op: "count", total: 1 });
  });

  it("combines an `or` of conditions", async () => {
    const services = servicesWith({ pages: [{ seo: {} }] });

    expect(
      await countFor(services, ["pages"], {
        where: {
          or: [
            { [ISSUE_FIELD]: { equals: "Missing meta title" } },
            { [ISSUE_FIELD]: { equals: "Missing canonical URL" } },
          ],
        },
      })
    ).toEqual({ op: "count", total: 2 });
  });

  it("refuses a field it never published", async () => {
    // Unreachable for a validated query, since the source declares one field --
    // but ignoring it is what turns a narrowed question into a wider answer, so
    // it refuses rather than passing everything.
    const services = servicesWith({ pages: [{ seo: {} }] });

    await expect(
      countFor(services, ["pages"], { where: { slug: { equals: "x" } } })
    ).rejects.toThrow(/cannot filter on that field/);
  });
});

describe("a field the caller may not read", () => {
  it("is not checked, because redaction is not absence", async () => {
    // 🔴 A field carrying `access.read` may be stripped from the row before this
    // source sees it, and a stripped value looks exactly like one nobody filled
    // in. Checking it would report every document the caller CAN see as missing
    // a field that is populated and merely hidden from them.
    const guarded = {
      ...text({ name: "metaTitle" }),
      access: { read: () => false },
    } as unknown as FieldConfig;
    const services = servicesWith({ pages: [{ seo: {} }] });

    expect(
      await countFor(services, ["pages"], {
        installed: [guarded, text({ name: "canonical" })],
      })
    ).toEqual({ op: "count", total: 1 });
  });

  it("is checked when it declares no rule of its own", async () => {
    // The must-differ half: excluding every field satisfies the case above at a
    // total of zero, and would report a clean site for everyone.
    const services = servicesWith({ pages: [{ seo: {} }] });

    expect(
      await countFor(services, ["pages"], {
        installed: [text({ name: "metaTitle" }), text({ name: "canonical" })],
      })
    ).toEqual({ op: "count", total: 2 });
  });
});
