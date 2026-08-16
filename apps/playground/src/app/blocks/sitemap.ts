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

import { BLOCKS_COLLECTION, BLOCKS_MOUNT } from "./route-config";

// The collection and mount come from the route's own definition, so this
// cannot advertise a path the route does not serve. Two copies of either value
// would disagree silently: a well-formed sitemap naming paths that 404, or
// omitting every page that exists.

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

/**
 * Generated per request, not at build.
 *
 * `nextlySitemap` marks its own render dynamic only when it has NEITHER tags
 * nor a revalidate window; given tags it takes the cached path, and Next then
 * tries to produce the first value during `next build`. That boots the CMS, and
 * a build machine has no database — so the whole build fails on environment
 * validation rather than on anything about this document.
 *
 * The route this describes is already dynamic for the same underlying reason:
 * it reads access-enforced content, so what it serves is not known until a
 * request exists. A sitemap of those pages cannot be more static than the pages.
 *
 * The tags still do their work. They bust the cached entry when the collection
 * is written, so the document regenerates on the next request instead of going
 * stale until a deploy.
 */
export const dynamic = "force-dynamic";

export default nextlySitemap({
  // Busted by a write to the collection, so the sitemap moves with the pages
  // rather than going stale until the next deploy.
  tags: nextlyTags(BLOCKS_COLLECTION),
  entries: () =>
    contentSitemapEntries({
      collections: [BLOCKS_COLLECTION],
      // The route is `createBlocksPage`, the access-ENFORCED factory, so the
      // scan reads as the anonymous visitor this document is served to. Stated
      // rather than defaulted: the option is required precisely so a public
      // route cannot inherit a restricted scan and silently omit every page.
      content: "restricted",
      baseUrl: BASE_URL,
      basePath: BLOCKS_MOUNT,
      // Present on every collection with timestamps on, and omitted from the
      // entry when a row does not carry a usable one.
      lastModifiedField: "updatedAt",
      nextly: reader,
    }),
});
