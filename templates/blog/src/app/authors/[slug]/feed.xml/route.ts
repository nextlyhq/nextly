/**
 * Per-author RSS feed at /authors/[slug]/feed.xml.
 *
 * Ships one feed per author so readers can subscribe to a specific
 * writer's posts rather than the entire site. Mirrors the per-tag and
 * per-category feed pattern so clients that understand one understand
 * all three.
 */

import {
  getAuthorBySlug,
  getPostsByAuthor,
  getSiteSettings,
} from "@/lib/queries";
import { buildRss, postsToFeedItems } from "@/lib/rss";
import { absoluteUrl } from "@/lib/site-url";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const author = await getAuthorBySlug(slug);

  if (!author) {
    return new Response("Author not found", { status: 404 });
  }

  const [settings, posts] = await Promise.all([
    getSiteSettings(),
    getPostsByAuthor(author.id, { limit: 20 }),
  ]);

  const xml = buildRss({
    title: `${author.name} — ${settings.siteName}`,
    link: absoluteUrl(`/authors/${slug}`),
    description:
      author.bio ?? `Posts by ${author.name} on ${settings.siteName}.`,
    items: postsToFeedItems(posts.docs),
  });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
