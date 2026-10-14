/**
 * Holding every limit store call to a time.
 *
 * A limit sits in front of the work it guards, so a store that stops
 * answering would hold every request it guards for as long. Each call is
 * answered within {@link LIMIT_STORE_CALL_TIMEOUT_MS}: when the store has not
 * answered by then, the call is answered as unavailable, as when the store
 * cannot be reached, and the limit built on it decides what that means. A
 * store's own failures are answered the same way.
 *
 * @module domains/limits/call-deadline
 */
import { NextlyError } from "../../errors/nextly-error";

import {
  limitStoreUnavailable,
  limitStoreUnavailableReason,
  type LimitStore,
} from "./limit-store";

/** How long a limit store call may take before it is answered as unavailable. */
export const LIMIT_STORE_CALL_TIMEOUT_MS = 2000;

/**
 * How many calls may be under way in the store at once, those already
 * answered as timed out included. A call past its deadline still runs in the
 * store, holding a connection and perhaps locks, so a store that has stopped
 * answering would otherwise gather unbounded work behind it. Past this many,
 * a call is answered as unavailable at once, and starts nothing.
 */
export const LIMIT_STORE_MAX_IN_FLIGHT = 64;

/**
 * The same store, its every call answered within `timeoutMs`, and its own
 * failures answered as unavailable. What a caller's `apply` throws reaches the
 * caller unchanged.
 */
export function withCallDeadline(
  store: LimitStore,
  timeoutMs: number = LIMIT_STORE_CALL_TIMEOUT_MS,
  maxInFlight: number = LIMIT_STORE_MAX_IN_FLIGHT
): LimitStore {
  /** Calls the store has not yet settled, answered or not. */
  let inFlight = 0;
  /**
   * `call`'s answer, or the unavailable answer once `timeoutMs` has passed
   * without one. A store's own failure is answered as unavailable; the
   * caller's `apply` failing, and a programming error, as they are.
   */
  const answer = async <T>(
    call: () => Promise<T>,
    applyFailure: { failed?: { error: unknown } } = {}
  ): Promise<T> => {
    if (inFlight >= maxInFlight) {
      throw limitStoreUnavailable("timeout", { logContext: { inFlight } });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(limitStoreUnavailable("timeout", { logContext: { timeoutMs } }));
      }, timeoutMs);
    });
    inFlight += 1;
    const pending = Promise.resolve().then(call);
    // Counted until the store settles it, not until its caller is answered.
    // A call that fails after its deadline has nobody waiting for it.
    pending.then(
      () => (inFlight -= 1),
      () => (inFlight -= 1)
    );
    try {
      return await Promise.race([pending, deadline]);
    } catch (error) {
      if (applyFailure.failed) throw applyFailure.failed.error;
      if (
        limitStoreUnavailableReason(error) !== undefined ||
        NextlyError.isCode(error, "INTERNAL_ERROR")
      ) {
        throw error;
      }
      throw limitStoreUnavailable("unreachable", { cause: error });
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    get shared() {
      return store.shared;
    },
    update(keys, apply) {
      const applyFailure: { failed?: { error: unknown } } = {};
      return answer(
        () =>
          store.update(keys, (current, now) => {
            try {
              return apply(current, now);
            } catch (error) {
              applyFailure.failed = { error };
              throw error;
            }
          }),
        applyFailure
      );
    },
    read(keys) {
      return answer(() => store.read(keys));
    },
    sweep() {
      return answer(() => store.sweep());
    },
  };
}
