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
  seoIssuesAttentionItems,
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
  preview?: readonly {
    name: string;
    data: { buckets: { value: string; count: number }[] };
  }[];
  load: (input: { services: unknown }) => Promise<unknown>;
}

/** The issue each bar of the card's preview cases names, case by case. */
const previewedIssues = (card: Declared) =>
  (card.preview ?? []).map(sample =>
    sample.data.buckets.map(bucket => bucket.value)
  );

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
    // How many rows match after the cursor: twice the budget, less what the
    // pages before this one answered, as the stored ids count them.
    const total = ISSUE_SCAN_ROW_BUDGET * 2 - next;
    const items = Array.from({ length: 50 }, () => ({
      id: `r${String(next++).padStart(6, "0")}`,
      seo: {},
    }));
    return { items, total };
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

  it("previews a bar for each check the configured fields install, and no other", () => {
    // 🔴 The preview page draws the card from these cases, so a bar there for
    // a field the project never installed shows a check the card can never
    // make: a canonical-only project previews the canonical check alone.
    expect(
      previewedIssues(
        declared(seoIssuesWidget(["pages"], [text({ name: "canonical" })]))
      )
    ).toEqual([["Missing canonical URL"]]);
    // Every default check, in the order the card draws them.
    expect(
      previewedIssues(declared(seoIssuesWidget(["pages"], defaultSeoFields())))
    ).toEqual([
      [
        "Hidden from search engines",
        "Missing meta title",
        "Missing canonical URL",
        "Missing meta description",
        "Missing social image",
      ],
    ]);
  });

  it("is withheld when nothing it understands is installed", () => {
    expect(
      seoIssuesWidget(["pages"], [text({ name: "focusKeyword" })])
    ).toBeUndefined();
  });
});

/** What an item's `count` is handed, here the read services alone. */
type CountInput = Parameters<
  ReturnType<typeof seoIssuesAttentionItems>[number]["count"]
>[0];
const countWith = (services: unknown) =>
  ({ services }) as unknown as CountInput;

describe("the SEO issues lines of Needs attention", () => {
  it("are one per configured collection, each naming, linking to and counting its own", async () => {
    // 🔴 An item's link is one path for everyone it shows to, and core shows an
    // item to a reader of any collection it names. One collection per item is
    // what makes the link one every reader of the line can open.
    const items = seoIssuesAttentionItems(
      ["pages", "posts"],
      defaultSeoFields()
    );

    expect(
      items.map(({ id, label, collections, link }) => ({
        id,
        label,
        collections,
        link,
      }))
    ).toEqual([
      {
        id: "seo/issues-pages",
        label: "SEO issues in pages",
        collections: ["pages"],
        link: "collections/pages",
      },
      {
        id: "seo/issues-posts",
        label: "SEO issues in posts",
        collections: ["posts"],
        link: "collections/posts",
      },
    ]);
    for (const item of items) expect(item).not.toHaveProperty("permission");

    // Each counts its own collection, and reads no other.
    const services = servicesHolding({
      pages: [{ id: "a", seo: { noindex: true } }],
      posts: [{ id: "b", seo: {} }],
    });
    expect(
      await Promise.all(items.map(item => item.count(countWith(services))))
    ).toEqual([1, 4]);
    expect(services.find.mock.calls.map(([slug]) => slug).sort()).toEqual([
      "pages",
      "posts",
    ]);
  });

  it("list the first ten collections, while the card counts every one", async () => {
    // Core refuses an eleventh item from one plugin at startup, so the first
    // ten collections get a line each and the eleventh none. The card still
    // reads all eleven, so no issue goes uncounted where a reader may see it.
    const slugs = Array.from({ length: 11 }, (_, i) => `c${i + 1}`);
    const items = seoIssuesAttentionItems(slugs, defaultSeoFields());

    expect(items.map(item => item.collections)).toEqual(
      slugs.slice(0, 10).map(slug => [slug])
    );
    expect(items.map(item => item.link)).toEqual(
      slugs.slice(0, 10).map(slug => `collections/${slug}`)
    );

    const card = declared(seoIssuesWidget(slugs, defaultSeoFields()));
    const services = servicesHolding(
      Object.fromEntries(
        slugs.map(slug => [slug, [{ id: `${slug}-1`, seo: { noindex: true } }]])
      )
    );
    expect(await card.load({ services })).toEqual({
      buckets: [{ value: "Hidden from search engines", count: 11 }],
    });
    expect(services.find.mock.calls.map(([slug]) => slug)).toEqual(slugs);
  });

  it("take ids core accepts, distinct even for slugs that read alike", () => {
    // An item id holds lowercase letters, digits and dashes; a slug may not.
    expect(
      seoIssuesAttentionItems(
        ["blog_posts", "blog-posts", "News"],
        defaultSeoFields()
      ).map(item => item.id)
    ).toEqual([
      "seo/issues-blog-posts",
      "seo/issues-blog-posts-2",
      "seo/issues-news",
    ]);
    // 🔴 A suffix is checked against every id taken, not only the base: here
    // the third slug's first choice of suffix is the first slug's own id.
    expect(
      seoIssuesAttentionItems(
        ["blog-posts-3", "blog-posts", "blog_posts"],
        defaultSeoFields()
      ).map(item => item.id)
    ).toEqual([
      "seo/issues-blog-posts-3",
      "seo/issues-blog-posts",
      "seo/issues-blog-posts-2",
    ]);
  });

  it("say a count is a floor when the scan stopped at its bound", async () => {
    const [item] = seoIssuesAttentionItems(["pages"], defaultSeoFields());

    expect(await item?.count(countWith(servicesPastTheBudget()))).toEqual({
      count: ISSUE_SCAN_ROW_BUDGET * 4,
      atLeast: true,
    });
  });

  it("are withheld where the card is", () => {
    expect(seoIssuesAttentionItems([], defaultSeoFields())).toEqual([]);
    expect(
      seoIssuesAttentionItems(["pages"], [text({ name: "focusKeyword" })])
    ).toEqual([]);
  });
});
