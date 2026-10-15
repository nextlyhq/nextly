/**
 * A challenge flow's attempt budget, counted in the selected limit store.
 *
 * The budget bounds one interrupted sign-in, whose lifetime is fixed when it
 * is paused, so it is one count that lives as long as the flow: no rolling
 * window to keep. Counted in the store the site selected, so with the
 * database store every instance spends from one budget, and with the memory
 * store each instance from its own (the boot warning says so).
 *
 * @module auth/handlers/challenge-budget
 */
import type { LimitStore, StoredLimit } from "../../domains/limits/limit-store";

/** The attempts an entry holds; anything not written here holds none. */
function attemptsIn(entry: StoredLimit | undefined): number {
  const value = entry?.value as { attempts?: unknown } | undefined;
  return typeof value?.attempts === "number" &&
    Number.isSafeInteger(value.attempts) &&
    value.attempts > 0
    ? value.attempts
    : 0;
}

/** Spending from and reading a flow's budget in `store`. */
export function limitStoreChallengeBudget(store: LimitStore) {
  return {
    /**
     * Spend one attempt from the budget under `key`, unless `limit` are
     * spent already. The count is kept until `remainingMs` from now on the
     * store's clock: the rest of the flow's lifetime, past which every
     * answer is refused on the token's own lifetime.
     */
    spend(
      key: string,
      limit: number,
      remainingMs: number
    ): Promise<{ allowed: boolean }> {
      return store.update<{ allowed: boolean }>([key], (current, now) => {
        const entry = current.get(key);
        const spent = attemptsIn(entry);
        if (spent >= limit) {
          return { write: new Map(), result: { allowed: false } };
        }
        const expiresAt = Math.max(entry?.expiresAt ?? 0, now + remainingMs);
        return {
          write: new Map([
            [key, { value: { attempts: spent + 1 }, expiresAt }],
          ]),
          result: { allowed: true },
        };
      });
    },

    /** How many attempts the budget under `key` has spent, recording none. */
    async spent(key: string): Promise<number> {
      return attemptsIn((await store.read([key])).get(key));
    },
  };
}
