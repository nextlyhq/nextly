/**
 * The read function the caching guide gives an app under Cache Components.
 * Copied over `cached-read.ts` for the driver's Cache Components leg only:
 * Next.js refuses `"use cache"` in a build with Cache Components off.
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
    cacheLife({ revalidate, expire: Math.max(revalidate * 2, 60) });
  }
  return runRegisteredRead(key);
}

registerCachedRead(cachedRead, process.env.__NEXT_CACHE_COMPONENTS);
