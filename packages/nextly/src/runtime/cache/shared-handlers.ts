/**
 * Whether nextly's cache handlers serve this process's cached reads, and the
 * lifetime a cached public read is given in production when they do not.
 *
 * Without them, a write reaches only the cache of the process that made it:
 * another instance, the CLI or a job runner records its expiry where only
 * nextly's handlers read it. No process can count the others, so the bound
 * applies whenever the handlers are not in use: every cached public read is
 * refreshed at least once a minute, and nextly says so once, with the setting
 * that lifts it.
 *
 * Next.js 16.4 loads both handlers before it renders anything. A request's
 * `getIncrementalCache` (`next/dist/server/next-server.js`) imports
 * `cacheHandler`, registers every `cacheHandlers` entry through
 * `loadCustomCacheHandlers`, and only then constructs the request's
 * `IncrementalCache`, which constructs the `cacheHandler` class. A build's
 * `createIncrementalCache` (`next/dist/export/helpers/create-incremental-cache.js`)
 * does the same before it prerenders. By the time a read is cached, the answer
 * here is settled.
 *
 * @module runtime/cache/shared-handlers
 */
import { getNextlyLogger } from "../../observability/logger";

/** The longest a cached public read is kept, in seconds, without the handlers. */
export const UNSHARED_READ_LIFETIME_SECONDS = 60;

/**
 * Marks nextly's `"use cache"` handler, under a key every copy of its module
 * shares, so the handler Next.js registered is recognised whichever copy
 * Next.js loaded.
 */
export const USE_CACHE_HANDLER_BRAND = Symbol.for("nextly/use-cache-handler");

/** Where Next.js keeps its `"use cache"` handlers by kind (`next/dist/server/use-cache/handlers.js`). */
const NEXT_CACHE_HANDLERS = Symbol.for("@next/cache-handlers-map");

const globalForShared = globalThis as unknown as {
  __nextly_incremental_handler_in_use?: boolean;
  __nextly_unshared_reads_warned?: boolean;
};

/** Called as Next.js constructs nextly's incremental handler: it serves this process. */
export function markIncrementalHandlerInUse(): void {
  globalForShared.__nextly_incremental_handler_in_use = true;
}

/** Whether Next.js serves plain `"use cache"` through nextly's handler. */
function useCacheHandlerServesDefault(): boolean {
  const handlers = (globalThis as Record<symbol, unknown>)[NEXT_CACHE_HANDLERS];
  if (!(handlers instanceof Map)) return false;
  const handler: unknown = handlers.get("default");
  return (
    typeof handler === "object" &&
    handler !== null &&
    (handler as Record<symbol, unknown>)[USE_CACHE_HANDLER_BRAND] === true
  );
}

/**
 * Whether nextly's handlers serve a read cached through `"use cache"` (Cache
 * Components) or through `unstable_cache`. The incremental handler is needed
 * either way: with Cache Components it holds the pages those reads render.
 */
function sharedHandlersServe(throughUseCache: boolean): boolean {
  const incremental =
    globalForShared.__nextly_incremental_handler_in_use === true;
  return throughUseCache
    ? incremental && useCacheHandlerServesDefault()
    : incremental;
}

/** The handler settings, as the caching guide gives them. */
const INSTALL_LINES =
  'cacheHandler: require.resolve("nextly/cache-handler"), cacheMaxMemorySize: 0, cacheHandlers: { default: require.resolve("nextly/cache-handlers") }';

/** Says once per process that cached public reads are bounded, and how to lift it. */
function warnUnshared(): void {
  if (globalForShared.__nextly_unshared_reads_warned) return;
  globalForShared.__nextly_unshared_reads_warned = true;
  getNextlyLogger().warn({
    kind: "cache-handlers-not-shared",
    message: `nextly's cache handlers are not installed, so a write made by another instance, the CLI or a job reaches no cache here. Cached public reads are refreshed at least every ${UNSHARED_READ_LIFETIME_SECONDS} seconds until they are. Install them in next.config to see every write on every instance at once and keep longer lifetimes: ${INSTALL_LINES}. See https://nextlyhq.com/docs/guides/isr-caching#cache-components`,
  });
}

/**
 * The lifetime a cached public read is given: `configured`, or, in production
 * without nextly's handlers, at most {@link UNSHARED_READ_LIFETIME_SECONDS}. A
 * read cached until a write expires it (`false`) is refreshed then too.
 */
export function publicReadLifetime(
  configured: number | false,
  throughUseCache: boolean
): number | false {
  // Development runs one process, which every write it makes reaches.
  if (process.env.NODE_ENV !== "production") return configured;
  if (sharedHandlersServe(throughUseCache)) return configured;
  warnUnshared();
  return configured === false
    ? UNSHARED_READ_LIFETIME_SECONDS
    : Math.min(configured, UNSHARED_READ_LIFETIME_SECONDS);
}
