/**
 * nextly's incremental cache handler, Next.js's `cacheHandler`: the store for
 * `unstable_cache` reads and for rendered pages and route responses.
 *
 * Entries are kept in this instance's memory. Whether one may still be served
 * is asked of the tag expiry ledger every instance shares, so a write made on
 * another instance, or outside any request, expires it here too. Configured in
 * `next.config` with `cacheMaxMemorySize: 0`, so Next.js keeps no second copy.
 *
 * @module runtime/cache/incremental-cache-handler
 */
import { sharedEntries } from "./bounded-entries";
import {
  expireTags,
  isEntryExpired,
  localNow,
  refreshTagExpiries,
} from "./tag-expiry-view";

interface StoredEntry {
  value: unknown;
  lastModified: number;
  /** When the fill that made it began, on `localNow`'s clock: what it is judged by. */
  begunAt: number;
  tags: readonly string[];
  // The lifetime Next.js derives a route's revalidation from, handed back as
  // given: an entry without it would revalidate after a second.
  cacheControl?: unknown;
}

interface CacheContext {
  cacheControl?: unknown;
  tags?: readonly string[];
  softTags?: readonly string[];
}

/** The tags a stored page or response carries in its cache-tags header. */
function headerTags(value: unknown): string[] {
  const header = (value as { headers?: Record<string, unknown> } | null)
    ?.headers?.["x-next-cache-tags"];
  return typeof header === "string" ? header.split(",") : [];
}

/**
 * A rough size for the bound, walking the value rather than serialising it:
 * a page's `segmentData` is a Map of Buffers, which JSON writes as `{}`, so a
 * serialised length would let a large prerender pass as a few bytes. Bytes are
 * counted for buffers, characters for strings and keys, and a few bytes for
 * anything else; a value seen twice is counted once.
 */
function sizeOf(value: unknown, seen = new WeakSet<object>()): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value !== "object") return 8;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  let bytes = 0;
  if (value instanceof Map) {
    for (const [key, part] of value) {
      bytes += sizeOf(key, seen) + sizeOf(part, seen);
    }
    return bytes;
  }
  if (value instanceof Set || Array.isArray(value)) {
    for (const part of value) bytes += sizeOf(part, seen);
    return bytes;
  }
  for (const [key, part] of Object.entries(value)) {
    bytes += key.length + sizeOf(part, seen);
  }
  return bytes;
}

/** Stored pages, routes and fetches, shared by every handler Next.js makes. */
// Looked up on each use, so the store a test resets is the one read.
const entries = () => sharedEntries<StoredEntry>("incremental");

/**
 * How long after a read of its key a `set` is taken as that read's fill. A
 * fill longer than this is stamped when it is stored, as one with no read.
 */
const FILL_WINDOW_MS = 60_000;

/** At most this many reads are remembered before the old ones are dropped. */
const MAX_REMEMBERED_READS = 10_000;

const globalForReads = globalThis as unknown as {
  __nextly_cache_reads?: Map<string, number>;
};

/**
 * When each key was last read, by any handler Next.js makes. Next.js fills a
 * key after a read misses it or finds it stale, so the read marks when the
 * fill began: an expiry recorded while it ran then judges what it stores,
 * instead of the fill passing for fresh because it finished later.
 */
function reads(): Map<string, number> {
  globalForReads.__nextly_cache_reads ??= new Map();
  return globalForReads.__nextly_cache_reads;
}

function rememberRead(key: string): void {
  const remembered = reads();
  const now = localNow();
  if (remembered.size >= MAX_REMEMBERED_READS) {
    for (const [old, at] of remembered) {
      if (now - at > FILL_WINDOW_MS) remembered.delete(old);
    }
  }
  remembered.delete(key);
  remembered.set(key, now);
}

/** When the fill being stored for `key` began: its read, or now if none. */
function fillBegan(key: string): number {
  const remembered = reads();
  const readAt = remembered.get(key);
  remembered.delete(key);
  const now = localNow();
  return readAt !== undefined && now - readAt <= FILL_WINDOW_MS ? readAt : now;
}

export default class NextlyIncrementalCacheHandler {
  async get(
    key: string,
    ctx?: CacheContext
  ): Promise<{
    lastModified: number;
    value: unknown;
    cacheControl?: unknown;
  } | null> {
    rememberRead(key);
    const stored = entries().get(key);
    if (stored === undefined) return null;
    const tags = [
      ...stored.tags,
      ...(ctx?.tags ?? []),
      ...(ctx?.softTags ?? []),
      ...headerTags(stored.value),
    ];
    // Only the tags this entry carries are asked about, so a hit costs at
    // most one ledger read, and none while their answers are fresh.
    await refreshTagExpiries(tags);
    if (isEntryExpired(tags, stored.begunAt)) {
      entries().deleteIf(key, stored);
      return null;
    }
    return {
      lastModified: stored.lastModified,
      value: stored.value,
      cacheControl: stored.cacheControl,
    };
  }

  // Synchronous work behind the promise Next.js expects from a handler.
  set(key: string, data: unknown, ctx?: CacheContext): Promise<void> {
    // `null` is a value: a not-found response, cached like any other so the
    // route is not run again on every request.
    if (data === undefined) {
      entries().delete(key);
    } else {
      entries().set(
        key,
        {
          value: data,
          lastModified: Date.now(),
          begunAt: fillBegan(key),
          tags: ctx?.tags ?? [],
          cacheControl: ctx?.cacheControl,
        },
        sizeOf(data)
      );
    }
    return Promise.resolve();
  }

  async revalidateTag(tags: string | string[]): Promise<void> {
    await expireTags(Array.isArray(tags) ? tags : [tags]);
  }

  // No `resetRequestCache`: this handler keeps no per-request state, and
  // Next.js calls that method only when a handler has one.
}
