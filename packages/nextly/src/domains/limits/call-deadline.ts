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
import type { RateLimitStore } from "../../middleware/rate-limit";

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
 * How many deadlines after it began a call still unsettled stops holding a
 * place under {@link LIMIT_STORE_MAX_IN_FLIGHT}. The bound on work gathered
 * behind a store that stopped answering holds (at most that many calls per
 * this many deadlines), and once the store answers again, calls reach it.
 */
const ABANDON_AFTER_TIMEOUTS = 10;

/**
 * The calls under way in the store, as a multiple of the in-flight cap,
 * abandoned ones included, past which only one recovery call at a time
 * starts. An abandoned call may still be running in the store, holding a
 * connection or a lock, so while calls past their deadline stop holding a
 * place under the cap, they never stop counting here.
 *
 * With calls that never settle, a strict bound and a guaranteed way back
 * cannot both hold: refusing every call past this cap would leave a store
 * that answers again never asked, if the calls that filled it never settle.
 * So past it, one call at a time is let through, and a new one only once the
 * last has settled or been abandoned: the work behind a store that never
 * answers grows by at most one call per abandon window
 * ({@link ABANDON_AFTER_TIMEOUTS} deadlines), and the first call a recovered
 * store answers starts letting calls through again.
 */
export const LIMIT_STORE_HARD_CAP_MULTIPLE = 4;

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
  const answer = deadlineAnswer(timeoutMs, maxInFlight);

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

/**
 * An app's store of the older contract, held to the same time and answered as
 * unavailable on its own failures, as {@link withCallDeadline} holds a limit
 * store: core's own limits count in it, and decide alike whichever store
 * failed.
 */
export function withRateLimitStoreDeadline(
  store: RateLimitStore,
  timeoutMs: number = LIMIT_STORE_CALL_TIMEOUT_MS,
  maxInFlight: number = LIMIT_STORE_MAX_IN_FLIGHT
): RateLimitStore {
  const answer = deadlineAnswer(timeoutMs, maxInFlight);
  // Bound, so it is called on its own store as the store wrote it.
  const consume = store.consume?.bind(store);
  return {
    increment: (key, windowMs) => answer(() => store.increment(key, windowMs)),
    reset: key => answer(() => store.reset(key)),
    ...(consume === undefined
      ? {}
      : {
          consume: (key: string, limit: number, windowMs: number) =>
            answer(() => consume(key, limit, windowMs)),
        }),
  };
}

/**
 * The one way a store call is answered within `timeoutMs`, shared by both
 * store contracts. What `call` resolves to, or the unavailable answer: on the
 * deadline, past `maxInFlight` calls under way, or on the store's own
 * failure. A failure `applyFailure` records, and a programming error, reach
 * the caller as they are.
 */
function deadlineAnswer(
  timeoutMs: number,
  maxInFlight: number
): <T>(
  call: () => Promise<T>,
  applyFailure?: { failed?: { error: unknown } }
) => Promise<T> {
  /**
   * Calls the store has not yet settled, answered or not, by when each began.
   * A call still unsettled `ABANDON_AFTER_TIMEOUTS` deadlines after it began
   * is taken as abandoned and holds no place: calls that never settle would
   * otherwise fill every place for good, and a store that answers again
   * would never be asked.
   */
  const running = new Map<symbol, number>();
  const abandonAfterMs = timeoutMs * ABANDON_AFTER_TIMEOUTS;
  /** Every call the store has not settled, abandoned or not. */
  let unsettled = 0;
  const hardCap = maxInFlight * LIMIT_STORE_HARD_CAP_MULTIPLE;
  /** The one recovery call let past the hard cap, while it is unsettled. */
  let probe: { call: symbol; began: number } | undefined;
  /** The calls still holding a place, dropping the abandoned ones. */
  const held = (): number => {
    const now = Date.now();
    for (const [call, began] of running) {
      if (now - began >= abandonAfterMs) running.delete(call);
    }
    return running.size;
  };
  /**
   * Starts a call's count, or refuses it as unavailable: past `maxInFlight`
   * calls holding a place, or past the hard cap while an earlier recovery
   * call is still unsettled and within its abandon window.
   */
  const begin = (): symbol => {
    const inFlight = held();
    const now = Date.now();
    const pastHardCap = unsettled >= hardCap;
    if (
      inFlight >= maxInFlight ||
      (pastHardCap && probe !== undefined && now - probe.began < abandonAfterMs)
    ) {
      throw limitStoreUnavailable("timeout", {
        logContext: { inFlight, unsettled },
      });
    }
    const id = Symbol("limit store call");
    running.set(id, now);
    unsettled += 1;
    if (pastHardCap) probe = { call: id, began: now };
    return id;
  };
  /**
   * Ends a call's count once the store settles it, not once its caller is
   * answered or it is abandoned. A call that fails after its deadline has
   * nobody waiting for it.
   */
  const settle = (id: symbol): void => {
    running.delete(id);
    unsettled -= 1;
    if (probe?.call === id) probe = undefined;
  };
  /**
   * `call`'s answer, or the unavailable answer once `timeoutMs` has passed
   * without one. A store's own failure is answered as unavailable; the
   * caller's `apply` failing, and a programming error, as they are.
   */
  const answer = async <T>(
    call: () => Promise<T>,
    applyFailure: { failed?: { error: unknown } } = {}
  ): Promise<T> => {
    const id = begin();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(limitStoreUnavailable("timeout", { logContext: { timeoutMs } }));
      }, timeoutMs);
    });
    const pending = Promise.resolve().then(call);
    const settled = () => settle(id);
    pending.then(settled, settled);
    try {
      return await Promise.race([pending, deadline]);
    } catch (error) {
      throw failureAnswer(error, applyFailure);
    } finally {
      clearTimeout(timer);
    }
  };
  return answer;
}

/**
 * What a failed call is answered with: the caller's `apply` failure, an
 * unavailable answer, or a programming error as it is; any other failure is
 * the store's own, answered as unreachable.
 */
function failureAnswer(
  error: unknown,
  applyFailure: { failed?: { error: unknown } }
): unknown {
  if (applyFailure.failed) return applyFailure.failed.error;
  if (
    limitStoreUnavailableReason(error) !== undefined ||
    NextlyError.isCode(error, "INTERNAL_ERROR")
  ) {
    return error;
  }
  return limitStoreUnavailable("unreachable", { cause: error });
}
