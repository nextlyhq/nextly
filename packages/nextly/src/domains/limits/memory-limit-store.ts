/**
 * The limit store kept in this process's memory: the default.
 *
 * Every instance counts on its own, so on several instances each budget is
 * multiplied by their number; `shared` says so. It holds at most a set number
 * of entries. When it is full of live ones it answers a new key as
 * unavailable rather than dropping a live count to make room: dropping one
 * would let anybody who can send new keys free the count of an attacker they
 * are covering for.
 *
 * @experimental
 * @module domains/limits/memory-limit-store
 */
import { watchCapacity } from "./capacity-watch";
import {
  checkLimitKeys,
  limitStoreUnavailable,
  serialiseLimitWrite,
  type LimitStore,
  type SerialisedLimit,
  type StoredLimit,
} from "./limit-store";

/** How many entries the memory store holds unless told otherwise. */
export const MEMORY_LIMIT_STORE_DEFAULT_MAX_ENTRIES = 100_000;

/** How the memory store is set up. */
export interface MemoryLimitStoreOptions {
  /** The most entries it holds; {@link MEMORY_LIMIT_STORE_DEFAULT_MAX_ENTRIES} by default. */
  maxEntries?: number;
  /** Milliseconds now; the process's clock by default. */
  clock?: () => number;
}

/** The memory store, with what its tests read of it. */
export interface MemoryLimitStore extends LimitStore {
  /** How many entries it holds, expired ones not yet swept included. */
  size(): number;
}

/**
 * Whether an entry a write leaves is stored: one deleted, or written already
 * expired, is no entry and takes no room.
 */
function stays(
  entry: SerialisedLimit | null,
  now: number
): entry is SerialisedLimit {
  return entry !== null && entry.expiresAt > now;
}

/** How many more entries the store holds once `changes` are written. */
function entriesAdded(
  changes: ReadonlyMap<string, SerialisedLimit | null>,
  current: ReadonlyMap<string, StoredLimit>,
  now: number
): number {
  let added = 0;
  for (const [key, entry] of changes) {
    if (stays(entry, now) !== current.has(key)) {
      added += current.has(key) ? -1 : 1;
    }
  }
  return added;
}

/** Create a store in this process's memory. */
export function createMemoryLimitStore(
  options: MemoryLimitStoreOptions = {}
): MemoryLimitStore {
  const maxEntries =
    options.maxEntries ?? MEMORY_LIMIT_STORE_DEFAULT_MAX_ENTRIES;
  const clock = options.clock ?? Date.now;
  const watch = watchCapacity("memory", maxEntries, clock);
  const entries = new Map<string, SerialisedLimit>();

  /** The live entry for `key`, dropping it when it has expired. */
  const live = (key: string, now: number): SerialisedLimit | undefined => {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt > now) return entry;
    entries.delete(key);
    return undefined;
  };

  const liveEntries = (
    keys: readonly string[],
    now: number
  ): Map<string, StoredLimit> => {
    const found = new Map<string, StoredLimit>();
    for (const key of keys) {
      const entry = live(key, now);
      // Parsed afresh on every read, so a caller holding a value cannot
      // change what is stored.
      if (entry) {
        found.set(key, {
          value: JSON.parse(entry.json) as unknown,
          expiresAt: entry.expiresAt,
        });
      }
    }
    return found;
  };

  const sweepExpired = (now: number): number => {
    let removed = 0;
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) {
        entries.delete(key);
        removed += 1;
      }
    }
    // The watch judges its warning by the size left, whichever caller swept:
    // an update that refills the store past the threshold in one step would
    // otherwise find the warning still latched from before the sweep.
    if (removed > 0) watch.observe(entries.size);
    return removed;
  };

  /**
   * Make room for `added` new entries, removing expired ones first and never
   * a live one; when there is still none, refuse with the unavailable answer.
   */
  const makeRoom = (added: number, now: number): void => {
    if (added <= 0 || entries.size + added <= maxEntries) return;
    sweepExpired(now);
    if (entries.size + added <= maxEntries) return;
    watch.refused(entries.size);
    throw limitStoreUnavailable("full", {
      logContext: { store: "memory", maxEntries },
    });
  };

  return {
    shared: false,

    update(keys, apply) {
      // Run as one synchronous step, so no other update can interleave, and
      // inside a promise, so what it throws arrives as a rejection.
      return Promise.resolve().then(() => {
        const named = checkLimitKeys(keys);
        const now = clock();
        const current = liveEntries(named, now);
        const { write, result } = apply(current, now);
        const changes = serialiseLimitWrite(named, write);
        makeRoom(entriesAdded(changes, current, now), now);
        for (const [key, entry] of changes) {
          if (stays(entry, now)) entries.set(key, entry);
          else entries.delete(key);
        }
        watch.observe(entries.size);
        return result;
      });
    },

    read(keys) {
      return Promise.resolve().then(() =>
        liveEntries(checkLimitKeys(keys), clock())
      );
    },

    sweep() {
      return Promise.resolve(sweepExpired(clock()));
    },

    size() {
      return entries.size;
    },
  };
}
