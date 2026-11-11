/**
 * The sitemap's files: one `<urlset>` while every listed page fits in one
 * file, and a sitemap index naming each file once the pages pass either
 * limit, the number of addresses or the size, each crossed on its own.
 */
import { describe, expect, it } from "vitest";

import {
  SITEMAP_LIMITS,
  sitemapAnswer,
  sitemapFiles,
  type SitemapPage,
} from "../sitemap-files";

const SITEMAP = "https://example.com/sitemap.xml";

const page = (path: string, extra: Partial<SitemapPage> = {}): SitemapPage => ({
  loc: `https://example.com${path}`,
  images: [],
  ...extra,
});

/** The `<loc>` values of a document, in order. */
const locs = (xml: string) =>
  [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(match => match[1]);

const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("one sitemap file", () => {
  it("lists each page with its last change and its images", () => {
    const [file] = sitemapFiles([
      page("/", { lastModified: "2026-11-01T10:00:00.000Z" }),
      page("/about", {
        images: ["https://example.com/media/team.jpg"],
      }),
    ]);
    expect(file).toBe(
      [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">`,
        `  <url><loc>https://example.com/</loc><lastmod>2026-11-01T10:00:00.000Z</lastmod></url>`,
        `  <url><loc>https://example.com/about</loc><image:image><image:loc>https://example.com/media/team.jpg</image:loc></image:image></url>`,
        `</urlset>`,
      ].join("\n")
    );
  });

  it("escapes what XML would read as markup", () => {
    const [file] = sitemapFiles([page("/a?x=1&y=<2>")]);
    expect(file).toContain(
      "<loc>https://example.com/a?x=1&amp;y=&lt;2&gt;</loc>"
    );
  });

  it("is an empty urlset where nothing is listed", () => {
    const files = sitemapFiles([]);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("<urlset ");
    expect(locs(files[0] ?? "")).toEqual([]);
  });

  it("holds the protocol's limits by default", () => {
    expect(SITEMAP_LIMITS).toEqual({ urls: 50_000, bytes: 50 * 1024 * 1024 });
  });
});

describe("a sitemap index", () => {
  const five = ["/a", "/b", "/c", "/d", "/e"].map(path => page(path));

  it("splits the pages once they pass the number of addresses a file holds", () => {
    const files = sitemapFiles(five, { urls: 2, bytes: SITEMAP_LIMITS.bytes });
    expect(files.map(locs)).toEqual([
      ["https://example.com/a", "https://example.com/b"],
      ["https://example.com/c", "https://example.com/d"],
      ["https://example.com/e"],
    ]);
  });

  it("splits the pages once they pass the size a file may have, with the count far off", () => {
    // Room for the file's wrapper and two pages, not three.
    const [whole = ""] = sitemapFiles(five.slice(0, 2));
    const files = sitemapFiles(five, {
      urls: SITEMAP_LIMITS.urls,
      bytes: bytes(whole),
    });
    expect(files.map(locs)).toEqual([
      ["https://example.com/a", "https://example.com/b"],
      ["https://example.com/c", "https://example.com/d"],
      ["https://example.com/e"],
    ]);
    for (const file of files)
      expect(bytes(file)).toBeLessThanOrEqual(bytes(whole));
  });

  it("is what the sitemap's address answers once there is more than one file, each file at its page", () => {
    const limits = { urls: 2, bytes: SITEMAP_LIMITS.bytes };
    const index = sitemapAnswer(five, { sitemap: SITEMAP, limits });
    expect(index).toBe(
      [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
        `  <sitemap><loc>${SITEMAP}?page=1</loc></sitemap>`,
        `  <sitemap><loc>${SITEMAP}?page=2</loc></sitemap>`,
        `  <sitemap><loc>${SITEMAP}?page=3</loc></sitemap>`,
        `</sitemapindex>`,
      ].join("\n")
    );
    expect(
      locs(sitemapAnswer(five, { sitemap: SITEMAP, limits, page: 3 }) ?? "")
    ).toEqual(["https://example.com/e"]);
    expect(sitemapAnswer(five, { sitemap: SITEMAP, limits, page: 4 })).toBe(
      null
    );
  });

  it("is not used while every page fits in one file, whose one page is that file", () => {
    const one = sitemapAnswer(five, { sitemap: SITEMAP });
    expect(locs(one ?? "")).toHaveLength(5);
    expect(one).not.toContain("<sitemapindex");
    expect(sitemapAnswer(five, { sitemap: SITEMAP, page: 1 })).toBe(one);
    expect(sitemapAnswer(five, { sitemap: SITEMAP, page: 2 })).toBe(null);
  });

  it("leaves out a page too large for any file rather than serve one over the limit", () => {
    const [empty = ""] = sitemapFiles([]);
    const huge = page(`/${"x".repeat(200)}`);
    const files = sitemapFiles([page("/a"), huge], {
      urls: 10,
      bytes: bytes(empty) + 60,
    });
    expect(files.flatMap(locs)).toEqual(["https://example.com/a"]);
  });
});
