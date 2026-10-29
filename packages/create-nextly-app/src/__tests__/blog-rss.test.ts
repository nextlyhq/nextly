/**
 * The blog template's RSS feed carries no `lastBuildDate`. It means when the
 * channel last changed, which the posts do not record: the clock cannot be
 * read under Cache Components, and a date taken from the posts moves backward
 * when the newest one is unpublished or deleted. Each item keeps its own
 * `pubDate`, and an item without one carries none.
 */
import { describe, expect, it } from "vitest";

import { buildRss } from "../../../../templates/blog/src/lib/rss";

const feed = (items: Parameters<typeof buildRss>[0]["items"]) =>
  buildRss({
    title: "Blog",
    link: "https://example.com",
    description: "Posts",
    items,
  });

describe("blog template: the RSS feed", () => {
  it("carries no lastBuildDate, and each item's own pubDate", () => {
    const xml = feed([
      {
        title: "Newest",
        link: "https://example.com/blog/newest",
        pubDate: "2026-10-20T09:00:00.000Z",
      },
      {
        title: "Older",
        link: "https://example.com/blog/older",
        pubDate: "2026-09-01T09:00:00.000Z",
      },
    ]);
    expect(xml).not.toContain("lastBuildDate");
    expect(xml).toContain("<pubDate>Tue, 20 Oct 2026 09:00:00 GMT</pubDate>");
    expect(xml).toContain("<pubDate>Tue, 01 Sep 2026 09:00:00 GMT</pubDate>");
  });

  it("gives an item with no publish date no pubDate", () => {
    const xml = feed([
      { title: "Draft-dated", link: "https://example.com/blog/undated" },
    ]);
    expect(xml).toContain("<title>Draft-dated</title>");
    expect(xml).not.toContain("<pubDate>");
  });
});
