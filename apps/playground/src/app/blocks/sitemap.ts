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
import { getNextly } from "nextly";
import {
  nextlySitemap,
  contentSitemapEntries,
  nextlyTags,
} from "nextly/runtime";

import nextlyConfig from "../../../nextly.config";

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

/**
 * The reader, booted here rather than left to the default.
 *
 * `contentSitemapEntries` otherwise falls back to the synchronous `getNextly()`,
 * which returns an already-registered singleton and THROWS when nothing has
 * registered one. A sitemap is produced at build time, and is equally a
 * candidate for the first request a cold server handles — so taking the default
 * means it works only once something else has booted the CMS, which in this app
 * means a visit to `/admin`. The blocks route beside it boots the same way, for
 * the same reason.
 *
 * Async boot cannot happen where the config is captured, so this is a call
 * rather than a value; `getNextly` caches its instance, so every call after the
 * first is a lookup.
 */
type Reader = Awaited<ReturnType<typeof getNextly>>;
const reader = {
  find: async (args: Parameters<Reader["find"]>[0]) =>
    (await getNextly({ config: nextlyConfig })).find(args),
};

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
      nextly: reader,
    }),
});
