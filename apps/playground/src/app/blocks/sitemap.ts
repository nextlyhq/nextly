/**
 * Sitemap for the code-first blocks route.
 *
 * Nested under `app/blocks/` so it is served at `/blocks/sitemap.xml`, beside
 * the pages it lists rather than at the site root — this harness mounts several
 * unrelated routes and a root sitemap would have to know about all of them.
 *
 * The URLs come from `contentSitemapEntries`, which derives each path from the
 * same `slugToStaticParam` the route resolves with. Listing them here by hand,
 * or from a second query, is how a sitemap comes to advertise a path the route
 * answers with `notFound()` — and neither side reports the disagreement.
 */
import {
  nextlySitemap,
  contentSitemapEntries,
  nextlyTags,
} from "nextly/runtime";

/**
 * The collection the blocks route reads, and the mount it serves from.
 *
 * Stated once and used for both, because a sitemap built against a different
 * collection or a different mount is wrong in a way nothing detects: it
 * produces well-formed URLs for pages that do not exist there.
 */
const COLLECTION = "block-pages";
const MOUNT = "/blocks";

/**
 * The site's public origin.
 *
 * The sitemap protocol requires absolute URLs, so there is no useful default —
 * a relative one produces a document crawlers reject. Falls back to the dev
 * origin so the harness works without configuration.
 */
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default nextlySitemap({
  // Busted by a write to the collection, so the sitemap moves with the pages
  // rather than going stale until the next deploy.
  tags: nextlyTags(COLLECTION),
  entries: () =>
    contentSitemapEntries({
      collections: [COLLECTION],
      baseUrl: BASE_URL,
      basePath: MOUNT,
      // Present on every collection with timestamps on, and omitted from the
      // entry when a row does not carry a usable one.
      lastModifiedField: "updatedAt",
    }),
});
