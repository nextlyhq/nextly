/**
 * Minimal RSS 2.0 builder.
 *
 * Why not a library: RSS 2.0 is a stable, small spec; pulling a package
 * adds dependency weight without real value. This builder escapes the
 * required XML entities and wraps HTML excerpts in CDATA sections.
 */

import type { Post } from "./queries/types";
import { absoluteUrl } from "./site-url";

interface FeedItem {
  title: string;
  link: string;
  description?: string;
  pubDate: string;
  author?: string;
  categories?: string[];
}

interface FeedInput {
  title: string;
  link: string;
  description: string;
  items: FeedItem[];
}

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// CDATA is fine for most HTML, but a literal `]]>` in the content would
// close the section early. Split it if present.
const cdata = (s: string) =>
  `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

export function buildRss({
  title,
  link,
  description,
  items,
}: FeedInput): string {
  const itemsXml = items
    .map(item => {
      const cats = (item.categories ?? [])
        .map(c => `<category>${escapeXml(c)}</category>`)
        .join("");
      return `
    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="true">${escapeXml(item.link)}</guid>
      <pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>
      ${item.author ? `<author>${escapeXml(item.author)}</author>` : ""}
      ${item.description ? `<description>${cdata(item.description)}</description>` : ""}
      ${cats}
    </item>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(link)}</link>
    <description>${escapeXml(description)}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${itemsXml}
  </channel>
</rss>`;
}

/**
 * Convert a Post list to RSS feed items. Shared by the site-wide,
 * per-category, and per-tag feed route handlers.
 */
export function postsToFeedItems(posts: Post[]): FeedItem[] {
  return posts.map(post => ({
    title: post.title,
    link: absoluteUrl(`/blog/${post.slug}`),
    description: post.excerpt ?? undefined,
    pubDate: post.publishedAt ?? new Date().toISOString(),
    author: post.author?.name,
    categories: [
      ...(post.categories?.map(c => c.name) ?? []),
      ...(post.tags?.map(t => t.name) ?? []),
    ],
  }));
}
