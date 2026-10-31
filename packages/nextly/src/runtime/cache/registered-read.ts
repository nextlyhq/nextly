/**
 * Cached reads under Cache Components, through a `"use cache"` function the app
 * compiles.
 *
 * With Cache Components on, Next.js caches non-fetch reads with `"use cache"`
 * and `cacheTag` rather than `unstable_cache`, and a page read right after a
 * write can still be served the previous `unstable_cache` entry once. The
 * directive has to sit in code Next.js compiles, and nextly is a server
 * external, so the app hands nextly its own `"use cache"` function,
 * `cachedRead(key, tags, revalidate)`, through `registerCachedRead`.
 *
 * A cached function's arguments must be serializable, so the reader itself
 * cannot be passed in. It is registered here under the read's key instead,
 * while the call is in flight. The app's function calls `runRegisteredRead(key)`
 * on a miss, in the same process. A key can be in flight for several requests
 * at once, and any of their readers answers it (the key names everything the
 * result varies by), so each entry is counted, and one request's end never
 * removes a reader another is about to run.
 *
 * A miss is not the only time the body runs. An entry past its `revalidate` is
 * served stale, and Next.js regenerates it in the background after the call
 * has returned, so a reader stays registered for `DEFERRED_FILL_WINDOW_MS`
 * once nothing holds it: long enough for that fill to find it, short enough
 * that a key read once is not kept for good.
 *
 * @module runtime/cache/registered-read
 */
import { cacheComponentsEnabled } from "../../cache-components";
import { NextlyError } from "../../errors/nextly-error";
import { getNextlyLogger } from "../../observability/logger";

/** The app's `"use cache"` function: caches `runRegisteredRead(key)` under `key` and `tags`. */
export type CachedRead = (
  key: string,
  tags: string[],
  revalidate: number | false
) => Promise<unknown>;

interface Registered {
  reader: () => Promise<unknown>;
  holders: number;
  /** Removes the entry once the deferred-fill window ends, while nothing holds it. */
  expiry: ReturnType<typeof setTimeout> | undefined;
}

/**
 * How long a reader outlives the last call that registered it. Next.js starts
 * a stale entry's background fill as the stale value is served, so the fill
 * reaches `runRegisteredRead` within moments; a minute leaves room for a
 * loaded process. A fill that comes later still finds nothing, and the entry
 * stays stale until a later read past `revalidate` starts another.
 */
export const DEFERRED_FILL_WINDOW_MS = 60_000;

interface RegistryState {
  cachedRead: CachedRead | undefined;
  readers: Map<string, Registered>;
  /** Whether the app's build has Cache Components on, as `createRegister` was told. */
  cacheComponents: boolean;
  /** Whether a read under Cache Components without a registered function has been said. */
  unregisteredReported: boolean;
}

const STATE = Symbol.for("nextly/registered-read");

/** One state per process, however many copies of this module load. */
function state(): RegistryState {
  const holder = globalThis as unknown as Record<symbol, RegistryState>;
  holder[STATE] ??= {
    cachedRead: undefined,
    readers: new Map(),
    cacheComponents: false,
    unregisteredReported: false,
  };
  return holder[STATE];
}

/** Records the app's cached-read function, or forgets it with `undefined`. */
export function setCachedRead(cachedRead: CachedRead | undefined): void {
  state().cachedRead = cachedRead;
}

/**
 * Registers the app's cached-read function from the module that defines it.
 * That module must be one Next.js compiles as a server component, where it
 * applies `"use cache"`: an import from `instrumentation.ts` is not, and its
 * copy of the function is not a cached one. `cacheComponents` is the value
 * Next.js inlines into that module for `process.env.__NEXT_CACHE_COMPONENTS`;
 * the function is used only when it says Cache Components is on.
 */
export function registerCachedRead(
  cachedRead: CachedRead,
  cacheComponents: unknown
): void {
  setCachedRead(
    cacheComponentsEnabled(cacheComponents) ? cachedRead : undefined
  );
}

/** Where the cached-read file and how to turn Cache Components on are described. */
const CACHED_READ_DOCS_URL =
  "https://nextlyhq.com/docs/guides/isr-caching#cache-components";

/**
 * Records whether the app's build has Cache Components on, from
 * `createRegister`. Each boot starts the once-only warning afresh.
 */
export function recordCacheComponents(on: boolean): void {
  const current = state();
  current.cacheComponents = on;
  current.unregisteredReported = false;
}

/**
 * Says, once per process, that a cached read ran under Cache Components with
 * no `"use cache"` function registered: the read falls back to
 * `unstable_cache`, and a page read right after a write can show the previous
 * version. Usually the app turned Cache Components on and kept the stub
 * `src/nextly/cached-read.ts`.
 */
export function reportUnregisteredUnderCacheComponents(): void {
  const current = state();
  if (!current.cacheComponents || current.unregisteredReported) return;
  current.unregisteredReported = true;
  getNextlyLogger().warn({
    kind: "cached-read-missing",
    message: `Cache Components is on, but no "use cache" read function is registered, so cached reads use unstable_cache and a page read right after a write can show the previous version. Replace src/nextly/cached-read.ts with its Cache Components version: ${CACHED_READ_DOCS_URL}`,
  });
}

/** The app's cached-read function, if it registered one. */
export function registeredCachedRead(): CachedRead | undefined {
  return state().cachedRead;
}

/** The reason an unregistered read is refused with, matched on the way back out. */
const UNREGISTERED = "unregistered-cached-read";

/**
 * Whether `error` is the refusal `runRegisteredRead` throws. Matched by its
 * reason, and by its message, since an error can come back out of a
 * `"use cache"` function as a copy rather than the object thrown.
 */
function isUnregistered(error: unknown): boolean {
  if (NextlyError.is(error) && error.logContext?.reason === UNREGISTERED) {
    return true;
  }
  if (!(error instanceof Error)) return false;
  const cause = error.cause instanceof Error ? error.cause.message : "";
  return `${error.message} ${cause}`.includes(UNREGISTERED);
}

/**
 * Runs the reader registered under `key`. Called by the app's `"use cache"`
 * function on a miss. With none registered it throws, so the miss is never
 * cached, and the caller reads directly instead.
 */
export function runRegisteredRead(key: string): Promise<unknown> {
  const entry = state().readers.get(key);
  if (entry === undefined) {
    throw NextlyError.internal({
      cause: new Error(`${UNREGISTERED}: no reader is registered for ${key}`),
      logContext: { reason: UNREGISTERED, key },
    });
  }
  return entry.reader();
}

/**
 * Whether `error` is Next.js refusing a `"use cache"` call outside an App
 * Router request or build: instrumentation, a background job, a script. It
 * throws before the body runs, so the reader has not run yet. Matched by the
 * phrase both of its refusals share (no WorkStore, no WorkUnitStore);
 * `cache-components.test.ts` pins the phrase to the installed Next.js.
 */
function isOutsideAppRouter(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('"use cache" cannot be used outside of App Router')
  );
}

/**
 * Registers `reader` under `key` for one more call. An entry already there
 * takes the newest reader: any of them answers the key, and the newest comes
 * from a request still under way.
 */
function hold(key: string, reader: () => Promise<unknown>): void {
  const { readers } = state();
  const held = readers.get(key);
  if (held === undefined) {
    readers.set(key, { reader, holders: 1, expiry: undefined });
    return;
  }
  held.reader = reader;
  held.holders++;
  clearTimeout(held.expiry);
  held.expiry = undefined;
}

/**
 * Lets go of one call's hold on `key`. The last one leaves the reader for the
 * deferred-fill window, then removes it unless a new call has taken it again.
 */
function release(key: string): void {
  const { readers } = state();
  const entry = readers.get(key);
  if (entry === undefined || --entry.holders > 0) return;
  entry.expiry = setTimeout(() => {
    if (readers.get(key) === entry && entry.holders === 0) {
      readers.delete(key);
    }
  }, DEFERRED_FILL_WINDOW_MS);
  // A pending removal never keeps a script or a test process alive.
  entry.expiry.unref?.();
}

/**
 * Reads through the app's `cachedRead`, with `reader` registered under `key`
 * while this call is in flight and for the deferred-fill window after. A body
 * that finds no reader (which should not happen, since registration precedes
 * the call) falls back to the reader here rather than failing the read, and so
 * does a call outside an App Router scope, which Next.js refuses to cache.
 */
export async function readThroughRegistered<T>(
  cachedRead: CachedRead,
  key: string,
  reader: () => Promise<T>,
  tags: string[],
  revalidate: number | false
): Promise<T> {
  hold(key, reader);
  try {
    return (await cachedRead(key, tags, revalidate)) as T;
  } catch (error) {
    // Read directly and without a warning, as the unstable_cache path reads
    // outside a Next.js scope.
    if (isOutsideAppRouter(error)) return reader();
    if (isUnregistered(error)) {
      // Said, since the read then goes uncached: it should never happen, as
      // the reader is registered before the cached function is called.
      getNextlyLogger().warn({
        kind: "cached-read-unregistered",
        message: `A cached read found no registered reader for ${key}, so it read without the cache.`,
        key,
      });
      return reader();
    }
    throw error;
  } finally {
    release(key);
  }
}
