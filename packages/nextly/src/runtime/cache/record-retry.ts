/**
 * Retries the tag expiries the ledger refused, until it takes them.
 *
 * A write's tags reach other instances only through the ledger. When recording
 * them fails (the database refused the write, or did not answer), they are
 * kept for this process's next flush; but a quiet site may make no next write,
 * and every other instance would then keep serving the previous version. A
 * ledger write needs no request, unlike Next.js's own expiry, so one timer per
 * process tries again, backing off to at most {@link MAX_RETRY_DELAY_MS}, and
 * the start of the process's next cached read tries too: on serverless, a
 * frozen function's timer may never fire. A missing table is not retried: no
 * instance reads expiries until `nextly migrate` adds it.
 *
 * @module runtime/cache/record-retry
 */
import { getNextlyLogger } from "../../observability/logger";
import {
  holdForNextFlush,
  takePendingExpiries,
} from "../../revalidation/expiry-handoff";

import { expireTags } from "./tag-expiry-view";

/** The first wait before a retry, doubled after each failure. */
export const FIRST_RETRY_DELAY_MS = 1_000;

/** The longest wait between two retries. */
export const MAX_RETRY_DELAY_MS = 30_000;

interface RetryState {
  timer?: ReturnType<typeof setTimeout>;
  /** The wait before the next retry. */
  delayMs: number;
  /** Whether a record has failed and not yet been retried successfully. */
  pending: boolean;
  /** A retry under way, shared by every caller that asks meanwhile. */
  running?: Promise<void>;
  /** When the last retry began, on this process's clock. */
  lastAttemptAt: number;
}

// One per process, across module copies, like the hand-off it retries into.
const globalForRetry = globalThis as unknown as {
  __nextly_record_retry?: RetryState;
};

function state(): RetryState {
  globalForRetry.__nextly_record_retry ??= {
    delayMs: FIRST_RETRY_DELAY_MS,
    pending: false,
    lastAttemptAt: 0,
  };
  return globalForRetry.__nextly_record_retry;
}

/**
 * Keeps `tags`, whose record the ledger refused, for the next flush, and
 * starts retrying them. Said once when retries begin, not on every failure.
 */
export function holdFailedRecord(tags: string[]): void {
  holdForNextFlush(tags);
  const retry = state();
  // The failure was an attempt: a read waits the backoff from it too.
  retry.lastAttemptAt = Date.now();
  if (!retry.pending) {
    retry.pending = true;
    getNextlyLogger().warn({
      kind: "cache-tag-record-retrying",
      message: `the cache tag expiry ledger refused ${tags.length} expiries; other instances may serve the previous version until a retry records them`,
    });
  }
  schedule(retry);
}

/** Arms the one timer, unless it is armed already. */
function schedule(retry: RetryState): void {
  if (retry.timer !== undefined) return;
  retry.timer = setTimeout(() => {
    retry.timer = undefined;
    void retryFailedRecords();
  }, retry.delayMs);
  // The retry must not keep a process alive that has nothing else to do.
  retry.timer.unref?.();
}

/**
 * Records the kept tags again, once per call however many callers ask at once.
 * On success the retries stop, and that is said once; on another failure the
 * tags are kept and the next try waits longer.
 */
function retryFailedRecords(): Promise<void> {
  const retry = state();
  if (!retry.pending) return Promise.resolve();
  retry.running ??= (async () => {
    retry.lastAttemptAt = Date.now();
    try {
      const tags = takePendingExpiries();
      if (tags.length === 0) {
        settle(retry);
        return;
      }
      const outcome = await expireTags(tags);
      if (outcome === "recorded") {
        settle(retry);
        getNextlyLogger().info({
          kind: "cache-tag-record-recovered",
          message: `the cache tag expiry ledger recorded the ${tags.length} expiries it had refused`,
        });
        return;
      }
      holdForNextFlush(tags);
      // No ledger or no table: a retry cannot help until one is installed.
      if (outcome !== "failed") {
        settle(retry);
        return;
      }
      retry.delayMs = Math.min(retry.delayMs * 2, MAX_RETRY_DELAY_MS);
      schedule(retry);
    } finally {
      retry.running = undefined;
    }
  })();
  return retry.running;
}

/**
 * The retry a cached read makes before it reads, where a timer may never fire
 * (a frozen serverless function): only while tags wait, and no sooner after the
 * last try than the timer would wait, so a ledger that is down is not asked on
 * every read. Awaited, so the function is not frozen in the middle of it.
 * Nothing to await when nothing waits: a read then takes no extra turn, and
 * its order with other reads and writes is as it was.
 */
export function retryFailedRecordsAtRead(): Promise<void> | undefined {
  const retry = state();
  if (!retry.pending) return undefined;
  if (Date.now() - retry.lastAttemptAt < retry.delayMs) return undefined;
  return retryFailedRecords();
}

/** Stops retrying, with the next failure starting over from the first wait. */
function settle(retry: RetryState): void {
  retry.pending = false;
  retry.delayMs = FIRST_RETRY_DELAY_MS;
  if (retry.timer !== undefined) clearTimeout(retry.timer);
  retry.timer = undefined;
}

/** Stops the timer, when the ledger is withdrawn: the tags stay kept for the next one. */
export function stopRecordRetry(): void {
  settle(state());
}
