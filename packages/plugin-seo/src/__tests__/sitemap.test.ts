import { describe, expect, it, vi } from "vitest";

import {
  buildSitemapUrls,
  defaultUrlForEntry,
  escapeXml,
  generateSitemap,
  serializeSitemap,
  type SitemapServices,
} from "../sitemap";

/**
 * A stub `listEntries` that returns fixed pages keyed by collection, paging by
 * the 1-indexed `page` exactly as the real managed facade does, so a test can
 * assert the query passed AND the pagination loop without a real boot.
 */
function stubServices(
  pages: Record<string, Array<Record<string, unknown>[]>>,
  spy?: ReturnType<typeof vi.fn>
): SitemapServices {
  return {
    collections: {
      async listEntries(slug, query, opts) {
        spy?.(slug, query, opts);
        const collectionPages = pages[slug] ?? [];
        const page = query.pagination?.page ?? 1;
        const data = collectionPages[page - 1] ?? [];
        return {
          data,
          pagination: {
            // More pages remain after this 1-indexed page.
            hasMore: page < collectionPages.length,
          },
        };
      },
    },
  };
}

describe("escapeXml", () => {
  it("escapes all five XML entities", () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      "a &amp; b &lt; c &gt; d &quot; e &apos; f"
    );
  });
});

describe("defaultUrlForEntry", () => {
  it("builds /<collection>/<slug>", () => {
    expect(defaultUrlForEntry({ slug: "hello" }, "posts")).toBe("/posts/hello");
  });

  it("returns null for a missing or blank slug so the caller skips it", () => {
    expect(defaultUrlForEntry({}, "posts")).toBeNull();
    expect(defaultUrlForEntry({ slug: "   " }, "posts")).toBeNull();
  });

  it("percent-encodes an unsafe slug into a valid URL segment", () => {
    expect(defaultUrlForEntry({ slug: "hello world" }, "posts")).toBe(
      "/posts/hello%20world"
    );
    expect(defaultUrlForEntry({ slug: "café" }, "posts")).toBe(
      "/posts/caf%C3%A9"
    );
  });
});

describe("buildSitemapUrls", () => {
  it("reads only published entries, as system", async () => {
    const spy = vi.fn();
    const services = stubServices({ posts: [[{ slug: "a" }]] }, spy);

    await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    const [, query, opts] = spy.mock.calls[0];
    expect(query).toMatchObject({
      where: { status: { equals: "published" } },
    });
    expect(opts).toEqual({ as: "system" });
  });

  it("maps entries to absolute loc + ISO lastModified", async () => {
    const services = stubServices({
      posts: [[{ slug: "a", updatedAt: "2026-01-02T03:04:05.000Z" }]],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    expect(urls).toEqual([
      {
        loc: "https://x.com/posts/a",
        lastModified: "2026-01-02T03:04:05.000Z",
      },
    ]);
  });

  it("pages through every result rather than truncating at the first page", async () => {
    // Two pages of two — a first-page-only read would drop c and d.
    const services = stubServices({
      posts: [
        [{ slug: "a" }, { slug: "b" }],
        [{ slug: "c" }, { slug: "d" }],
      ],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
      pageSize: 2,
    });

    expect(urls.map(u => u.loc)).toEqual([
      "https://x.com/posts/a",
      "https://x.com/posts/b",
      "https://x.com/posts/c",
      "https://x.com/posts/d",
    ]);
  });

  it("advances the page number instead of re-reading page one", async () => {
    // The managed service pages by `page`, not `offset`; advancing anything but
    // `page` would re-request page one forever while `hasMore` stayed true.
    const spy = vi.fn();
    const services = stubServices(
      { posts: [[{ slug: "a" }], [{ slug: "b" }]] },
      spy
    );

    await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
      pageSize: 1,
    });

    const pages = spy.mock.calls.map(
      ([, query]: [string, { pagination?: { page?: number } }]) =>
        query.pagination?.page
    );
    expect(pages).toEqual([1, 2]);
  });

  it("caps the requested page size at the service maximum", async () => {
    const spy = vi.fn();
    const services = stubServices({ posts: [[{ slug: "a" }]] }, spy);

    await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
      pageSize: 5000,
    });

    const [, query] = spy.mock.calls[0];
    expect(query.pagination?.limit).toBe(500);
  });

  it("skips entries with no usable slug (default urlFor) rather than emitting duplicates", async () => {
    const services = stubServices({
      posts: [[{ slug: "a" }, {}, { slug: "  " }, { slug: "b" }]],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    expect(urls.map(u => u.loc)).toEqual([
      "https://x.com/posts/a",
      "https://x.com/posts/b",
    ]);
  });

  it("lets a custom urlFor exclude an entry by returning null", async () => {
    const services = stubServices({
      posts: [[{ slug: "keep" }, { slug: "drop" }]],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
      urlFor: entry => (entry.slug === "drop" ? null : `/${entry.slug}`),
    });

    expect(urls.map(u => u.loc)).toEqual(["https://x.com/keep"]);
  });

  it("excludes entries flagged seo.noindex", async () => {
    const services = stubServices({
      posts: [
        [
          { slug: "keep" },
          { slug: "hidden", seo: { noindex: true } },
          { slug: "shown", seo: { noindex: false } },
        ],
      ],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    expect(urls.map(u => u.loc)).toEqual([
      "https://x.com/posts/keep",
      "https://x.com/posts/shown",
    ]);
  });

  it("honors a custom urlFor and multiple collections", async () => {
    const services = stubServices({
      posts: [[{ slug: "a" }]],
      pages: [[{ slug: "about" }]],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts", "pages"],
      baseUrl: "https://x.com",
      urlFor: (entry, collection) =>
        collection === "posts" ? `/blog/${entry.slug}` : `/${entry.slug}`,
    });

    expect(urls.map(u => u.loc)).toEqual([
      "https://x.com/blog/a",
      "https://x.com/about",
    ]);
  });

  it("trims a trailing slash on baseUrl so paths never double up", async () => {
    const services = stubServices({ posts: [[{ slug: "a" }]] });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com/",
    });

    expect(urls[0].loc).toBe("https://x.com/posts/a");
  });
});

describe("serializeSitemap", () => {
  it("wraps urls in a urlset and escapes the loc", () => {
    const xml = serializeSitemap([
      {
        loc: "https://x.com/a?x=1&y=2",
        lastModified: "2026-01-02T00:00:00.000Z",
      },
      { loc: "https://x.com/b" },
    ]);

    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    );
    // The ampersand in the query string must be escaped or the XML is invalid.
    expect(xml).toContain(
      "<loc>https://x.com/a?x=1&amp;y=2</loc><lastmod>2026-01-02T00:00:00.000Z</lastmod>"
    );
    // No lastmod element when the entry has no timestamp.
    expect(xml).toContain("<loc>https://x.com/b</loc></url>");
  });
});

describe("generateSitemap", () => {
  it("composes build + serialize into a document", async () => {
    const services = stubServices({ posts: [[{ slug: "a" }]] });

    const xml = await generateSitemap(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<loc>https://x.com/posts/a</loc>");
  });
});
