/**
 * The SEO issues scan: which issues a document has, what a scan counts, and
 * what it refuses to claim.
 *
 * The read services are a stub here so each case can put one shape of data in
 * front of the scan. The stub answers `find` the way core answers a widget's
 * read: rows ordered by id, a `where` on the id honoured, the limit clamped to
 * the fifty rows core allows, and `total` counted over every row that matched
 * before any row was dropped. A stub that honoured a friendlier rule would let
 * a paging bug pass here and fail in production.
 *
 * What the stub cannot prove -- that core accepts these reads, and that each
 * runs as the person asking -- is covered by `widget-source.integration.test.ts`
 * against a real instance.
 */
import { text, type FieldConfig } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { defaultSeoFields } from "../fields";
import {
  checksFor,
  ISSUE_SCAN_PAGE_SIZE,
  ISSUE_SCAN_ROW_BUDGET,
  issuesFor,
  scanBudget,
  tallyIssues,
} from "../widget-source";

/** Every default check, which is what a project that overrides nothing gets. */
const allChecks = checksFor(defaultSeoFields());

/** The most rows core answers one widget read with, whatever it asks for. */
const CORE_READ_CAP = 50;

interface FindOptions {
  where?: { id?: { greater_than?: string } };
  sort?: string;
  limit?: number;
  select?: readonly string[];
  total?: true;
  status?: string;
}

/**
 * Read services holding `rows` per collection, answering `find` as core does.
 *
 * Each row is given an id that sorts as its position does (`r0001`, ...), so
 * the order by id is the order written.
 */
function servicesWith(
  rows: Record<string, Record<string, unknown>[]>,
  options: {
    /** Rows a hook or a reader's rule left of each page; `total` still counts them all. */
    survivingPerPage?: number;
    /** Collections whose every read fails. */
    broken?: string[];
    /**
     * An `afterRead` hook's id for each row it answers. The `where` and the
     * `total` still read the stored ids, as the database does.
     */
    rewriteId?: (stored: string) => string;
  } = {}
) {
  const withIds = Object.fromEntries(
    Object.entries(rows).map(([slug, list]) => [
      slug,
      list.map((row, index) => ({
        id: `r${String(index).padStart(4, "0")}`,
        ...row,
      })),
    ])
  );
  const find = vi.fn(async (slug: string, opts: FindOptions = {}) => {
    if (options.broken?.includes(slug)) throw new Error(`outage: ${slug}`);
    const after = opts.where?.id?.greater_than;
    const matched = (withIds[slug] ?? []).filter(
      row => after === undefined || row.id > after
    );
    const limit = Math.min(opts.limit ?? 5, CORE_READ_CAP);
    const fetched = matched.slice(0, limit);
    const survived =
      options.survivingPerPage === undefined
        ? fetched
        : fetched.slice(0, options.survivingPerPage);
    const { rewriteId } = options;
    const items =
      rewriteId === undefined
        ? survived
        : survived.map(row => ({ ...row, id: rewriteId(row.id) }));
    return {
      items,
      ...(opts.total === true ? { total: matched.length } : {}),
    };
  });
  return { find } as unknown as Parameters<typeof tallyIssues>[0] & {
    find: typeof find;
  };
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

/** `n` untitled documents. */
const untitledRows = (n: number) => Array.from({ length: n }, () => untitled);

/** The tally as a plain object, by issue label. */
async function tallied(
  services: ReturnType<typeof servicesWith>,
  collections: string[],
  installed: readonly FieldConfig[] = defaultSeoFields()
) {
  const tally = await tallyIssues(services, collections, checksFor(installed));
  return {
    byIssue: Object.fromEntries(tally.byIssue),
    bounded: tally.bounded,
  };
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

describe("the fields a project actually configured", () => {
  it("checks nothing the configured set does not install", async () => {
    // 🔴 `seoPlugin({ fields })` REPLACES the default group. A project that
    // configures `focusKeyword` stores no `metaTitle` on any document, so
    // checks that ran regardless would report every document in the site as
    // missing four things it was never asked to store.
    const services = servicesWith({ pages: [{ seo: { focusKeyword: "x" } }] });

    expect(
      await tallied(services, ["pages"], [text({ name: "focusKeyword" })])
    ).toEqual({ byIssue: {}, bounded: false });
  });

  it("still checks the defaults when nothing is overridden", async () => {
    // The must-differ half: a predicate that checked nothing at all satisfies
    // the case above while reporting a clean site for everyone.
    const services = servicesWith({ pages: [{ seo: { focusKeyword: "x" } }] });

    expect(
      Object.keys((await tallied(services, ["pages"])).byIssue)
    ).toHaveLength(4);
  });

  it("checks only the defaults that survive a partial override", async () => {
    const services = servicesWith({ pages: [{ seo: {} }] });

    expect(
      await tallied(
        services,
        ["pages"],
        [text({ name: "metaTitle" }), text({ name: "canonical" })]
      )
    ).toEqual({
      byIssue: { "Missing meta title": 1, "Missing canonical URL": 1 },
      bounded: false,
    });
  });
});

describe("a field the reader may not read", () => {
  it("is not checked, because redaction is not absence", async () => {
    // 🔴 A field carrying `access.read` may be stripped from the row before the
    // scan sees it, and a stripped value looks exactly like one nobody filled
    // in. Checking it would report every document the reader CAN see as
    // missing a field that is populated and merely hidden from them.
    const guarded = {
      ...text({ name: "metaTitle" }),
      access: { read: () => false },
    } as unknown as FieldConfig;
    const services = servicesWith({ pages: [{ seo: {} }] });

    expect(
      await tallied(services, ["pages"], [guarded, text({ name: "canonical" })])
    ).toEqual({ byIssue: { "Missing canonical URL": 1 }, bounded: false });
  });
});

describe("counting across collections", () => {
  it("tallies the issues in every configured collection, by kind", async () => {
    const services = servicesWith({
      pages: [untitled, clean],
      posts: [untitled, { seo: { noindex: true } }],
    });

    expect(await tallied(services, ["pages", "posts"])).toEqual({
      byIssue: { "Missing meta title": 2, "Hidden from search engines": 1 },
      bounded: false,
    });
  });

  it("reads no collection it was not configured with", async () => {
    const services = servicesWith({ pages: [untitled], other: [untitled] });

    await tallied(services, ["pages"]);

    expect(services.find.mock.calls.map(([slug]) => slug)).toEqual(["pages"]);
  });

  it("lets a failing read reach the card instead of becoming a partial count", async () => {
    // 🔴 A database outage or a failing hook folded into a smaller number shows
    // a figure that is quietly too small, with nothing anywhere to say the scan
    // did not finish. Core fails the card or the item that threw, alone.
    const services = servicesWith(
      { pages: [untitled], posts: [untitled] },
      { broken: ["posts"] }
    );

    await expect(tallied(services, ["pages", "posts"])).rejects.toThrow(
      /outage: posts/
    );
  });
});

describe("what the scan reads", () => {
  it("asks for the SEO group and the id alone, links unexpanded, ordered by id, counting what matched", async () => {
    const services = servicesWith({ pages: [untitled] });

    await tallied(services, ["pages"]);

    expect(services.find).toHaveBeenCalledWith("pages", {
      select: ["id", "seo"],
      sort: "id",
      limit: ISSUE_SCAN_PAGE_SIZE,
      total: true,
      depth: 0,
    });
  });

  it("names no status, leaving which rows are public to core", async () => {
    // Core reads a person's query with no status as the public states the
    // collection's workflow declares. A `published` written here would drop
    // live content on a workflow that names its public state otherwise.
    const services = servicesWith({ pages: [untitled] });

    await tallied(services, ["pages"]);

    for (const [, opts] of services.find.mock.calls) {
      expect(opts).not.toHaveProperty("status");
    }
  });

  it("asks no more rows of a read than core answers one with", () => {
    // 🔴 Core clamps a read to fifty rows. A page size above it reads every
    // full page as short, which the paging takes for the last one.
    expect(ISSUE_SCAN_PAGE_SIZE).toBeLessThanOrEqual(CORE_READ_CAP);
  });

  it("continues each page from the last row of the one before, and reads every row once", async () => {
    const rows = ISSUE_SCAN_PAGE_SIZE * 2 + 7;
    const services = servicesWith({ pages: untitledRows(rows) });

    expect(await tallied(services, ["pages"])).toEqual({
      byIssue: { "Missing meta title": rows },
      bounded: false,
    });
    const cursors = services.find.mock.calls.map(
      ([, opts]) => opts?.where?.id?.greater_than
    );
    expect(cursors).toEqual([undefined, "r0049", "r0099"]);
  });

  it("says its counts are floors when a hook leaves rows of the last page out", async () => {
    // 🔴 The rows a page answers are what survived the reader's rules and the
    // collection's hooks; `total` counted every row that matched. Each page
    // continues from the last row it answered, so a short page is never taken
    // for the last one: 30 of rows 0-49, 30 of rows 30-79, 30 of rows 60-99.
    // That last page answered 30 of the 40 it matched, so the ten rows after
    // it went unread, and an exact 90 would say there are no more.
    const rows = ISSUE_SCAN_PAGE_SIZE * 2;
    const services = servicesWith(
      { pages: untitledRows(rows) },
      { survivingPerPage: 30 }
    );

    expect(await tallied(services, ["pages"])).toEqual({
      byIssue: { "Missing meta title": 90 },
      bounded: true,
    });
    expect(services.find).toHaveBeenCalledTimes(3);
  });

  it("is exact when the last page answers every row it matched, the control", async () => {
    const rows = ISSUE_SCAN_PAGE_SIZE * 2;
    const services = servicesWith(
      { pages: untitledRows(rows) },
      { survivingPerPage: ISSUE_SCAN_PAGE_SIZE }
    );

    expect(await tallied(services, ["pages"])).toEqual({
      byIssue: { "Missing meta title": rows },
      bounded: false,
    });
  });

  it("stops, and says its counts are floors, when a page answers no row while more matched", async () => {
    const services = servicesWith(
      { pages: untitledRows(ISSUE_SCAN_PAGE_SIZE + 1) },
      { survivingPerPage: 0 }
    );

    expect(await tallied(services, ["pages"])).toEqual({
      byIssue: {},
      bounded: true,
    });
    expect(services.find).toHaveBeenCalledTimes(1);
  });
});

describe("a hook that rewrites the ids it answers", () => {
  // 🔴 The cursor is the id a row came back with, and the next page asks for
  // the stored ids after it. Rewritten, it can pass every stored id or none.
  const rows = ISSUE_SCAN_PAGE_SIZE * 2 + 7;

  it("stops with floors when the rewritten cursor passes every stored id", async () => {
    // "z" sorts after every stored id, so the next page matches nothing: read
    // as the end, the scan reports the first page as the whole collection.
    const services = servicesWith(
      { pages: untitledRows(rows) },
      { rewriteId: stored => `z${stored}` }
    );

    expect(await tallied(services, ["pages"])).toEqual({
      byIssue: { "Missing meta title": ISSUE_SCAN_PAGE_SIZE },
      bounded: true,
    });
  });

  it("stops with floors, counting no row twice, when the rewritten cursor passes none", async () => {
    // "a" sorts before every stored id, so each page would be the first again:
    // read on, the scan counts the same rows until its budget runs out.
    const services = servicesWith(
      { pages: untitledRows(rows) },
      { rewriteId: stored => `a${stored}` }
    );

    expect(await tallied(services, ["pages"])).toEqual({
      byIssue: { "Missing meta title": ISSUE_SCAN_PAGE_SIZE },
      bounded: true,
    });
    expect(services.find).toHaveBeenCalledTimes(2);
  });

  it("reads every row when the hook leaves the ids as stored, the control", async () => {
    const services = servicesWith(
      { pages: untitledRows(rows) },
      { rewriteId: stored => stored }
    );

    expect(await tallied(services, ["pages"])).toEqual({
      byIssue: { "Missing meta title": rows },
      bounded: false,
    });
  });
});

describe("a budget handed to several tallies", () => {
  it("bounds them together, each tally after it spent saying floors", async () => {
    // Two tallies sharing one budget read one budget's pages between them.
    const services = servicesWith({
      pages: untitledRows(ISSUE_SCAN_ROW_BUDGET * 2),
      posts: untitledRows(ISSUE_SCAN_ROW_BUDGET * 2),
    });
    const budget = scanBudget();

    const [pages, posts] = await Promise.all([
      tallyIssues(services, ["pages"], allChecks, budget),
      tallyIssues(services, ["posts"], allChecks, budget),
    ]);

    expect(services.find).toHaveBeenCalledTimes(
      ISSUE_SCAN_ROW_BUDGET / ISSUE_SCAN_PAGE_SIZE
    );
    expect([pages.bounded, posts.bounded]).toEqual([true, true]);
    expect(budget.pagesLeft).toBe(0);
  });
});

describe("the row budget", () => {
  it("says the counts are floors once it binds", async () => {
    const services = servicesWith({
      pages: untitledRows(ISSUE_SCAN_ROW_BUDGET + 1),
    });

    expect(await tallied(services, ["pages"])).toEqual({
      byIssue: { "Missing meta title": ISSUE_SCAN_ROW_BUDGET },
      bounded: true,
    });
    expect(services.find).toHaveBeenCalledTimes(
      ISSUE_SCAN_ROW_BUDGET / ISSUE_SCAN_PAGE_SIZE
    );
  });

  it("claims nothing when the corpus fits inside it", async () => {
    const services = servicesWith({
      pages: untitledRows(ISSUE_SCAN_ROW_BUDGET),
    });

    expect(await tallied(services, ["pages"])).toEqual({
      byIssue: { "Missing meta title": ISSUE_SCAN_ROW_BUDGET },
      bounded: false,
    });
  });

  it("bounds the whole answer, not each collection", async () => {
    // A per-collection budget would multiply by however many collections a
    // project configures, which is the opposite of a bound.
    // Each collection three quarters of the budget, so the second is cut
    // partway: what it may read is what the first left, not a budget of its own.
    const each = (ISSUE_SCAN_ROW_BUDGET * 3) / 4;
    const services = servicesWith({
      pages: untitledRows(each),
      posts: untitledRows(each),
      docs: untitledRows(each),
    });

    expect(await tallied(services, ["pages", "posts", "docs"])).toEqual({
      byIssue: { "Missing meta title": ISSUE_SCAN_ROW_BUDGET },
      bounded: true,
    });
    expect(services.find).toHaveBeenCalledTimes(
      ISSUE_SCAN_ROW_BUDGET / ISSUE_SCAN_PAGE_SIZE
    );
    expect(services.find.mock.calls.map(([slug]) => slug)).not.toContain(
      "docs"
    );
  });

  it("bounds the pages fetched, whatever a hook leaves of them", async () => {
    // 🔴 A hook that drops rows leaves a row counter untouched while paging
    // continues; counting fetches cannot be fooled that way.
    const services = servicesWith(
      { pages: untitledRows(ISSUE_SCAN_ROW_BUDGET * 3) },
      { survivingPerPage: 1 }
    );

    const result = await tallied(services, ["pages"]);

    expect(result.bounded).toBe(true);
    expect(services.find).toHaveBeenCalledTimes(
      ISSUE_SCAN_ROW_BUDGET / ISSUE_SCAN_PAGE_SIZE
    );
  });
});
