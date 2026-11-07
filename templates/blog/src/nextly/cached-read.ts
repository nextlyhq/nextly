/**
 * Nextly's cached reads under Cache Components.
 *
 * Next.js caches non-fetch reads with `"use cache"` and `cacheTag` once Cache
 * Components is on, and the directive works only in code Next.js compiles, so
 * Nextly reads through this function of the app's own. It receives the read's
 * key, its tags and its lifetime, and runs the reader Nextly registered for
 * that key. The root layout imports this file, so it is registered on every
 * route before anything is read (`<SiteCode>` refuses to read without it),
 * and the query modules import it too, so a module read on its own has it.
 *
 * The same import also tells Nextly how to start with the app's config when a
 * read finds it not started, so the root layout's import both registers the
 * cached read and covers a read made before any page starts Nextly, during
 * `next build` too.
 *
 * It works with `cacheComponents: true` and Nextly's cache handlers in
 * `next.config.ts`, as this app ships:
 * https://nextlyhq.com/docs/guides/isr-caching#cache-components
 */
import { cacheLife, cacheTag } from "next/cache";
import { getNextly, registerNextlyStart } from "nextly";
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

// Tells Nextly how this app starts it, for a read that finds it not started,
// such as the root layout's `<SiteCode>` on `/_not-found` while `next build`
// prerenders, where nothing else starts it. Nothing starts here: a page that
// calls `getNextly` first is the start that counts. An app that passes
// `getNextly` more than its config passes the same options here.
registerNextlyStart(() => getNextly({ config }));
