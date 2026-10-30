/**
 * nextly's `use cache` handler, Next.js's `cacheHandlers.default`.
 *
 * Entries are kept in this instance's memory, their value streams read once in
 * `set` and replayed as a new stream on every hit. Expiry is the tag expiry
 * ledger's, shared with the incremental handler, so a write made on another
 * instance, or outside any request, reaches `use cache` entries here too.
 *
 * @module runtime/cache/use-cache-handler
 */
import { BoundedEntries } from "./bounded-entries";
import {
  expireTags,
  isEntryExpired,
  latestExpiry,
  refreshTagExpiries,
} from "./tag-expiry-view";

/** A `use cache` entry, as Next.js hands it over and asks it back. */
interface CacheEntry {
  value: ReadableStream<Uint8Array>;
  tags: string[];
  stale: number;
  timestamp: number;
  expire: number;
  revalidate: number;
}

interface StoredEntry {
  entry: Omit<CacheEntry, "value">;
  chunks: Uint8Array[];
}

const entries = new BoundedEntries<StoredEntry>();

/** A new stream over stored chunks, for one reader. */
function replay(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

const useCacheHandler = {
  async get(
    cacheKey: string,
    softTags: string[]
  ): Promise<CacheEntry | undefined> {
    const stored = entries.get(cacheKey);
    if (stored === undefined) return undefined;
    const tags = [...stored.entry.tags, ...softTags];
    await refreshTagExpiries(tags);
    if (isEntryExpired(tags, stored.entry.timestamp)) {
      entries.delete(cacheKey);
      return undefined;
    }
    return { ...stored.entry, value: replay(stored.chunks) };
  },

  async set(
    cacheKey: string,
    pendingEntry: Promise<CacheEntry>
  ): Promise<void> {
    const { value, ...entry } = await pendingEntry;
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = value.getReader();
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
      bytes += chunk.byteLength;
    }
    entries.set(cacheKey, { entry, chunks }, bytes);
  },

  // Nothing to do once per request: the ledger is asked about the tags each
  // read carries, when that read is made.
  async refreshTags(): Promise<void> {},

  async getExpiration(tags: string[]): Promise<number> {
    await refreshTagExpiries(tags);
    return latestExpiry(tags);
  },

  // Every expiry is immediate here, `max` profiles included: a write recorded
  // for another instance cannot carry a stale-while-revalidate window there.
  async updateTags(tags: string[]): Promise<void> {
    await expireTags(tags);
  },
};

export default useCacheHandler;
