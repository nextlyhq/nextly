import { describe, expect, it, vi } from "vitest";

import {
  buildSitemapUrls,
  defaultUrlForEntry,
  escapeXml,
  generateSitemap,
  MAX_SITEMAP_URLS,
  resolveBaseOrigin,
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
  spy?: ReturnType<typeof vi.fn>,
  // Collections WITHOUT the built-in lifecycle. Anything not listed here is
  // treated as `status: true`, matching the common content-collection case.
  statusless: string[] = []
): SitemapServices {
  return {
    collections: {
      async getCollection(slug) {
        return { status: !statusless.includes(slug) };
      },
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

  it("pages with a stable unique sort so pages never overlap or skip", async () => {
    const spy = vi.fn();
    const services = stubServices({ posts: [[{ slug: "a" }]] }, spy);

    await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    const [, query] = spy.mock.calls[0];
    expect(query.sort).toEqual({ field: "id", direction: "asc" });
  });

  it("advertises a same-host declared canonical instead of the generated URL", async () => {
    const services = stubServices({
      posts: [
        [
          { slug: "a", seo: { canonical: "https://x.com/real-a" } },
          { slug: "b" },
        ],
      ],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    expect(urls.map(u => u.loc)).toEqual([
      "https://x.com/real-a",
      "https://x.com/posts/b",
    ]);
  });

  it("drops an entry whose canonical is on another host", async () => {
    // A sitemap must only list URLs on its own host, so a cross-host canonical
    // means the entry belongs in that other host's sitemap — exclude it here.
    const services = stubServices({
      posts: [
        [
          { slug: "a", seo: { canonical: "https://other.example/a" } },
          { slug: "b" },
        ],
      ],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    expect(urls.map(u => u.loc)).toEqual(["https://x.com/posts/b"]);
  });

  it("treats a scheme mismatch as a different origin and drops the entry", async () => {
    // Same host but http vs https is a distinct URL to a crawler.
    const services = stubServices({
      posts: [
        [{ slug: "a", seo: { canonical: "http://x.com/a" } }, { slug: "b" }],
      ],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    expect(urls.map(u => u.loc)).toEqual(["https://x.com/posts/b"]);
  });

  it("honors a urlFor exclusion even when the entry has a canonical", async () => {
    const services = stubServices({
      posts: [[{ slug: "drop", seo: { canonical: "https://x.com/keep" } }]],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
      // urlFor opts the entry out; the canonical must not resurrect it.
      urlFor: () => null,
    });

    expect(urls).toEqual([]);
  });

  it("resolves a relative canonical against baseUrl (loc must be absolute)", async () => {
    const services = stubServices({
      posts: [[{ slug: "a", seo: { canonical: "/about" } }]],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    expect(urls[0].loc).toBe("https://x.com/about");
  });

  it("ignores a non-http(s) canonical and falls back to the generated URL", async () => {
    const services = stubServices({
      posts: [[{ slug: "a", seo: { canonical: "mailto:hi@example.com" } }]],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    // A mailto: is not a crawlable location, so the generated URL wins.
    expect(urls[0].loc).toBe("https://x.com/posts/a");
  });

  it("does not filter by status on a status-less collection", async () => {
    // `notes` has no lifecycle: the read must carry NO status filter, so a
    // user-defined `status` field is never wrongly filtered.
    const spy = vi.fn();
    const services = stubServices({ notes: [[{ slug: "a" }]] }, spy, ["notes"]);

    await buildSitemapUrls(services, {
      collections: ["notes"],
      baseUrl: "https://x.com",
    });

    const [, query] = spy.mock.calls[0];
    expect(query.where).toBeUndefined();
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

  it("projects only the sitemap columns for the default urlFor", async () => {
    const spy = vi.fn();
    const services = stubServices({ posts: [[{ slug: "a" }]] }, spy);

    await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    const [, query] = spy.mock.calls[0];
    expect(query.select).toEqual({ slug: true, seo: true, updatedAt: true });
  });

  it("fetches full rows (no projection) for a custom urlFor", async () => {
    const spy = vi.fn();
    const services = stubServices({ posts: [[{ slug: "a" }]] }, spy);

    await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
      urlFor: entry => `/${entry.slug}`,
    });

    const [, query] = spy.mock.calls[0];
    expect(query.select).toBeUndefined();
  });

  it("throws on a baseUrl that is not an absolute http(s) origin", async () => {
    const services = stubServices({ posts: [[{ slug: "a" }]] });

    for (const bad of [
      "example.com", // no scheme
      "https://x.com/cms", // has a path
      "https://x.com?q=1", // has a query
      "https://user:pass@x.com", // credentials
    ]) {
      await expect(
        buildSitemapUrls(services, { collections: ["posts"], baseUrl: bad })
      ).rejects.toThrow(/absolute http/i);
    }
  });

  it("bounds the document to the byte limit", async () => {
    const services = stubServices({
      posts: [[{ slug: "a" }, { slug: "b" }, { slug: "c" }]],
    });

    // Budget just enough for the wrapper plus a single entry.
    const oneUrlDoc = serializeSitemap([{ loc: "https://x.com/posts/a" }]);
    const maxBytes = new TextEncoder().encode(oneUrlDoc).length + 2;

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
      maxBytes,
    });

    expect(urls.map(u => u.loc)).toEqual(["https://x.com/posts/a"]);
  });

  it("returns empty when even the first entry exceeds the byte cap", async () => {
    const services = stubServices({ posts: [[{ slug: "a" }]] });

    // Budget holds the wrapper but not a single entry.
    const emptyDoc = serializeSitemap([]);
    const maxBytes = new TextEncoder().encode(emptyDoc).length + 5;

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
      maxBytes,
    });

    // The hard cap wins over emitting a single oversized document.
    expect(urls).toEqual([]);
  });

  it("throws when maxBytes cannot hold the document wrapper", async () => {
    const services = stubServices({ posts: [[{ slug: "a" }]] });

    // A tiny, zero, or negative budget can't hold the wrapper — never silently
    // fall back to the 50 MB default.
    for (const maxBytes of [10, 0, -1]) {
      await expect(
        buildSitemapUrls(services, {
          collections: ["posts"],
          baseUrl: "https://x.com",
          maxBytes,
        })
      ).rejects.toThrow(/minimum/i);
    }
  });

  it("drops a location longer than the protocol limit", async () => {
    const longSlug = "a".repeat(3000);
    const services = stubServices({
      posts: [[{ slug: longSlug }, { slug: "ok" }]],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    // The 3,000-char loc exceeds 2,048 and is skipped; the short one remains.
    expect(urls.map(u => u.loc)).toEqual(["https://x.com/posts/ok"]);
  });

  it("drops a custom urlFor path that carries credentials", async () => {
    const services = stubServices({
      posts: [[{ slug: "a" }, { slug: "b" }]],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
      urlFor: entry =>
        entry.slug === "a" ? "https://user:pass@x.com/a" : "/b",
    });

    // Same-origin but credential-bearing → dropped; the clean one remains.
    expect(urls.map(u => u.loc)).toEqual(["https://x.com/b"]);
  });

  it("percent-encodes and origin-checks a custom urlFor path", async () => {
    const services = stubServices({
      posts: [[{ slug: "a" }, { slug: "evil" }]],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
      urlFor: entry =>
        // A space needs encoding; an absolute off-origin URL must be dropped.
        entry.slug === "evil" ? "https://evil.com/x" : "/people/John Doe",
    });

    expect(urls.map(u => u.loc)).toEqual(["https://x.com/people/John%20Doe"]);
  });

  it("ignores a same-origin canonical that carries credentials", async () => {
    const services = stubServices({
      posts: [[{ slug: "a", seo: { canonical: "https://user:pass@x.com/a" } }]],
    });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    // Credentials must never reach a public <loc>; fall back to the generated URL.
    expect(urls[0].loc).toBe("https://x.com/posts/a");
  });

  it("bounds the document to the sitemap URL limit", async () => {
    // One page per 500 rows; produce one more than the limit and confirm the
    // output stops at the cap (removing the cap would return them all).
    const overflowPages: Record<string, string>[][] = [];
    let made = 0;
    while (made <= MAX_SITEMAP_URLS) {
      const page = Array.from({ length: 500 }, (_, i) => ({
        slug: `s${made + i}`,
      }));
      overflowPages.push(page);
      made += 500;
    }
    const services = stubServices({ posts: overflowPages });

    const urls = await buildSitemapUrls(services, {
      collections: ["posts"],
      baseUrl: "https://x.com",
    });

    expect(urls).toHaveLength(MAX_SITEMAP_URLS);
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

describe("resolveBaseOrigin", () => {
  it("redacts credentials from the error message", () => {
    let message = "";
    try {
      resolveBaseOrigin("https://user:secret@x.com");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/origin/i);
    expect(message).not.toContain("secret");
    expect(message).not.toContain("user:");
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
