/**
 * Site-wide RSS feed at /feed.xml.
 *
 * Emits the latest 20 published posts as RSS 2.0. Readers, aggregators,
 * and newsletter tools (Feedly, Reeder, Buttondown, Substack import, etc.)
 * all consume this.
 */

import { getPosts, getSiteSettings } from "@/lib/queries";
import { buildRss, postsToFeedItems } from "@/lib/rss";
import { SITE_URL } from "@/lib/site-url";

export async function GET() {
  const [settings, result] = await Promise.all([
    getSiteSettings(),
    getPosts({ limit: 20 }),
  ]);

  const xml = buildRss({
    title: settings.siteName,
    link: SITE_URL,
    description: settings.siteDescription,
    items: postsToFeedItems(result.docs),
  });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
