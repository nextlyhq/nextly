/**
 * Nextly's cached reads under Cache Components.
 *
 * This app builds without Cache Components (`cacheComponents: false` in
 * `next.config.ts`), so this file registers nothing and Nextly caches its reads
 * with `unstable_cache`. The query modules import it so that, under Cache
 * Components, the version that registers a `"use cache"` read function is
 * loaded wherever content is read.
 *
 * To turn Cache Components on, replace this file with the contents of
 * `cached-read.cache-components.txt` beside it, and add Nextly's cache handlers
 * to `next.config.ts`, as described at
 * https://nextlyhq.com/docs/guides/isr-caching#cache-components
 * Nextly warns at the first cached read when Cache Components is on and this
 * file has not been replaced.
 */
export {};
