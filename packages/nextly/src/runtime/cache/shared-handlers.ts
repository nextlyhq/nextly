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

/**
 * The revalidate a cached public read is given, in seconds, without the
 * handlers. Half a minute, so the app's `"use cache"` read function as
 * `create-nextly-app` writes it, which expires an entry at twice its revalidate
 * and never sooner than 60 s, holds no entry longer than a minute: a revalidate
 * alone would serve a stale entry while it regenerates.
 */
export const UNSHARED_READ_LIFETIME_SECONDS = 30;

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

/**
 * The handler settings, as `create-nextly-app` writes them; a test holds the
 * two copies to each other.
 */
const INSTALL_LINES =
  'cacheHandler: require.resolve("nextly/cache-handler"), cacheMaxMemorySize: 0, cacheHandlers: { default: require.resolve("nextly/cache-handlers") }';

/** Where the settings an app needs, and why, are written up. */
const CACHE_COMPONENTS_DOCS_URL =
  "https://nextlyhq.com/docs/getting-started/installation#cache-components";

/**
 * Called once a read was cached, inside a scope Next.js caches in: says, once
 * per process, that such reads are bounded. Only then, since a read outside
 * any such scope (the CLI, a job, instrumentation) runs uncached, and the
 * handlers it would be told to install may still be loaded later.
 */
export function noteCachedRead(throughUseCache: boolean): void {
  if (bounded(throughUseCache)) warnUnshared();
}

/** Says once per process that cached public reads are bounded, and how to lift it. */
function warnUnshared(): void {
  if (globalForShared.__nextly_unshared_reads_warned) return;
  globalForShared.__nextly_unshared_reads_warned = true;
  getNextlyLogger().warn({
    kind: "cache-handlers-not-shared",
    message: `Nextly's cache handlers don't serve this process: none is installed, or the app keeps a cache handler of its own, which a write made outside a request can't reach. So a write by another instance, the CLI or a job reaches no cache here, and cached public reads are refreshed at least once a minute until Nextly's handlers serve them. Install them in next.config to see every write on every instance and keep longer lifetimes: ${INSTALL_LINES}. What to set, and why: ${CACHE_COMPONENTS_DOCS_URL}`,
  });
}

/**
 * Whether a read cached this way is bounded: in production, while nextly's
 * handlers do not serve it. Development runs one process, which every write it
 * makes reaches.
 */
function bounded(throughUseCache: boolean): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    !sharedHandlersServe(throughUseCache)
  );
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
  if (!bounded(throughUseCache)) return configured;
  return configured === false
    ? UNSHARED_READ_LIFETIME_SECONDS
    : Math.min(configured, UNSHARED_READ_LIFETIME_SECONDS);
}
