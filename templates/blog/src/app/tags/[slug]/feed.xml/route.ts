/**
 * Per-tag RSS feed at /tags/[slug]/feed.xml.
 */

import { getPostsByTag, getSiteSettings, getTagBySlug } from "@/lib/queries";
import { buildRss, postsToFeedItems } from "@/lib/rss";
import { absoluteUrl } from "@/lib/site-url";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const tag = await getTagBySlug(slug);

  if (!tag) {
    return new Response("Tag not found", { status: 404 });
  }

  const [settings, posts] = await Promise.all([
    getSiteSettings(),
    getPostsByTag(tag.id, { limit: 20 }),
  ]);

  const xml = buildRss({
    title: `#${tag.name} — ${settings.siteName}`,
    link: absoluteUrl(`/tags/${slug}`),
    description:
      tag.description ?? `Posts tagged ${tag.name} on ${settings.siteName}.`,
    items: postsToFeedItems(posts.items),
  });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
