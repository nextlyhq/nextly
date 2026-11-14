/**
 * A sitemap of the site's own, made once while `next build` runs, from the
 * SEO plugin's `listedPages` service, as a site's own sitemap file reads it.
 * The plugin's own `/sitemap.xml` is answered per request; this one is what a
 * build-time sitemap lists.
 */
import type { ListedPagesService } from "@nextlyhq/plugin-seo";
import { getNextly } from "nextly";

import config from "../../nextly.config";

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** The sitemap's text, cached, so `next build` prerenders the route once. */
async function builtSitemap(): Promise<string> {
  "use cache";
  const nextly = await getNextly({ config });
  const plugins = nextly.plugins as unknown as Record<
    string,
    { listedPages?: ListedPagesService } | undefined
  >;
  const service = plugins["@nextlyhq/plugin-seo"]?.listedPages;
  if (service === undefined) throw new Error("listedPages is not provided");
  const { pages } = await service.list(ORIGIN);
  const urls = pages.map(page => `<url><loc>${page.loc}</loc></url>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

export async function GET(): Promise<Response> {
  return new Response(await builtSitemap(), {
    headers: { "content-type": "application/xml" },
  });
}
