/**
 * Core's own limits on the limit store the site selected.
 *
 * Core's limiters (sign-in, plugin routes, the REST API, API keys) speak the
 * older {@link RateLimitStore} contract: count a key within a window, or
 * record an attempt only while it stays within a limit. This adapts the
 * selected {@link LimitStore} to it, so the same limiters count in memory, in
 * the database every instance shares, or in an app's own store, as
 * `rateLimit.store` selects.
 *
 * - **Keys are stored only as keyed hashes.** Core's keys hold client
 *   addresses, account ids and API key ids; none reaches the store as given.
 * - **Counts roll.** An attempt counts for one window from when it was made,
 *   kept in up to {@link BUCKETS} buckets per key so an entry stays small
 *   however many attempts the window holds. An attempt is forgotten at most
 *   one bucket (1/32 of the window) early.
 * - **An entry lapses by the end of its newest attempt's window**, on the
 *   store's own clock.
 *
 * @module domains/limits/core-limit-store
 */
import { createHmac } from "node:crypto";

import type {
  RateLimitRecord,
  RateLimitStore,
} from "../../middleware/rate-limit";

import type { LimitStore, StoredLimit } from "./limit-store";

/** How many buckets a window is counted in. */
const BUCKETS = 32;

/** What one key's entry holds: `[bucket start, attempts]`, oldest first. */
interface CoreLimitValue {
  buckets: [number, number][];
}

/** The buckets of `entry` still inside the window ending at `now`. */
function liveBuckets(
  entry: StoredLimit | undefined,
  now: number,
  windowMs: number
): [number, number][] {
  const value = entry?.value as Partial<CoreLimitValue> | undefined;
  if (!Array.isArray(value?.buckets)) return [];
  return value.buckets.filter(
    (bucket): bucket is [number, number] =>
      Array.isArray(bucket) &&
      typeof bucket[0] === "number" &&
      typeof bucket[1] === "number" &&
      bucket[0] > now - windowMs
  );
}

/** The record the old contract answers with, for these live buckets. */
function recordOf(
  buckets: readonly [number, number][],
  now: number,
  windowMs: number
): RateLimitRecord {
  const count = buckets.reduce((total, [, attempts]) => total + attempts, 0);
  // When the oldest attempt still counted ages out; a new window if none is.
  const resetTime = (buckets[0]?.[0] ?? now) + windowMs;
  return { count, resetTime };
}

/** The buckets with one more attempt at `now`, in the bucket `now` falls in. */
function withAttempt(
  buckets: readonly [number, number][],
  now: number,
  windowMs: number
): [number, number][] {
  const width = Math.max(1, Math.ceil(windowMs / BUCKETS));
  const start = now - (now % width);
  const last = buckets.at(-1);
  if (last !== undefined && last[0] === start) {
    return [...buckets.slice(0, -1), [start, last[1] + 1]];
  }
  return [...buckets, [start, 1]];
}

/** The entry holding `buckets`, lapsing when its newest one does. */
function entryOf(
  buckets: [number, number][],
  windowMs: number
): StoredLimit | null {
  const newest = buckets.at(-1);
  if (newest === undefined) return null;
  return { value: { buckets }, expiresAt: newest[0] + windowMs };
}

/**
 * The old store contract over the selected limit store.
 *
 * @param store - The store `rateLimit.store` selected.
 * @param secret - The install's secret, from which the key hash is derived.
 */
export function coreLimitStore(
  store: LimitStore,
  secret: string | undefined
): RateLimitStore {
  // Derived for this use alone, so a key's hash here matches no other value
  // derived from the install's secret.
  const keyHashKey = createHmac("sha256", secret ?? "")
    .update("nextly core limit keys")
    .digest();
  const storeKey = (key: string): string =>
    `core:${createHmac("sha256", keyHashKey).update(key, "utf8").digest("base64url")}`;

  return {
    increment(key: string, windowMs: number): Promise<RateLimitRecord> {
      const stored = storeKey(key);
      return store.update([stored], (current, now) => {
        const buckets = withAttempt(
          liveBuckets(current.get(stored), now, windowMs),
          now,
          windowMs
        );
        return {
          write: new Map([[stored, entryOf(buckets, windowMs)]]),
          result: recordOf(buckets, now, windowMs),
        };
      });
    },

    consume(
      key: string,
      limit: number,
      windowMs: number
    ): Promise<RateLimitRecord & { allowed: boolean }> {
      const stored = storeKey(key);
      return store.update([stored], (current, now) => {
        const live = liveBuckets(current.get(stored), now, windowMs);
        const held = recordOf(live, now, windowMs);
        // A limit of zero records nothing, so a peek never counts.
        if (held.count >= limit) {
          return { write: new Map(), result: { ...held, allowed: false } };
        }
        const buckets = withAttempt(live, now, windowMs);
        return {
          write: new Map([[stored, entryOf(buckets, windowMs)]]),
          result: { ...recordOf(buckets, now, windowMs), allowed: true },
        };
      });
    },

    async reset(key: string): Promise<void> {
      const stored = storeKey(key);
      await store.update([stored], () => ({
        write: new Map([[stored, null]]),
        result: undefined,
      }));
    },
  };
}
