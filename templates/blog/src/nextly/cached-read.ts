/**
 * Nextly's cached reads under Cache Components.
 *
 * Next.js caches non-fetch reads with `"use cache"` and `cacheTag` once Cache
 * Components is on, and the directive works only in code Next.js compiles, so
 * Nextly reads through this function of the app's own. It receives the read's
 * key, its tags and its lifetime, and runs the reader Nextly registered for
 * that key. The query modules import this file, so it is registered wherever
 * content is read.
 *
 * It works with `cacheComponents: true` and Nextly's cache handlers in
 * `next.config.ts`, as this app ships:
 * https://nextlyhq.com/docs/guides/isr-caching#cache-components
 */
import { cacheLife, cacheTag } from "next/cache";
import { registerCachedRead, runRegisteredRead } from "nextly/runtime";

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
