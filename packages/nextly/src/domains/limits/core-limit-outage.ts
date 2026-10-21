/**
 * What core's own limits do while the store they count in cannot answer.
 *
 * A limit sits in front of the work it guards, so a store outage has to
 * decide something, and the two kinds of limit decide differently:
 *
 * - **Sign-in** (core's auth endpoints, and plugin routes on the auth budget)
 *   refuses with an answer to try again shortly. Admitting there would let
 *   password guessing run uncounted for as long as the store is away.
 * - **The general API** (REST, plugin routes on the general or their own
 *   budget, API keys) lets requests through. Refusing there would take the
 *   whole site down with its limit store.
 *
 * The outage is logged once when it begins and once when the store answers
 * again, not on every request it touches.
 *
 * @module domains/limits/core-limit-outage
 */
import { NextlyError } from "../../errors/nextly-error";
import type {
  RateLimitRecord,
  RateLimitStore,
} from "../../middleware/rate-limit";
import { getNextlyLogger } from "../../observability/logger";

import { limitStoreUnavailableReason } from "./limit-store";

/** Whether `error` is a store's unavailable answer. */
export function isLimitStoreDown(error: unknown): boolean {
  return limitStoreUnavailableReason(error) !== undefined;
}

/**
 * The same store, logging once when its calls start being answered as
 * unavailable and once when one is answered again.
 */
export function watchCoreLimitOutage(store: RateLimitStore): RateLimitStore {
  let down = false;
  const watched = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      const answer = await call();
      if (down) {
        down = false;
        getNextlyLogger().info({
          kind: "core-limit-store-recovered",
          message:
            "[nextly] The rate limit store is answering again: sign-in and API limits count as usual.",
        });
      }
      return answer;
    } catch (error) {
      if (isLimitStoreDown(error) && !down) {
        down = true;
        getNextlyLogger().error({
          kind: "core-limit-store-unavailable",
          reason: limitStoreUnavailableReason(error),
          message:
            "[nextly] The rate limit store is not answering: sign-in requests are refused with an answer to try again shortly, and API requests are let through uncounted, until it answers again.",
        });
      }
      throw error;
    }
  };
  // Bound, so it is called on its own store as the store wrote it.
  const consume = store.consume?.bind(store);
  return {
    increment: (key, windowMs) => watched(() => store.increment(key, windowMs)),
    reset: key => watched(() => store.reset(key)),
    ...(consume === undefined
      ? {}
      : {
          consume: (key: string, limit: number, windowMs: number) =>
            watched(() => consume(key, limit, windowMs)),
        }),
  };
}

/**
 * The refusal a sign-in limit gives while its store is away: try again
 * shortly, the same answer the second-factor budget gives.
 */
export function signInLimitUnavailable(cause: unknown): NextlyError {
  return NextlyError.serviceUnavailable({
    publicMessage: "Please try again shortly.",
    ...(cause instanceof Error ? { cause } : {}),
    logContext: { reason: "sign-in-limit-store-unavailable" },
  });
}

/**
 * The same store for a general limit: while the store is away, every call is
 * answered as the first of a fresh window, so the request is let through.
 * Any other failure reaches the caller as it is.
 */
export function openWhileStoreIsDown(store: RateLimitStore): RateLimitStore {
  const fresh = (windowMs: number): RateLimitRecord => ({
    count: 0,
    resetTime: Date.now() + windowMs,
  });
  const open = async <T>(call: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      if (isLimitStoreDown(error)) return fallback;
      throw error;
    }
  };
  // Bound, so it is called on its own store as the store wrote it.
  const consume = store.consume?.bind(store);
  return {
    increment: (key, windowMs) =>
      open(() => store.increment(key, windowMs), fresh(windowMs)),
    reset: key => open(() => store.reset(key), undefined),
    ...(consume === undefined
      ? {}
      : {
          consume: (key: string, limit: number, windowMs: number) =>
            open(() => consume(key, limit, windowMs), {
              ...fresh(windowMs),
              allowed: limit > 0,
            }),
        }),
  };
}
