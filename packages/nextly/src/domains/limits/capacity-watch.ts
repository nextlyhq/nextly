/**
 * Telling an operator that a limit store is filling, before and once it is
 * full.
 *
 * A full store answers new keys as unavailable, which stops sign-in for every
 * visitor it has not seen yet, so the warning has to come first, while there
 * is still room. Both are logged sparingly: under an attack that fills the
 * store, a line per refused request would bury everything else in the log.
 *
 * @module domains/limits/capacity-watch
 */
import { getNextlyLogger } from "../../observability/logger";

/** The share of the bound at which the store warns that it is filling. */
export const CAPACITY_WARNING_SHARE = 0.8;

/** The share it must fall back under before it warns again. */
const CAPACITY_RECOVERED_SHARE = 0.7;

/** The least time between two log lines about refusals for want of room. */
const FULL_LOG_INTERVAL_MS = 60_000;

/** What a store reports to its watch. */
export interface CapacityWatch {
  /** The store holds `live` live entries now. */
  observe(live: number): void;
  /** The store refused a new entry for want of room. */
  refused(live: number): void;
}

/**
 * Watch one store's live entries against its bound.
 *
 * @param store - The store's name in the log, `"memory"` or `"database"`
 * @param maxEntries - The store's bound
 * @param clock - Milliseconds now, for spacing the refusal log
 */
export function watchCapacity(
  store: string,
  maxEntries: number,
  clock: () => number = Date.now
): CapacityWatch {
  let warned = false;
  let lastFullLog: number | undefined;
  let refusedSinceLog = 0;
  return {
    observe(live) {
      if (!warned && live >= maxEntries * CAPACITY_WARNING_SHARE) {
        warned = true;
        getNextlyLogger().warn({
          kind: "limit-store-filling",
          message: `The ${store} limit store holds ${live} of at most ${maxEntries} live entries. Once full, it answers new keys as unavailable.`,
          store,
          live,
          maxEntries,
        });
      } else if (warned && live < maxEntries * CAPACITY_RECOVERED_SHARE) {
        warned = false;
      }
    },
    refused(live) {
      refusedSinceLog += 1;
      const now = clock();
      if (
        lastFullLog !== undefined &&
        now - lastFullLog < FULL_LOG_INTERVAL_MS
      ) {
        return;
      }
      lastFullLog = now;
      getNextlyLogger().error({
        kind: "limit-store-full",
        message: `The ${store} limit store is full: ${live} live entries, at most ${maxEntries}. New keys are answered as unavailable until entries expire.`,
        store,
        live,
        maxEntries,
        refused: refusedSinceLog,
      });
      refusedSinceLog = 0;
    },
  };
}
