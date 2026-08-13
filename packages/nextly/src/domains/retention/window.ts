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
 * The largest offset whose cutoff a column counting from the UNIX epoch holds.
 *
 * A window is subtracted from now to form a cutoff, so the bound belongs to the
 * narrowest column that receives one — and the narrowest in this schema is
 * MySQL `TIMESTAMP`, which **starts at 1970**. A cutoff before then is rejected
 * under strict mode, so the pass fails on every run and is swallowed: the trail
 * goes unpruned while its configuration reads as accepted.
 *
 * Fifty years is the conservative form: any clock later than 2020 minus this
 * offset lands after 1970, so it holds without consulting the current time. It
 * is also past the point of meaning — a window longer than the epoch itself can
 * select nothing, because no row can be older than the time it measures from.
 *
 * `activity_log.created_at` is the only column in this family.
 */
export const EPOCH_COLUMN_MAX_OFFSET_MS = 50 * 365 * DAY_MS;

/**
 * The same bound for a column counting from a calendar year rather than 1970.
 *
 * MySQL `DATETIME` starts at year 1000, and both Postgres and SQLite reach
 * further back still, so the narrowest of those is what this expresses. A
 * thousand years keeps the cutoff at year 1020 or later for any clock after
 * 2020, which is inside `DATETIME` without consulting the current time.
 *
 * A bound is still needed here rather than none at all: `Number.MAX_SAFE_INTEGER`
 * milliseconds is roughly 285,000 years, past what `Date` itself represents, so
 * subtracting it yields `Invalid Date` and every comparison built from it is
 * meaningless.
 *
 * `audit_log`, `nextly_events` and `nextly_webhook_deliveries` are this family.
 */
export const CALENDAR_COLUMN_MAX_OFFSET_MS = 1000 * 365 * DAY_MS;

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
  /**
   * The longest window this trail can still express as a cutoff.
   *
   * Stated per caller because it is a property of the COLUMN the cutoff is
   * compared against, not of retention. Applying one trail's bound everywhere
   * silently disables pruning on trails whose columns reach further back: a
   * window of 51 years produces a cutoff of 1975, which `DATETIME` stores
   * without complaint, and refusing it there converts a configured window into
   * unbounded growth. Pass {@link EPOCH_COLUMN_MAX_OFFSET_MS} or
   * {@link CALENDAR_COLUMN_MAX_OFFSET_MS} according to the narrowest column the
   * window reaches.
   */
  maxOffsetMs: number;
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
 * Flooring happens BEFORE the zero reading rather than after, because rounding
 * is what can PRODUCE a zero: every window under a millisecond floors to one,
 * and read afterwards it arrives as a window rather than as the zero the policy
 * exists to judge. On a trail whose policy calls zero malformed, that is the
 * difference between the default and a cutoff of now — the whole record
 * removed, from a value that never asked for it.
 */
export function resolveRetentionWindow(
  value: unknown,
  policy: RetentionWindowPolicy
): RetentionWindow {
  if (value === false) return false;
  if (typeof value !== "number" || Number.isNaN(value)) return policy.fallback;
  // `Infinity` is not special-cased: it is greater than every finite bound, so
  // it lands here alongside any other over-long window and is answered the same
  // way. Separating the two is how the shipped copies came to treat the more
  // extreme request as the less valid one.
  if (value > policy.maxOffsetMs) return false;
  // Ahead of the flooring, because `Math.floor` moves a negative value AWAY
  // from zero and a fraction like -0.5 would arrive as -1 rather than as the
  // incoherent value it is.
  if (value < 0) return policy.fallback;
  const whole = Math.floor(value);
  if (whole === 0) return policy.zero === "keep-nothing" ? 0 : policy.fallback;
  return whole;
}
