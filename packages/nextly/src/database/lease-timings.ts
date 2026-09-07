/**
 * The timings a lease is held on, derived from one number.
 *
 * Separate from `lease-clock` on purpose, and the separation is load-bearing rather than tidiness.
 * These are plain arithmetic over plain numbers, and both a server holding a lease and a BROWSER
 * renewing one need them. `lease-clock` asks the database what time it is, so it imports the ORM at
 * module top level; anything importing these timings through it drags that ORM into whatever bundle
 * it lands in. Nothing in this module imports anything, so a client entry can re-export it and stay
 * a client entry.
 *
 * @module database/lease-timings
 */

/** Every timing a lease needs, so a caller cannot hold two of them that disagree. */
export interface LeaseTimings {
  /** How long a confirmation grants. */
  readonly ttlSeconds: number;
  /** How often the holder confirms. */
  readonly renewIntervalMs: number;
  /**
   * How long the holder may go without a CONFIRMED renewal before it must treat the claim as lost.
   *
   * 🔴 Deliberately not "how many renewals failed". A count is only a proxy for the question that
   * decides safety — how much lease is left — and it goes wrong in both directions: retries can
   * overlap, so a stale failure is counted against a lease a later success already extended; and
   * the count reaches its limit at the moment the lease expires rather than before it, so the
   * holder is told after it has stopped being protected rather than while it still is.
   */
  readonly lossAfterMs: number;
  /**
   * How much lease a confirmation must actually grant for the holder to rely on it.
   *
   * 🔴 "Not yet expired" is not the same as "safe to work on". A holder that accepts a renewal
   * leaving almost nothing comes back to a claim that passes a liveness test with nothing left.
   */
  readonly renewMarginSeconds: number;
}

/**
 * Derive every lease timing from the TTL, so no two of them can be chosen independently.
 *
 * 🔴 The derivation is the point. Two numbers picked side by side agree on the day they are written
 * and drift afterwards, silently, because each looks reasonable alone — and the drift here is a
 * holder that believes it is protected while a contender is already taking the row.
 *
 * `renewDivisor` is how many renewals fit in one TTL, and it is the only free parameter. The loss
 * deadline then leaves TWO renewal intervals of lease still in hand, so a holder is told it is
 * losing the claim while it is still protected rather than after.
 */
export function deriveLeaseTimings(
  ttlSeconds: number,
  renewDivisor: number
): LeaseTimings {
  const renewIntervalMs = (ttlSeconds / renewDivisor) * 1000;
  const lossAfterMs = ttlSeconds * 1000 - 2 * renewIntervalMs;
  return {
    ttlSeconds,
    renewIntervalMs,
    lossAfterMs,
    renewMarginSeconds: lossAfterMs / 1000,
  };
}
