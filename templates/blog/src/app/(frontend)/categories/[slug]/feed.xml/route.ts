/**
 * Per-category RSS feed at /categories/[slug]/feed.xml.
 *
 * Lets readers subscribe to a specific category instead of the whole
 * blog — common pattern on Ghost and WordPress.
 */

import {
  getCategoryBySlug,
  getPostsByCategory,
  getSiteSettings,
} from "@/lib/queries";
import { buildRss, postsToFeedItems } from "@/lib/rss";
import { absoluteUrl } from "@/lib/site-url";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);

  if (!category) {
    return new Response("Category not found", { status: 404 });
  }

  const [settings, posts] = await Promise.all([
    getSiteSettings(),
    getPostsByCategory(category.id, { limit: 20 }),
  ]);

  const xml = buildRss({
    title: `${category.name} — ${settings.siteName}`,
    link: absoluteUrl(`/categories/${slug}`),
    description:
      category.description ??
      `Posts in ${category.name} on ${settings.siteName}.`,
    items: postsToFeedItems(posts.items),
  });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
