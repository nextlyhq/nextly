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
import { BoundedEntries } from "./bounded-entries";
import {
  expireTags,
  isEntryExpired,
  refreshTagExpiries,
} from "./tag-expiry-view";

interface StoredEntry {
  value: unknown;
  lastModified: number;
  tags: readonly string[];
}

interface CacheContext {
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
 * A rough size for the bound: the entry as JSON, with each buffer counted by
 * its length rather than serialised. A Buffer reaches the replacer already
 * turned into `{ type: "Buffer", data }` by its own `toJSON`.
 */
function sizeOf(value: unknown): number {
  let buffers = 0;
  try {
    const json = JSON.stringify(value, (_key, part: unknown) => {
      if (part instanceof Uint8Array) {
        buffers += part.byteLength;
        return null;
      }
      const serialised = part as { type?: unknown; data?: unknown } | null;
      if (serialised?.type === "Buffer" && Array.isArray(serialised.data)) {
        buffers += serialised.data.length;
        return null;
      }
      return part;
    });
    return (json?.length ?? 0) + buffers;
  } catch {
    // An entry that cannot be measured is kept, counted at a nominal size.
    return 1024;
  }
}

export default class NextlyIncrementalCacheHandler {
  private readonly entries = new BoundedEntries<StoredEntry>();

  async get(
    key: string,
    ctx?: CacheContext
  ): Promise<{ lastModified: number; value: unknown } | null> {
    const stored = this.entries.get(key);
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
    if (isEntryExpired(tags, stored.lastModified)) {
      this.entries.delete(key);
      return null;
    }
    return { lastModified: stored.lastModified, value: stored.value };
  }

  // Synchronous work behind the promise Next.js expects from a handler.
  set(key: string, data: unknown, ctx?: CacheContext): Promise<void> {
    if (data === null || data === undefined) {
      this.entries.delete(key);
    } else {
      this.entries.set(
        key,
        { value: data, lastModified: Date.now(), tags: ctx?.tags ?? [] },
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
