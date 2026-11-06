/**
 * The blog template's RSS feed carries no `lastBuildDate`. It means when the
 * channel last changed, which the posts do not record: the clock cannot be
 * read under Cache Components, and a date taken from the posts moves backward
 * when the newest one is unpublished or deleted. Each item keeps its own
 * `pubDate`, and a post without a publish date carries none rather than the
 * clock's. Posts go through `postsToFeedItems`, as the feed routes send them.
 */
import { describe, expect, it } from "vitest";

import {
  buildRss,
  postsToFeedItems,
} from "../../../../templates/blog/src/lib/rss";
import type { Post } from "../../../../templates/blog/src/lib/queries/types";

/** A published post, as the queries return it. */
const post = (slug: string, publishedAt: string | null): Post => ({
  id: slug,
  title: slug,
  slug,
  content: null,
  publishedAt,
  status: "published",
});

/** The feed a route builds from `posts`. */
const feed = (posts: Post[]) =>
  buildRss({
    title: "Blog",
    link: "https://example.com",
    description: "Posts",
    items: postsToFeedItems(posts),
  });

describe("blog template: the RSS feed", () => {
  it("carries no lastBuildDate, and each post's own pubDate", () => {
    const xml = feed([
      post("newest", "2026-10-20T09:00:00.000Z"),
      post("older", "2026-09-01T09:00:00.000Z"),
    ]);
    expect(xml).not.toContain("lastBuildDate");
    expect(xml).toContain("<pubDate>Tue, 20 Oct 2026 09:00:00 GMT</pubDate>");
    expect(xml).toContain("<pubDate>Tue, 01 Sep 2026 09:00:00 GMT</pubDate>");
  });

  it("gives a post with no publish date no pubDate, rather than the clock's", () => {
    const xml = feed([post("undated", null)]);
    expect(xml).toContain("<title>undated</title>");
    expect(xml).not.toContain("<pubDate>");
  });
});
