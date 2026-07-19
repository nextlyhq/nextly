/**
 * Webhook domain — delivery retry policy (pure).
 *
 * Decides what a delivery attempt's result means: whether it succeeded, should
 * be retried later, or has permanently failed, and when the next retry is due.
 * Kept pure and separate from the drain so the retry/backoff rules are trivially
 * testable and identical across every dialect.
 *
 * @module domains/webhooks/delivery-policy
 */

/** Attempts before a retrying delivery is marked permanently failed. */
export const DEFAULT_MAX_ATTEMPTS = 6;
/** First retry delay; each subsequent attempt doubles it up to the cap. */
export const DEFAULT_BASE_DELAY_MS = 30_000; // 30s
/** Upper bound on a single retry delay. */
export const DEFAULT_MAX_DELAY_MS = 3_600_000; // 1h

/** How an HTTP status maps to a delivery outcome. */
export type AttemptOutcome = "delivered" | "retry" | "failed";

/**
 * Classify an HTTP status. 2xx is delivered; 429 and 5xx are transient (retry);
 * everything else (a not-followed 3xx, or a 4xx) is a permanent failure the
 * receiver must fix, so we stop retrying.
 */
export function classifyResponse(status: number): AttemptOutcome {
  if (status >= 200 && status < 300) return "delivered";
  if (status === 429 || status >= 500) return "retry";
  return "failed";
}

export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  /** Injectable in [0, 1); defaults to Math.random. */
  random?: () => number;
}

/**
 * Exponential backoff with full jitter, capped. `attemptCount` is the number of
 * attempts already made (1 after the first). Full jitter (a uniform draw in
 * `[0, window)`) spreads retries so many failing deliveries don't stampede the
 * receiver at the same instant.
 */
export function nextAttemptDelayMs(
  attemptCount: number,
  options: BackoffOptions = {}
): number {
  const base = options.baseMs ?? DEFAULT_BASE_DELAY_MS;
  const cap = options.capMs ?? DEFAULT_MAX_DELAY_MS;
  const random = options.random ?? Math.random;
  const exponent = Math.max(0, attemptCount - 1);
  const window = Math.min(cap, base * 2 ** exponent);
  return Math.floor(random() * window);
}

export type DeliveryDecision =
  | { status: "delivered" }
  | { status: "retrying"; delayMs: number }
  | { status: "failed"; reason: string };

export interface DecideDeliveryInput {
  outcome: AttemptOutcome;
  /** Attempts made so far, including the one just completed. */
  attemptCount: number;
  maxAttempts?: number;
  /** Human-readable reason to record when the outcome is `failed`. */
  reason?: string;
  backoff?: BackoffOptions;
}

/**
 * Turn an attempt's outcome into the next delivery state. A transient outcome
 * retries until `maxAttempts` is reached, after which it is marked failed.
 */
export function decideDelivery(input: DecideDeliveryInput): DeliveryDecision {
  const max = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (input.outcome === "delivered") return { status: "delivered" };
  if (input.outcome === "failed") {
    return { status: "failed", reason: input.reason ?? "permanent failure" };
  }
  if (input.attemptCount >= max) {
    return { status: "failed", reason: `exhausted after ${max} attempts` };
  }
  return {
    status: "retrying",
    delayMs: nextAttemptDelayMs(input.attemptCount, input.backoff),
  };
}
