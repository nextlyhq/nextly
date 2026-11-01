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

import { recordExpiredTagsAgain, recordLandedSince } from "./tag-expiry-view";

/** The first wait before a retry, doubled after each failure. */
export const FIRST_RETRY_DELAY_MS = 1_000;

/** The longest wait between two retries. */
export const MAX_RETRY_DELAY_MS = 30_000;

/**
 * The longest a cached read waits for a retry it started. The retry goes on
 * past it, within the ledger's own bound; the read is served meanwhile.
 */
export const READ_RETRY_WAIT_MS = 1_000;

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
  /** How many failed records have been kept, so a retry can tell whether more came in while it ran. */
  held: number;
  /** The tags the attempt under way took from the hold, until it ends. */
  inFlight: string[];
  /** Moved on by each withdrawal, so an attempt begun before one changes nothing after it. */
  generation: number;
  /** When each kept tag was last refused, on this process's clock. */
  refusedAt: Map<string, number>;
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
    held: 0,
    inFlight: [],
    generation: 0,
    refusedAt: new Map(),
  };
  // A copy of this module from before `refusedAt` was kept may have made it.
  globalForRetry.__nextly_record_retry.refusedAt ??= new Map();
  return globalForRetry.__nextly_record_retry;
}

/**
 * Keeps `tags`, whose record the ledger refused, for the next flush, and
 * starts retrying them. Said once when retries begin, not on every failure.
 */
export function holdFailedRecord(tags: string[]): void {
  holdForNextFlush(tags);
  const retry = state();
  const now = Date.now();
  for (const tag of tags) retry.refusedAt.set(tag, now);
  // The failure was an attempt: a read waits the backoff from it too.
  retry.lastAttemptAt = Date.now();
  retry.held += 1;
  if (!retry.pending) {
    retry.pending = true;
    getNextlyLogger().warn({
      kind: "cache-tag-record-retrying",
      message: `the cache tag expiry ledger refused ${tags.length} expiries; other instances may serve the previous version until a retry records them`,
    });
  }
  schedule(retry);
}

/**
 * Arms the one timer, unless it is armed already; with `replace`, in place of
 * one armed before the wait changed, so the next try waits the wait as it is.
 */
function schedule(retry: RetryState, replace = false): void {
  if (retry.timer !== undefined) {
    if (!replace) return;
    clearTimeout(retry.timer);
    retry.timer = undefined;
  }
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
  if (retry.running) return retry.running;
  const run = attempt(retry);
  // Cleared once settled, and only if still this run: an attempt that
  // finishes without awaiting has settled before it could be assigned.
  retry.running = run;
  void run.finally(() => {
    if (retry.running === run) retry.running = undefined;
  });
  return run;
}

/** One retry of the kept tags. */
async function attempt(retry: RetryState): Promise<void> {
  retry.lastAttemptAt = Date.now();
  // This attempt is the try a waiting timer would have made: a read that
  // comes first takes its place, so the backoff counts from here, once.
  if (retry.timer !== undefined) clearTimeout(retry.timer);
  retry.timer = undefined;
  // A record refused while this one runs is not among the tags it takes.
  const heldBefore = retry.held;
  const generation = retry.generation;
  // A tag whose record landed after it was refused, such as a hand-off that
  // answered after it was given up on, is recorded already: recording it
  // again would only move its expiry on, and refuse what other instances
  // regenerated since.
  const kept = takePendingExpiries();
  const tags = kept.filter(tag => {
    const refused = retry.refusedAt.get(tag);
    if (refused !== undefined && recordLandedSince(tag, refused)) {
      retry.refusedAt.delete(tag);
      return false;
    }
    return true;
  });
  if (tags.length === 0) {
    // Every kept expiry landed late: the retries end as if this one had
    // recorded them, and are said to.
    if (finish(retry, heldBefore) && kept.length > 0) recovered(kept.length);
    return;
  }
  retry.inFlight = tags;
  // The ledger alone: these tags expired here when they were written, and a
  // retry that expired them again would refuse every entry regenerated since.
  const outcome = await recordExpiredTagsAgain(tags);
  // The ledger was withdrawn meanwhile, which kept these tags again for the
  // next one: whatever came of this attempt, it settles nothing now.
  if (retry.generation !== generation) return;
  retry.inFlight = [];
  if (outcome === "recorded") {
    for (const tag of tags) retry.refusedAt.delete(tag);
    if (finish(retry, heldBefore)) recovered(kept.length);
    return;
  }
  holdForNextFlush(tags);
  // No ledger or no table: a retry cannot help until one is installed.
  if (outcome !== "failed") {
    settle(retry);
    return;
  }
  retry.delayMs = Math.min(retry.delayMs * 2, MAX_RETRY_DELAY_MS);
  schedule(retry, true);
}

/** Says once that the expiries the ledger refused are recorded now. */
function recovered(count: number): void {
  getNextlyLogger().info({
    kind: "cache-tag-record-recovered",
    message: `the cache tag expiry ledger recorded the ${count} expiries it had refused`,
  });
}

/**
 * Ends the retries after a successful attempt, unless a record was refused
 * while it ran: those tags are kept but were not taken, so the next try is
 * armed for them from the first wait. Whether the retries ended.
 */
function finish(retry: RetryState, heldBefore: number): boolean {
  if (retry.held === heldBefore) {
    settle(retry);
    return true;
  }
  retry.delayMs = FIRST_RETRY_DELAY_MS;
  schedule(retry, true);
  return false;
}

/**
 * Takes up the tags a withdrawn ledger left kept, when the next one is
 * installed: the timer stopped with the withdrawal, and a quiet process may
 * make no write to drain them.
 */
export function resumeRecordRetry(): void {
  const tags = takePendingExpiries();
  if (tags.length > 0) holdFailedRecord(tags);
}

/**
 * The retry a cached read makes before it reads, where a timer may never fire
 * (a frozen serverless function): only while tags wait, and no sooner after the
 * last try than the timer would wait, so a ledger that is down is not asked on
 * every read. Awaited, so the function is not frozen in the middle of it, but
 * for {@link READ_RETRY_WAIT_MS} at most: a ledger that does not answer must
 * not hold the read. Nothing to await when nothing waits: a read then takes no
 * extra turn, and its order with other reads and writes is as it was.
 */
export function retryFailedRecordsAtRead(): Promise<void> | undefined {
  const retry = state();
  if (!retry.pending) return undefined;
  if (Date.now() - retry.lastAttemptAt < retry.delayMs) return undefined;
  const running = retryFailedRecords();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>(resolve => {
    timer = setTimeout(resolve, READ_RETRY_WAIT_MS);
    timer.unref?.();
  });
  return Promise.race([running, waited]).finally(() => clearTimeout(timer));
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
  const retry = state();
  // An attempt under way took its tags from the hold: they are kept again, for
  // the next ledger, and that attempt's end is left to change nothing.
  if (retry.inFlight.length > 0) holdForNextFlush(retry.inFlight);
  retry.inFlight = [];
  retry.generation += 1;
  // A later retry starts afresh rather than waiting on the withdrawn one.
  retry.running = undefined;
  settle(retry);
}
