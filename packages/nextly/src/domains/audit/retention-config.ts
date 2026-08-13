/**
 * How long the two audit trails are kept.
 *
 * Separate from webhook retention on purpose. The webhook windows bound a
 * delivery ledger and are chosen from how long a redelivery stays useful; these
 * bound a record of who did what, and are chosen from how long that is worth
 * answering questions with. Putting them under one key would also put an
 * operator's activity-retention setting somewhere no operator would look.
 *
 * @module domains/audit/retention-config
 * @since 1.0.0
 */

import {
  MAX_STORABLE_OFFSET_MS,
  resolveRetentionWindow,
} from "../retention/window";

/** `false` means keep forever and accept the growth. */
type MaxAge = number | false;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Content activity: 90 days.
 *
 * The number `activity_log`'s own schema comment has claimed since it was
 * introduced, made true. It is also what both self-hosted CMS comparables ship
 * — Directus and Strapi each default activity retention to 90 days.
 */
export const DEFAULT_ACTIVITY_MAX_AGE_MS = 90 * DAY_MS;

/**
 * Auth and security events: 180 days.
 *
 * Longer because the questions asked of it are asked later: an account
 * compromise is usually noticed well after the sign-in that caused it. 180 is
 * what GitHub and Atlassian Cloud both retain for audit events.
 */
export const DEFAULT_AUTH_MAX_AGE_MS = 180 * DAY_MS;

/** How often a pass may run. Matches the webhook default. */
export const DEFAULT_AUDIT_RETENTION_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Rows removed per statement.
 *
 * Bounded for the same reason the webhook prune is: the first pass on an
 * install that has never pruned faces every row ever written, and this runs off
 * a user's content write. An unbounded DELETE there is a long lock on the
 * largest table in the worst possible moment.
 */
export const AUDIT_PRUNE_BATCH_SIZE = 500;

/** Batches one pass will take before leaving the rest to the next one. */
export const DEFAULT_AUDIT_MAX_BATCHES_PER_RUN = 20;

export interface AuditRetentionConfig {
  /** Content activity — who changed what. Default 90 days. */
  activityMaxAgeMs?: MaxAge;
  /** Sign-ins, password changes, role grants. Default 180 days. */
  authMaxAgeMs?: MaxAge;
  /** Shortest time between two passes. Default one hour. */
  intervalMs?: number;
  /** Batches per pass. Default 20. */
  maxBatchesPerRun?: number;
}

export interface ResolvedAuditRetentionConfig {
  activityMaxAgeMs: MaxAge;
  authMaxAgeMs: MaxAge;
  intervalMs: number;
  maxBatchesPerRun: number;
}

/**
 * A window, resolved by the rule every trail shares.
 *
 * The bound and the direction of each rejection live in
 * `domains/retention/window`, so this trail cannot drift from the others on a
 * question none of them owns alone. Zero is `malformed` here rather than
 * "keep nothing": an audit trail set to zero is far more likely to be a typo
 * than a decision, and erasing the record of who did what is not recoverable.
 */
function maxAge(value: MaxAge | undefined, fallback: number): MaxAge {
  return resolveRetentionWindow(value, { fallback, zero: "malformed" });
}

function positive(value: number | undefined, fallback: number): number {
  // Bounded for the same reason a window is: the gate subtracts the interval
  // from now to decide whether a pass is due, so a value that leaves the Date
  // range makes that comparison unanswerable and no pass ever runs again.
  const ms = value as number;
  return Number.isFinite(ms) && ms > 0 && ms <= MAX_STORABLE_OFFSET_MS
    ? ms
    : fallback;
}

/** A batch count, which must be a whole number of batches. */
function wholePositive(value: number | undefined, fallback: number): number {
  const resolved = positive(value, fallback);
  return Math.floor(resolved) || fallback;
}

/**
 * Resolve the configured windows, filling in the defaults.
 *
 * `false` for the whole block disables both windows rather than falling back to
 * the defaults, so an operator who has decided to keep everything keeps it.
 * Each window also accepts `false` on its own, because bounding the
 * high-volume feed while keeping security history indefinitely is a reasonable
 * and common position, and one shared switch cannot express it.
 */
export function resolveAuditRetentionConfig(
  input?: AuditRetentionConfig | false
): ResolvedAuditRetentionConfig {
  if (input === false) {
    return {
      activityMaxAgeMs: false,
      authMaxAgeMs: false,
      intervalMs: DEFAULT_AUDIT_RETENTION_INTERVAL_MS,
      maxBatchesPerRun: DEFAULT_AUDIT_MAX_BATCHES_PER_RUN,
    };
  }

  return {
    activityMaxAgeMs: maxAge(
      input?.activityMaxAgeMs,
      DEFAULT_ACTIVITY_MAX_AGE_MS
    ),
    authMaxAgeMs: maxAge(input?.authMaxAgeMs, DEFAULT_AUTH_MAX_AGE_MS),
    intervalMs: positive(
      input?.intervalMs,
      DEFAULT_AUDIT_RETENTION_INTERVAL_MS
    ),
    maxBatchesPerRun: wholePositive(
      input?.maxBatchesPerRun,
      DEFAULT_AUDIT_MAX_BATCHES_PER_RUN
    ),
  };
}

/**
 * The policy a hot reload published, if any.
 *
 * The runners capture their policy when they are built, so a config saved in
 * dev would otherwise keep pruning on the previous windows until restart —
 * including a change to `false`, where the stale windows go on deleting rows
 * the operator has just asked to keep. Passes read through
 * {@link activeAuditRetention} so the reloaded value takes effect on save,
 * mirroring how the audit recording seam is republished.
 *
 * Process-global for the same reason that one is: it answers a question with a
 * single answer per process, and threading it through every construction site
 * would reintroduce the carry problem this exists to avoid.
 */
let publishedAuditRetention: ResolvedAuditRetentionConfig | undefined;

/**
 * Publish a reloaded policy. `undefined` restores whatever was built in.
 *
 * Cleared alongside the other process-global registries when the container is
 * torn down: a value left behind would be preferred over the built-in policy of
 * whatever configuration initialises next, so a short window from a previous
 * app could go on deleting rows in one that configured `audit.retention: false`.
 */
export function setAuditRetention(
  policy: ResolvedAuditRetentionConfig | undefined
): void {
  publishedAuditRetention = policy;
}

/** The policy a pass should run with: the reloaded one, else the built-in. */
export function activeAuditRetention(
  built: ResolvedAuditRetentionConfig | undefined
): ResolvedAuditRetentionConfig | undefined {
  return publishedAuditRetention ?? built;
}
