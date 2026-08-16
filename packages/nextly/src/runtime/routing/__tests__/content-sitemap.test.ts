/**
 * `contentSitemapEntries` builds the URLs a content route serves.
 *
 * The property under test is AGREEMENT WITH THE ROUTE, not that a well-formed
 * URL comes out. A builder with its own path rule emits plausible URLs for
 * every case here and still advertises paths the route answers with
 * `notFound()`, so each path assertion is written against what
 * `slugToStaticParam` — the route's own answer — produces.
 */
import { describe, expect, it, vi } from "vitest";

import { contentSitemapEntries } from "../content-sitemap";
import type { NextlyContentReader } from "../resolve-content";

/** A reader answering from fixed pages, recording what it was asked. */
function reader(pages: Record<string, Array<Record<string, unknown>>[]>): {
  reader: NextlyContentReader;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const find = vi.fn(async (args: Record<string, unknown>) => {
    calls.push(args);
    const collection = String(args.collection);
    const page = Number(args.page ?? 1);
    const all = pages[collection] ?? [];
    const items = all[page - 1] ?? [];
    return { items, meta: { hasNext: page < all.length } };
  });
  return { reader: { find } as unknown as NextlyContentReader, calls };
}

const BASE = { baseUrl: "https://example.com", collections: ["pages"] };

describe("contentSitemapEntries", () => {
  it("emits one URL per published entry, under the route's mount point", async () => {
    const { reader: r } = reader({
      pages: [[{ slug: "about" }, { slug: "blog/hello" }]],
    });

    const entries = await contentSitemapEntries({
      ...BASE,
      basePath: "/blocks",
      nextly: r,
    });

    expect(entries.map(e => e.url)).toEqual([
      "https://example.com/blocks/about",
      "https://example.com/blocks/blog/hello",
    ]);
  });

  it("maps the empty slug to the mount point itself", async () => {
    // `slugToStaticParam("")` is `{ slug: [] }` — the route's index path. A
    // builder joining segments naively emits a trailing slash here, which is a
    // different URL to a crawler.
    const { reader: r } = reader({ pages: [[{ slug: "" }]] });

    const entries = await contentSitemapEntries({
      ...BASE,
      basePath: "/blocks",
      nextly: r,
    });

    expect(entries.map(e => e.url)).toEqual(["https://example.com/blocks"]);
  });

  it("skips a row whose slug the ROUTE would not serve", async () => {
    // Whitespace, a non-string and null all produce no static param, so the
    // route serves no path for them. Emitting a URL anyway would advertise a
    // path that 404s — the exact disagreement sharing `slugToStaticParam`
    // exists to prevent.
    const { reader: r } = reader({
      pages: [[{ slug: "   " }, { slug: 42 }, { slug: null }, { slug: "ok" }]],
    });

    const entries = await contentSitemapEntries({ ...BASE, nextly: r });

    expect(entries.map(e => e.url)).toEqual(["https://example.com/ok"]);
  });

  it("normalizes a trailing slash on the origin and the mount", async () => {
    const { reader: r } = reader({ pages: [[{ slug: "a" }]] });

    const entries = await contentSitemapEntries({
      collections: ["pages"],
      baseUrl: "https://example.com/",
      basePath: "blocks/",
      nextly: r,
    });

    expect(entries[0].url).toBe("https://example.com/blocks/a");
  });

  it("paginates until the reader reports no next page", async () => {
    const { reader: r, calls } = reader({
      pages: [[{ slug: "a" }], [{ slug: "b" }], [{ slug: "c" }]],
    });

    const entries = await contentSitemapEntries({ ...BASE, nextly: r });

    // Asserted by MEMBERSHIP, not by count: a scan that dropped page 2 and read
    // page 1 twice matches any total compared against.
    expect(entries.map(e => e.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);
    expect(calls.map(c => c.page)).toEqual([1, 2, 3]);
  });

  it("reads as an anonymous visitor in the published scope", async () => {
    // A sitemap lists what a crawler can reach. Observed on the arguments the
    // reader actually received rather than reconstructed, so an edit to the
    // call is what the assertion watches.
    const { reader: r, calls } = reader({ pages: [[{ slug: "a" }]] });

    await contentSitemapEntries({ ...BASE, nextly: r });

    expect(calls[0].status).toBe("published");
    expect(calls[0].user).toBeUndefined();
    expect(calls[0].sort).toBe("id");
  });

  it("de-duplicates a path two collections both claim", async () => {
    // The route resolves such a path to the FIRST collection that answers, so
    // advertising it twice would name one URL twice in one sitemap.
    const { reader: r } = reader({
      pages: [[{ slug: "shared" }]],
      posts: [[{ slug: "shared" }, { slug: "other" }]],
    });

    const entries = await contentSitemapEntries({
      baseUrl: "https://example.com",
      collections: ["pages", "posts"],
      nextly: r,
    });

    expect(entries.map(e => e.url)).toEqual([
      "https://example.com/shared",
      "https://example.com/other",
    ]);
  });

  it("stops at the limit and says so, rather than returning a quietly short list", async () => {
    // A truncated sitemap looks exactly like a site with that many pages, so
    // the cut has to reach a human somewhere. The result shape is fixed by the
    // sitemap protocol and carries no third state.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reader: r } = reader({
      pages: [[{ slug: "a" }, { slug: "b" }, { slug: "c" }]],
    });

    const entries = await contentSitemapEntries({
      ...BASE,
      limit: 2,
      nextly: r,
    });

    expect(entries).toHaveLength(2);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain("generateSitemaps");
    warn.mockRestore();
  });

  it("carries a timestamp only when the caller names a field holding one", async () => {
    const { reader: r, calls } = reader({
      pages: [
        [
          { slug: "a", updatedAt: "2026-01-01T00:00:00.000Z" },
          { slug: "b", updatedAt: 12345 },
        ],
      ],
    });

    const entries = await contentSitemapEntries({
      ...BASE,
      lastModifiedField: "updatedAt",
      nextly: r,
    });

    expect(entries[0].lastModified).toBe("2026-01-01T00:00:00.000Z");
    // A wrong date is worse for a crawler than an absent one, so a value that
    // is not a date is omitted rather than coerced.
    expect(entries[1].lastModified).toBeUndefined();
    // And the column is only requested when it was asked for.
    expect(calls[0].select).toEqual({ slug: true, updatedAt: true });
  });

  it("returns nothing for a non-positive limit, without reading", async () => {
    const { reader: r, calls } = reader({ pages: [[{ slug: "a" }]] });

    expect(
      await contentSitemapEntries({ ...BASE, limit: 0, nextly: r })
    ).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
