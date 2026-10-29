/**
 * Registry rows, kept for a second: collections' as
 * `DynamicCollectionRegistryService.getCollection` reads them, and Singles' and
 * components' as their registry services' `getRecordBySlug` does.
 *
 * A single read of an entry looks its collection up several times, and every
 * lookup was a round trip. Here the first read of a slug goes to the database
 * and the reads within the next second are answered from memory.
 *
 * Every registry change this process makes clears the cache at once, so the
 * process that made it never serves the old row. A change made elsewhere (by
 * another instance, the CLI or a migration) is seen once the cached row's
 * second is up: that lifetime is the bound on how long it can go unseen.
 *
 * Each caller gets its own copy, so an edit to what it was handed cannot reach
 * the next caller.
 *
 * @module domains/dynamic-collections/services/collection-row-cache
 */
import { isWithinLifetime, monotonicNow } from "../../../shared/lib/lifetime";

/**
 * How long a cached row is served before it is read again: the bound on how
 * long a change made outside this process goes unseen.
 */
export const COLLECTION_ROW_LIFETIME_MS = 1000;

interface CachedRow {
  /** `null` for a slug the registry does not hold: missing is an answer too. */
  row: Record<string, unknown> | null;
  readAt: number;
  /** The cache's generation when the read began: served only while current. */
  generation: number;
}

interface CacheState {
  /** Moved by every clear, so a row read before one is never kept after it. */
  generation: number;
  /** Rows by slug, per database: one process may hold several. */
  byDatabase: WeakMap<object, Map<string, CachedRow>>;
}

// On `globalThis`: a Next.js dev server holds several module registries, and a
// cache per registry would be several caches, each cleared only by the writes
// made through its own copy of this module.
const globalForCache = globalThis as unknown as {
  __nextly_collectionRowCache?: CacheState;
};

function cacheState(): CacheState {
  globalForCache.__nextly_collectionRowCache ??= {
    generation: 0,
    byDatabase: new WeakMap(),
  };
  return globalForCache.__nextly_collectionRowCache;
}

/** Forget every cached row: a collection's, a Single's or a component's registry row changed. */
export function clearRegistryRowCache(): void {
  cacheState().generation += 1;
}

/** A collection's registry row, cached as `cachedRegistryRow` caches any. */
export async function cachedCollectionRow(
  database: object,
  slug: string,
  read: () => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  return cachedRegistryRow(database, "dynamic_collections", slug, read);
}

/**
 * The row for `slug` in the registry table `table` on `database`: a copy of the cached one while it is
 * within its lifetime and no clear has happened since its read began,
 * otherwise `read()`'s, which is then kept. A read a clear overtakes may hold
 * the row from before the change: it is kept under the generation it began
 * in, so it is never served.
 */
export async function cachedRegistryRow<
  T extends Record<string, unknown> | null,
>(
  database: object,
  table: string,
  slug: string,
  read: () => Promise<T>
): Promise<T> {
  const key = `${table}\u0000${slug}`;
  const cache = cacheState();
  let rows = cache.byDatabase.get(database);
  const hit = rows?.get(key);
  if (
    hit !== undefined &&
    hit.generation === cache.generation &&
    isWithinLifetime(hit.readAt, COLLECTION_ROW_LIFETIME_MS)
  ) {
    return structuredClone(hit.row) as T;
  }
  const generation = cache.generation;
  // Timed from before the read, so the lifetime never outlasts the moment the
  // database answered.
  const readAt = monotonicNow();
  const row = await read();
  if (rows === undefined) {
    rows = new Map();
    cache.byDatabase.set(database, rows);
  }
  rows.set(key, { row: structuredClone(row), readAt, generation });
  return row;
}
