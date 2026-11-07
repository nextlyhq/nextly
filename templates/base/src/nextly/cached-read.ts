/**
 * Nextly's cached reads under Cache Components.
 *
 * Next.js caches non-fetch reads with `"use cache"` and `cacheTag` once Cache
 * Components is on, and the directive works only in code Next.js compiles, so
 * Nextly reads through this function of the app's own. It receives the read's
 * key, its tags and its lifetime, and runs the reader Nextly registered for
 * that key. The root layout imports this file, so it is registered on every
 * route before anything is read: `<SiteCode>` refuses to read without it.
 *
 * The same import also starts Nextly with the app's config, so the root
 * layout's import both registers the cached read and starts Nextly for every
 * route, during `next build` too.
 *
 * It works with `cacheComponents: true` and Nextly's cache handlers in
 * `next.config.ts`, as this app ships:
 * https://nextlyhq.com/docs/guides/isr-caching#cache-components
 */
import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { getNextly } from "nextly";
import { registerCachedRead, runRegisteredRead } from "nextly/runtime";

import config from "@nextly-config";

export async function cachedRead(
  key: string,
  tags: string[],
  revalidate: number | false
): Promise<unknown> {
  "use cache";
  cacheTag(...tags);
  // `revalidate: false` is tag-only, as everywhere in Nextly: only a write
  // expires the entry, never time. Next.js's "max" profile revalidates monthly.
  if (revalidate === false) {
    cacheLife({ revalidate: Infinity, expire: Infinity });
  } else {
    // Expired at twice the revalidate, and never within 5 minutes: Next.js
    // leaves an entry that expires sooner out of a static prerender.
    cacheLife({ revalidate, expire: Math.max(revalidate * 2, 300) });
  }
  return runRegisteredRead(key);
}

registerCachedRead(cachedRead, process.env.__NEXT_CACHE_COMPONENTS);

// Starts Nextly as the root layout loads, so a read made before any page has
// started it, such as the root layout's `<SiteCode>` on `/_not-found` while
// `next build` prerenders, finds it starting and waits for it: nothing else
// starts Nextly in a build's prerender workers. A failed start (the database
// down, say) is caught here so it is not an unhandled rejection; the next
// read waits for or retries the start, and reports it.
void getNextly({ config }).catch(() => undefined);
