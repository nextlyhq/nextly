/**
 * Webhook domain — retention policy resolution.
 *
 * Recording is unconditional: every content write appends a row to
 * `nextly_events`, including in the majority of installs that never configure a
 * webhook. Without a retention policy that table grows forever, so this is a
 * release gate for the webhook series rather than a tuning knob.
 *
 * Resolution is pure and total — it never throws, and it clamps rather than
 * rejects, so a malformed value degrades to something safe instead of failing a
 * boot. Mirrors `domains/versions/resolve-config.ts`.
 *
 * @module domains/webhooks/retention-config
 */

/**
 * Which retention window governs an event row.
 *
 * A single event can drive a webhook AND be audit-relevant, so the class
 * records the LONGEST retention the row needs rather than what produced it.
 * Everything written today is `webhook`; the audit-log feature will mark the
 * rows it depends on as `audit` so outbox hygiene cannot evict its history.
 */
export type EventRetentionClass = "webhook" | "audit";

export const EVENT_RETENTION_CLASSES: readonly EventRetentionClass[] = [
  "webhook",
  "audit",
];

/** The class every event is written with until the audit log exists. */
export const DEFAULT_EVENT_RETENTION_CLASS: EventRetentionClass = "webhook";

/** User-facing retention options. `false` anywhere means "keep forever". */
export interface WebhookRetentionConfig {
  /** Age after which a webhook-class event is prunable. `false` = keep forever. */
  eventsMaxAgeMs?: number | false;
  /**
   * Age after which an audit-class event is prunable. `false` = keep forever.
   * Separate from `eventsMaxAgeMs` because audit history is measured in months
   * while outbox hygiene is measured in days.
   */
  auditEventsMaxAgeMs?: number | false;
  /**
   * Age after which a TERMINAL delivery row is prunable. `false` = keep forever.
   * Clamped to at most the event windows: deliveries cascade from their event,
   * so a delivery can never outlive it and a larger value would be a lie.
   */
  deliveriesMaxAgeMs?: number | false;
  /**
   * Rows deleted per statement. Clamped to {@link MAX_BATCH_SIZE}, above which a
   * pass would exceed SQLite's bind-parameter limit and fail every time.
   */
  batchSize?: number;
  /** Batches per pass, so one pass stays bounded on a serverless request. */
  maxBatchesPerRun?: number;
  /** Minimum spacing between passes. */
  intervalMs?: number;
}

/** Retention fully resolved; every field is present and safe to use. */
export interface ResolvedWebhookRetentionConfig {
  eventsMaxAgeMs: number | false;
  auditEventsMaxAgeMs: number | false;
  deliveriesMaxAgeMs: number | false;
  batchSize: number;
  maxBatchesPerRun: number;
  intervalMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 30 days. The correctness floor is far lower — the retry envelope tops out
 * around half an hour — so this is chosen for debugging and replay, matching
 * Stripe's replay window.
 */
export const DEFAULT_EVENTS_MAX_AGE_MS = 30 * DAY_MS;

/** 365 days. Audit history is kept in years; SOC 2 practice is a one-year floor. */
export const DEFAULT_AUDIT_EVENTS_MAX_AGE_MS = 365 * DAY_MS;

/**
 * 7 days. Deliveries are the faster-growing table (events x matching endpoints)
 * and carry the per-attempt log, so they are pruned sooner than their events.
 */
export const DEFAULT_DELIVERIES_MAX_AGE_MS = 7 * DAY_MS;

/**
 * 500 ids per statement. Matches the version-retention chunk size and stays
 * under SQLite's `SQLITE_MAX_VARIABLE_NUMBER` of 999 on older builds — event ids
 * are text, so the id list IS the bind-parameter count.
 */
export const DEFAULT_BATCH_SIZE = 500;

/**
 * The largest batch that stays portable.
 *
 * A batch becomes an `IN` list of ids, and ids are text, so the batch size IS
 * the bind-parameter count. SQLite builds before 3.32 cap a statement at 999
 * parameters, and the live-delivery lookup adds a few more on top. Above this a
 * pass would fail on every run, and because the runner swallows the failure
 * after the gate has recorded the attempt, retention would simply stop making
 * progress with no visible error. Clamped rather than rejected so a large value
 * still prunes, just in portable-sized pieces.
 */
export const MAX_BATCH_SIZE = 900;

/** 20 batches, so a single pass deletes at most 10k rows and then stops. */
export const DEFAULT_MAX_BATCHES_PER_RUN = 20;

/** One hour between passes. */
export const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

/** A positive, finite integer, optionally capped, or the fallback. Never throws. */
function positiveInt(value: unknown, fallback: number, max?: number): number {
  const resolved =
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : fallback;
  return max === undefined ? resolved : Math.min(resolved, max);
}

/** A non-negative duration, `false` for "keep forever", or the fallback. */
function maxAge(value: unknown, fallback: number | false): number | false {
  if (value === false) return false;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

/** The longest window any event class may be kept for. */
function longestEventWindow(
  events: number | false,
  audit: number | false
): number | false {
  if (events === false || audit === false) return false;
  return Math.max(events, audit);
}

/**
 * Resolve user retention options into a complete, safe policy.
 *
 * `false` disables retention wholesale, mirroring `versions: false`. Passing
 * nothing enables it at defaults: the row is written on every content write
 * whether or not the user asked for webhooks, so leaving that unbounded by
 * default would tax installs that never opted in.
 */
export function resolveWebhookRetentionConfig(
  config: WebhookRetentionConfig | boolean | undefined | null
): ResolvedWebhookRetentionConfig | null {
  if (config === false) return null;
  const input: WebhookRetentionConfig =
    config === true || config == null ? {} : config;

  const eventsMaxAgeMs = maxAge(
    input.eventsMaxAgeMs,
    DEFAULT_EVENTS_MAX_AGE_MS
  );
  const auditEventsMaxAgeMs = maxAge(
    input.auditEventsMaxAgeMs,
    DEFAULT_AUDIT_EVENTS_MAX_AGE_MS
  );

  // A delivery row is removed by cascade when its event goes, so a window
  // longer than the event's cannot be honoured. Clamp instead of erroring: the
  // configured intent (prune deliveries no later than this) still holds.
  const requested = maxAge(
    input.deliveriesMaxAgeMs,
    DEFAULT_DELIVERIES_MAX_AGE_MS
  );
  const ceiling = longestEventWindow(eventsMaxAgeMs, auditEventsMaxAgeMs);
  const deliveriesMaxAgeMs =
    ceiling === false
      ? requested
      : requested === false
        ? ceiling
        : Math.min(requested, ceiling);

  return {
    eventsMaxAgeMs,
    auditEventsMaxAgeMs,
    deliveriesMaxAgeMs,
    batchSize: positiveInt(input.batchSize, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE),
    maxBatchesPerRun: positiveInt(
      input.maxBatchesPerRun,
      DEFAULT_MAX_BATCHES_PER_RUN
    ),
    intervalMs: positiveInt(input.intervalMs, DEFAULT_INTERVAL_MS),
  };
}

/** The window governing a class, or `false` when that class is kept forever. */
export function windowForClass(
  policy: ResolvedWebhookRetentionConfig,
  eventClass: EventRetentionClass
): number | false {
  return eventClass === "audit"
    ? policy.auditEventsMaxAgeMs
    : policy.eventsMaxAgeMs;
}
