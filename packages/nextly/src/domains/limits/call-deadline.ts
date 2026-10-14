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
 * The same store, its every call answered within `timeoutMs`, and its own
 * failures answered as unavailable. What a caller's `apply` throws reaches the
 * caller unchanged.
 */
export function withCallDeadline(
  store: LimitStore,
  timeoutMs: number = LIMIT_STORE_CALL_TIMEOUT_MS
): LimitStore {
  /**
   * `call`'s answer, or the unavailable answer once `timeoutMs` has passed
   * without one. A store's own failure is answered as unavailable; the
   * caller's `apply` failing, and a programming error, as they are.
   */
  const answer = async <T>(
    call: () => Promise<T>,
    applyFailure: { failed?: { error: unknown } } = {}
  ): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(limitStoreUnavailable("timeout", { logContext: { timeoutMs } }));
      }, timeoutMs);
    });
    const pending = Promise.resolve().then(call);
    // A call that fails after its deadline has nobody waiting for it.
    pending.catch(() => undefined);
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
