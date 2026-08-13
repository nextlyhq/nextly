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

import {
  CALENDAR_COLUMN_MAX_OFFSET_MS,
  resolveRetentionWindow,
} from "../retention/window";

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
 * A window, resolved by the rule every trail shares.
 *
 * Derived from `domains/retention/window` rather than decided here, because
 * audit, webhooks and this ledger were all answering one question separately
 * and had drifted into different answers for the same input. The copy that
 * stood here bounded a window by `8.64e15` — the full `Date` range — which is
 * not what any COLUMN can store: a cutoff formed from it lands far outside
 * `datetime`, and the pass then fails on every run while the configuration
 * reads as accepted.
 *
 * `zero` is `keep-nothing` rather than malformed, and this ledger is the reason
 * that parameter exists. A delivery row's purpose is making a retry possible
 * and answering "did this send"; an operator who does not want recipient
 * addresses stored at all is expressing a position, not making a typo. An audit
 * trail set to zero is the opposite, which is why the two cannot share one
 * reading.
 *
 * The bound is the calendar one because `email_deliveries.created_at` is a
 * MySQL `datetime(3)` — the same family as `audit_log` and the webhook tables,
 * and not the epoch-based `TIMESTAMP` that governs `activity_log`.
 */
function maxAge(value: EmailMaxAge | undefined, fallback: number): EmailMaxAge {
  return resolveRetentionWindow(value, {
    fallback,
    zero: "keep-nothing",
    maxOffsetMs: CALENDAR_COLUMN_MAX_OFFSET_MS,
  });
}

/**
 * An interval is subtracted from now to decide whether a pass is due, so it has
 * to stay a real date; a value outside the `Date` range makes that comparison
 * unanswerable and no pass ever runs again. Unlike a window it is never stored
 * or compared against a column, so no column sets this ceiling — any finite
 * bound past the point where an interval means anything will do.
 */
const MAX_INTERVAL_MS = 50 * 365 * 24 * 60 * 60 * 1000;

function positive(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Number.isFinite(value) && value > 0 && value <= MAX_INTERVAL_MS
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

/**
 * The flattened policy a config's NESTED block implies.
 *
 * `sanitizeConfig` computes `emailRetention` before any plugin `setup()`
 * transformer runs, so the two representations disagree the moment a plugin
 * rewrites `email.retention`. Every place that merges a transformed config back
 * has to recompute the derived value, and there are three of them: the DI
 * composition root, the CLI's fold, and anything that publishes a reload.
 *
 * Written once here rather than three times, because three copies of one
 * derivation agree until someone edits one — and the disagreement is silent,
 * since both sides look correct in isolation.
 *
 * Returns the base policy when the transformed config declares no `email` block
 * at all: absence means the transformer said nothing about email, not that it
 * asked for defaults.
 */
export function emailRetentionAfterTransform(
  transformedEmail: { retention?: EmailRetentionConfig | false } | undefined,
  fallback: ResolvedEmailRetentionConfig | undefined
): ResolvedEmailRetentionConfig | undefined {
  return transformedEmail === undefined
    ? fallback
    : resolveEmailRetentionConfig(transformedEmail.retention);
}

/** The policy a pass should run with: the reloaded one, else the built-in. */
export function activeEmailRetention(
  built: ResolvedEmailRetentionConfig | undefined
): ResolvedEmailRetentionConfig | undefined {
  return publishedEmailRetention ?? built;
}

/**
 * The retention classes a delivery row can carry.
 *
 * Derived from what the writer can stamp rather than restated: the suite
 * asserts every value `EMAIL_RETENTION_CLASS` can take appears here, so adding
 * a class without giving it a window fails a test instead of leaving those rows
 * unswept. The prune scopes its DELETE by class, which is what makes an omitted
 * class invisible — it matches no branch and grows while the pass reports
 * success.
 *
 * One entry today. That is not a reason to drop the list: the column exists
 * precisely so classes can diverge, and the guard has to predate the divergence
 * to be worth anything.
 */
export type EmailRetentionClass = "email";

export const EMAIL_RETENTION_CLASSES: readonly EmailRetentionClass[] = [
  "email",
];

/**
 * The window governing one class, or `false` when it is kept indefinitely.
 *
 * A single window today, asked per class so the prune never needs to change
 * shape when a second one is added — only this function does.
 */
export function windowForEmailClass(
  policy: ResolvedEmailRetentionConfig,
  _retentionClass: EmailRetentionClass
): EmailMaxAge {
  return policy.maxAgeMs;
}
