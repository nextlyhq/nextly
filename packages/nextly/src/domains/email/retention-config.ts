/**
 * Email domain — delivery-log retention policy resolution.
 *
 * Recording is unconditional: every send appends one row per recipient, whether
 * or not anyone will ever read them. Without a retention policy that table grows
 * for the life of the install, which the schema says in as many words — the
 * `retention_class` column and the `(retention_class, created_at)` index were
 * added for this pass and have been inert since.
 *
 * It also bounds two things erasure provably cannot reach: rows whose digest was
 * written under a previous `NEXTLY_SECRET`, and rows written by an older writer
 * that hashed a display-name address. Neither can be recomputed from an address,
 * so ageing them out is the only mechanism that removes them at all.
 *
 * Resolution is pure and total — it never throws, and it clamps rather than
 * rejects, so a malformed value degrades to something safe instead of failing a
 * boot. Mirrors `domains/audit/retention-config.ts` and
 * `domains/webhooks/retention-config.ts`.
 *
 * @module domains/email/retention-config
 */

/**
 * A retention window, or `false` to keep rows indefinitely.
 *
 * `false` is a position an operator can hold deliberately — a delivery log is
 * evidence that a message was sent, and some installs need that for longer than
 * any default should decide.
 */
export type EmailMaxAge = number | false;

/** What an install may configure. */
export interface EmailRetentionConfig {
  /** How long a delivery row is kept. `false` keeps it forever. */
  maxAgeMs?: EmailMaxAge;
  /** Shortest time between two passes. */
  intervalMs?: number;
  /** Batches deleted per run, so one pass cannot monopolise a write path. */
  maxBatchesPerRun?: number;
}

export interface ResolvedEmailRetentionConfig {
  maxAgeMs: EmailMaxAge;
  intervalMs: number;
  maxBatchesPerRun: number;
}

/**
 * Ninety days.
 *
 * Chosen to answer the operational question the log exists for — "did this
 * person get their password reset last week, and did it bounce" — and little
 * beyond it. Long enough to survive a support cycle and a monthly review, short
 * enough that an install sending at volume does not accumulate a permanent
 * record of who was written to.
 */
const DEFAULT_EMAIL_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Six hours. A delivery log does not need pruning more often than a shift. */
const DEFAULT_EMAIL_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Bounded so one pass cannot monopolise the write path that offered it. */
const DEFAULT_EMAIL_MAX_BATCHES_PER_RUN = 10;

/**
 * The largest offset that still lands inside the Date range when subtracted
 * from now. A window beyond it makes the cutoff unrepresentable.
 */
const MAX_STORABLE_OFFSET_MS = 8.64e15;

/**
 * A window, or `false`.
 *
 * An out-of-range value degrades to `false` — keep everything — rather than to
 * the default, and the direction is the whole point: the default is SHORTER, so
 * substituting it would DELETE rows the configuration asked to retain.
 * Rejecting a value must never be more destructive than honouring it.
 */
function maxAge(value: EmailMaxAge | undefined, fallback: number): EmailMaxAge {
  if (value === false) return false;
  if (value === undefined) return fallback;
  const window = value;
  // NaN is not a window at all, and zero or negative asks to delete everything
  // immediately — for those the default is the conservative reading.
  if (Number.isNaN(window) || window <= 0) return fallback;
  // Infinity and anything past the Date range are the SAME request: keep rows
  // longer than a cutoff can express. Both become `false`, never the default,
  // because the default is shorter and would delete what was asked to be kept.
  return window <= MAX_STORABLE_OFFSET_MS ? window : false;
}

/**
 * A positive, representable duration.
 *
 * Bounded for the same reason a window is: the gate subtracts the interval from
 * now to decide whether a pass is due, so a value that leaves the Date range
 * makes that comparison unanswerable and no pass ever runs again.
 */
function positive(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Number.isFinite(value) && value > 0 && value <= MAX_STORABLE_OFFSET_MS
    ? value
    : fallback;
}

/** A batch count, which must be a whole number of batches. */
function wholePositive(value: number | undefined, fallback: number): number {
  return Math.floor(positive(value, fallback)) || fallback;
}

/**
 * Resolve the configured window, filling in the defaults.
 *
 * `false` for the whole block keeps everything rather than falling back to the
 * defaults, so an operator who has decided to retain indefinitely does.
 */
export function resolveEmailRetentionConfig(
  input?: EmailRetentionConfig | false
): ResolvedEmailRetentionConfig {
  if (input === false) {
    return {
      maxAgeMs: false,
      intervalMs: DEFAULT_EMAIL_RETENTION_INTERVAL_MS,
      maxBatchesPerRun: DEFAULT_EMAIL_MAX_BATCHES_PER_RUN,
    };
  }

  return {
    maxAgeMs: maxAge(input?.maxAgeMs, DEFAULT_EMAIL_MAX_AGE_MS),
    intervalMs: positive(
      input?.intervalMs,
      DEFAULT_EMAIL_RETENTION_INTERVAL_MS
    ),
    maxBatchesPerRun: wholePositive(
      input?.maxBatchesPerRun,
      DEFAULT_EMAIL_MAX_BATCHES_PER_RUN
    ),
  };
}

/**
 * The policy a hot reload published, if any.
 *
 * Runners capture their policy when they are built, and a runner built at boot
 * outlives every hot reload — so a window saved in dev would otherwise keep
 * pruning on the previous value until restart, including a change to `false`,
 * where the stale window goes on deleting rows the operator has just asked to
 * keep. Passes read through {@link activeEmailRetention} so a save takes effect
 * immediately, mirroring the audit and webhook policies.
 */
let publishedEmailRetention: ResolvedEmailRetentionConfig | undefined;

/**
 * Publish a reloaded policy. `undefined` restores whatever was built in.
 *
 * Cleared alongside the other process-global registries when the container is
 * torn down: a value left behind would be preferred over the built-in policy of
 * whatever configuration initialises next, so a short window from a previous app
 * could go on deleting rows in one that configured retention off.
 */
export function setEmailRetention(
  policy: ResolvedEmailRetentionConfig | undefined
): void {
  publishedEmailRetention = policy;
}

/** The policy a pass should run with: the reloaded one, else the built-in. */
export function activeEmailRetention(
  built: ResolvedEmailRetentionConfig | undefined
): ResolvedEmailRetentionConfig | undefined {
  return publishedEmailRetention ?? built;
}
