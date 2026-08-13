/**
 * How a configured retention window is read, for every trail that has one.
 *
 * One question with one implementation. The two trails that resolve a window —
 * audit and webhooks — did it separately and had drifted into different answers
 * for the same input, which is the failure mode a shared question always has
 * when it is answered in more than one place.
 *
 * The invariant every caller depends on, and the one the copies disagreed on:
 *
 *   **Rejecting a value must never delete more than honouring it would.**
 *
 * A window that cannot be used is replaced by a fallback, and every fallback
 * here is a finite window that DELETES. So the direction of each rejection has
 * to be chosen, not defaulted: substituting the default for a value that asked
 * to keep MORE turns a malformed setting into data loss, silently, on a
 * schedule. `Infinity` is exactly that value, and both copies rejected it into
 * a default that deleted after 90 and 30 days respectively.
 *
 * A third trail is expected to ask this question — the delivery log records one
 * row per recipient and has no window of its own yet — and the reason it is
 * named here is the policy parameters below, which exist so a caller can differ
 * where the difference is real without forking the invariant.
 *
 * @module domains/retention/window
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A window in milliseconds, or `false` to keep rows indefinitely. */
export type RetentionWindow = number | false;

/**
 * The largest offset whose resulting date every supported column can store.
 *
 * A window is subtracted from now to form a cutoff, so the bound is set by the
 * narrowest column that receives one. That is not `Date` (±8.64e15 ms) and not
 * MySQL `DATETIME` (from year 1000): it is MySQL `TIMESTAMP`, which
 * `activity_log.created_at` uses and which **starts at 1970**. A cutoff before
 * then is rejected under strict mode, so the pass fails on every run and is
 * swallowed — the trail unpruned while its configuration reads as accepted.
 *
 * Fifty years is the conservative form: any clock later than 2020 minus this
 * offset lands after 1970, so it holds without consulting the current time. It
 * is also past the point of meaning — a window longer than the epoch itself can
 * select nothing, because no row can be older than the time it measures from.
 */
export const MAX_STORABLE_OFFSET_MS = 50 * 365 * DAY_MS;

/**
 * What a window of exactly zero means to a trail.
 *
 * The two shipped resolvers disagreed, and both readings are defensible, so it
 * stays the caller's decision rather than being unified into whichever one was
 * written second. A delivery ledger may reasonably be configured to keep
 * nothing — the row's purpose is a retry window, and an operator who does not
 * want the addresses stored at all is expressing a real position. An audit
 * trail configured to zero is far more likely to be a mistake, and erasing the
 * record of who did what on a typo is not a recoverable outcome.
 */
export type ZeroWindow = "keep-nothing" | "malformed";

export interface RetentionWindowPolicy {
  /** Used when the value is absent or unusable. */
  fallback: RetentionWindow;
  /** How to read a window of exactly zero. */
  zero: ZeroWindow;
}

/**
 * Resolve one configured window. Pure, total, and never throws.
 *
 * Each branch is a decision about DIRECTION rather than about validity:
 *
 * - `false` is a position an operator holds deliberately, so it is honoured.
 * - A window past what a cutoff can express — `Infinity` included — is a request
 *   to keep more than the range allows, so it degrades to `false`. Falling back
 *   would delete rows the configuration asked to retain, and `Infinity` is the
 *   case where that reads worst: the operator wrote the strongest available
 *   spelling of "keep forever" and got a 90-day delete.
 * - `NaN`, a non-number and a negative window say nothing coherent about how
 *   long to keep rows, so the fallback applies. That direction is safe here
 *   because none of them asked for MORE retention than the default gives.
 *
 * Floored because a window is a whole number of milliseconds; a fractional
 * value is not wrong, only unrepresentable in what it is compared against.
 */
export function resolveRetentionWindow(
  value: unknown,
  policy: RetentionWindowPolicy
): RetentionWindow {
  if (value === false) return false;
  if (typeof value !== "number" || Number.isNaN(value)) return policy.fallback;
  // Ordered before the range check on purpose: `Infinity > MAX` is true, so
  // both land here together and are answered the same way. Separating them is
  // how the shipped copies came to treat the more extreme request as the less
  // valid one.
  if (value > MAX_STORABLE_OFFSET_MS) return false;
  if (value === 0) return policy.zero === "keep-nothing" ? 0 : policy.fallback;
  if (value < 0) return policy.fallback;
  return Math.floor(value);
}
