/**
 * How long a document claim lasts, and how often its holder confirms it.
 *
 * Derived from one TTL rather than written down side by side, so no two of them
 * can be chosen independently and drift into a holder that believes it is
 * protected while a contender is already taking the row.
 *
 * ## Why these numbers
 *
 * 150 seconds and a 15-second heartbeat are WordPress's shipped constants for
 * exactly this problem — `wp_check_post_lock_window` defaults to 150, atop the
 * edit screen's 15-second heartbeat. They are kept because they are the most
 * battle-tested figures for mediating two humans over one document, not because
 * of any margin rule: WordPress derives 150 as "lock duration, plus 5 seconds",
 * and observed ratios elsewhere disagree with each other and with it.
 *
 * ## Why they differ from the migration lock's
 *
 * That lock guards DDL and refuses to steal a live claim, because two concurrent
 * migrations corrupt a schema. This one mediates two people and must permit a
 * takeover. They deliberately share only the clock they are judged against and
 * the derivation below; their durations answer different questions and are free
 * to differ.
 *
 * @module domains/document-lock/timings
 */

import { deriveLeaseTimings } from "../../database/lease-clock";

/** How long one confirmation grants a holder. */
export const DOCUMENT_LOCK_TTL_SECONDS = 150;

/**
 * How many heartbeats fit in one lease.
 *
 * The only free parameter, and it buys tolerance for failure: at ten, a holder
 * can lose several consecutive heartbeats to a slow query or a brief network
 * blip and still hold a claim nobody else can take.
 */
const DOCUMENT_LOCK_RENEW_DIVISOR = 10;

const TIMINGS = deriveLeaseTimings(
  DOCUMENT_LOCK_TTL_SECONDS,
  DOCUMENT_LOCK_RENEW_DIVISOR
);

/** How often an open editor confirms it is still there. */
export const DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS = TIMINGS.renewIntervalMs;

/**
 * How long an editor may go without a CONFIRMED heartbeat before it must treat
 * the claim as lost and stop offering to save.
 *
 * Deliberately not "how many heartbeats failed". A count reaches its limit at
 * the moment the lease expires rather than before it, so the editor would be
 * told after it stopped being protected rather than while it still is.
 */
export const DOCUMENT_LOCK_LOSS_AFTER_MS = TIMINGS.lossAfterMs;

/**
 * How much lease a confirmation must actually grant for a holder to rely on it.
 *
 * "Not yet expired" is not the same as "safe to keep editing": a renewal that
 * leaves almost nothing returns a claim that passes a liveness test with
 * nothing left in it.
 */
export const DOCUMENT_LOCK_RENEW_MARGIN_SECONDS = TIMINGS.renewMarginSeconds;
