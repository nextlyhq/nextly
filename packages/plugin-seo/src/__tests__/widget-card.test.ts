/**
 * The SEO issues card and its Needs attention line: what each declares, and
 * what each answers from a scan.
 *
 * The read services are a stub, so each case can put one shape of data in
 * front of the card's `load` and the item's `count`. That core accepts both
 * declarations at boot, and that each reads as the person asking, is
 * `widget-source.integration.test.ts`'s job, against a real instance.
 */
import { text } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { defaultSeoFields } from "../fields";
import {
  SEO_ISSUES_WIDGET_ID,
  seoIssuesAttentionItem,
  seoIssuesWidget,
} from "../widget-card";
import { ISSUE_SCAN_ROW_BUDGET } from "../widget-source";

/** The fields of a declaration this file reads, which the contribution type does not name. */
interface Declared {
  id: string;
  view: unknown;
  size: { default: { w: number; h: number }; min?: { w: number; h: number } };
  access?: unknown;
  skeleton?: unknown;
  empty?: { message?: string };
  load: (input: { services: unknown }) => Promise<unknown>;
}

function declared(card: ReturnType<typeof seoIssuesWidget>): Declared {
  if (card === undefined) throw new Error("expected a card");
  return card as unknown as Declared;
}

/** Read services whose every collection holds `rows`, all on one page. */
function servicesHolding(rows: Record<string, Record<string, unknown>[]>) {
  const find = vi.fn(async (slug: string) => ({
    items: rows[slug] ?? [],
    total: (rows[slug] ?? []).length,
  }));
  return { find };
}

/** Read services whose one collection holds more rows than a scan reads. */
function servicesPastTheBudget() {
  let next = 0;
  const find = vi.fn(async () => {
    const items = Array.from({ length: 50 }, () => ({
      id: `r${String(next++).padStart(6, "0")}`,
      seo: {},
    }));
    return { items, total: ISSUE_SCAN_ROW_BUDGET * 2 };
  });
  return { find };
}

describe("the SEO issues card", () => {
  it("is declared as seo/issues, drawn by core's bars view", () => {
    const card = declared(seoIssuesWidget(["pages"], defaultSeoFields()));

    expect(card.id).toBe(SEO_ISSUES_WIDGET_ID);
    expect(SEO_ISSUES_WIDGET_ID).toBe("seo/issues");
    expect(card.view).toBe("bars");
    expect(card.skeleton).toBe("bars");
  });

  it("is offered only to a person who may read every collection it reads", () => {
    // 🔴 Core judges `{ collections }` before `load` runs: a person refused it is
    // told the card is not available, never shown a number about content they
    // cannot read.
    const card = declared(
      seoIssuesWidget(["pages", "posts"], defaultSeoFields())
    );

    expect(card.access).toEqual({ collections: ["pages", "posts"] });
  });

  it("states its size in grid units, at least three rows tall", () => {
    const { size } = declared(seoIssuesWidget(["pages"], defaultSeoFields()));

    expect(size.default).toEqual({ w: 4, h: 3 });
    expect(size.min?.h ?? size.default.h).toBeGreaterThanOrEqual(3);
  });

  it("answers one bar per issue found, in the order a reader should meet them", async () => {
    // Priority, not declaration convenience: an unintended `noindex` and a
    // missing title both take a page out of search, where a missing social
    // image changes how a link previews.
    const card = declared(seoIssuesWidget(["pages"], defaultSeoFields()));
    const services = servicesHolding({
      pages: [
        { id: "a", seo: { noindex: true } },
        { id: "b", seo: { metaDescription: "D", canonical: "C" } },
      ],
    });

    expect(await card.load({ services })).toEqual({
      buckets: [
        { value: "Hidden from search engines", count: 1 },
        { value: "Missing meta title", count: 1 },
        { value: "Missing social image", count: 1 },
      ],
    });
  });

  it("answers no bars for a site with nothing to fix, so the frame draws its empty state", async () => {
    // A chart of zeros says less than "No SEO issues", and is not empty by the
    // bars view's own rule.
    const card = declared(seoIssuesWidget(["pages"], defaultSeoFields()));
    const services = servicesHolding({
      pages: [
        {
          id: "a",
          seo: {
            metaTitle: "T",
            metaDescription: "D",
            canonical: "C",
            ogImage: "m",
          },
        },
      ],
    });

    expect(await card.load({ services })).toEqual({ buckets: [] });
    expect(card.empty?.message).toBe("No SEO issues in published pages.");
  });

  it("says its counts are floors when the scan stopped at its bound", async () => {
    const card = declared(seoIssuesWidget(["pages"], defaultSeoFields()));

    expect(await card.load({ services: servicesPastTheBudget() })).toEqual({
      buckets: expect.any(Array),
      atLeast: true,
    });
  });

  it("reads the collections it was configured with, and no other", async () => {
    const card = declared(
      seoIssuesWidget(["pages", "posts"], defaultSeoFields())
    );
    const services = servicesHolding({ pages: [], posts: [] });

    await card.load({ services });

    expect(services.find.mock.calls.map(([slug]) => slug)).toEqual([
      "pages",
      "posts",
    ]);
  });

  it("is withheld when no collection carries the fields", () => {
    // 🔴 A plugin registered with no collections extends nothing, so every bar
    // would answer zero: a clean site reported for a plugin doing nothing.
    expect(seoIssuesWidget([], defaultSeoFields())).toBeUndefined();
  });

  it("is withheld when nothing it understands is installed", () => {
    expect(
      seoIssuesWidget(["pages"], [text({ name: "focusKeyword" })])
    ).toBeUndefined();
  });
});

describe("the SEO issues line of Needs attention", () => {
  it("names the collections it checks, which decide who sees it", () => {
    // 🔴 Core shows an item with `collections` only to a reader of at least one
    // of them, and limits its reads to them, as that reader.
    const item = seoIssuesAttentionItem(["pages", "posts"], defaultSeoFields());

    expect(item).toMatchObject({
      id: "seo/issues",
      label: "SEO issues in published pages",
      collections: ["pages", "posts"],
      link: "collections/pages",
    });
    expect(item).not.toHaveProperty("permission");
  });

  it("counts every issue in the collections it reads", async () => {
    const item = seoIssuesAttentionItem(["pages", "posts"], defaultSeoFields());
    const services = servicesHolding({
      pages: [{ id: "a", seo: { noindex: true } }],
      posts: [{ id: "b", seo: {} }],
    });

    // One hidden page, and four gaps on the other.
    expect(
      await item?.count({ services } as unknown as Parameters<
        NonNullable<typeof item>["count"]
      >[0])
    ).toBe(5);
  });

  it("says its count is a floor when the scan stopped at its bound", async () => {
    const item = seoIssuesAttentionItem(["pages"], defaultSeoFields());

    expect(
      await item?.count({
        services: servicesPastTheBudget(),
      } as unknown as Parameters<NonNullable<typeof item>["count"]>[0])
    ).toEqual({ count: ISSUE_SCAN_ROW_BUDGET * 4, atLeast: true });
  });

  it("is withheld where the card is", () => {
    expect(seoIssuesAttentionItem([], defaultSeoFields())).toBeUndefined();
    expect(
      seoIssuesAttentionItem(["pages"], [text({ name: "focusKeyword" })])
    ).toBeUndefined();
  });
});
