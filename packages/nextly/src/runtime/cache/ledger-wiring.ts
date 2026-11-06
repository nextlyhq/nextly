/**
 * Connects the tag expiry ledger to the rest of nextly when it registers.
 *
 * The cache handlers are handed the ledger, so they ask it what expired and
 * record what this instance expires. The expiry hand-off records into it too:
 * a write made outside a request (a job, the CLI, a script), whose tags
 * Next.js cannot expire there, reaches every instance through the ledger,
 * and is still expired in Next.js's own cache at this process's next request. Both are withdrawn when
 * nextly's services are released, so a later registration starts from its own
 * adapter.
 *
 * @module runtime/cache/ledger-wiring
 */
import {
  expiryHandoff,
  holdForNextFlush,
  holdForNextRequest,
  isPendingExpiryHandoff,
  setExpiryHandoff,
  type ExpiryHandoff,
} from "../../revalidation/expiry-handoff";

import {
  holdFailedRecord,
  resumeRecordRetry,
  stopRecordRetry,
} from "./record-retry";
import {
  ledgerFor,
  type TagExpiryLedger,
  type TagExpiryLedgerAdapter,
} from "./tag-expiry-ledger";
import { expireTags, publishTagExpiryLedger } from "./tag-expiry-view";

/**
 * Hands expiries to the ledger. The tags expire in this process at once, as
 * the handlers' own writes do, and are recorded for every other instance; a
 * ledger that could not take them (no table yet, or a refused write) leaves
 * them with this process's next flush, as the default hand-off would.
 */
export class LedgerExpiryHandoff implements ExpiryHandoff {
  async handOff(tags: string[], _reason: string): Promise<void> {
    // Kept for this process's next flush unless the ledger took them: it
    // expires them in a request here, the most a write outside one can get
    // without the ledger. A refused record is retried by a timer as well.
    const outcome = await expireTags(tags);
    if (outcome === "failed") holdFailedRecord(tags);
    else if (outcome !== "recorded") holdForNextFlush(tags);
  }
}

const globalForWiring = globalThis as unknown as {
  __nextly_tag_ledger_withdrawn?: boolean;
};

/**
 * Whether a ledger was installed and has been withdrawn, with no other
 * installed since: between a release of nextly's services and the next
 * registration, when a still-running plugin's write has no ledger to reach
 * and its tags wait in the in-process hand-off for the next one.
 */
export function ledgerWithdrawn(): boolean {
  return globalForWiring.__nextly_tag_ledger_withdrawn === true;
}

/** Publishes `adapter`'s ledger to the handlers and installs the hand-off into it. */
export function installTagExpiryLedger(adapter: TagExpiryLedgerAdapter): void {
  const ledger: TagExpiryLedger = ledgerFor(adapter);
  publishTagExpiryLedger(ledger);
  // Tags the in-process hand-off took before this registration (a plugin's
  // write between a release and the next registration) go to the ledger
  // rather than being left in a hand-off nothing drains any more.
  const previous = expiryHandoff();
  const waiting = isPendingExpiryHandoff(previous) ? previous.take() : [];
  const handoff = new LedgerExpiryHandoff();
  setExpiryHandoff(handoff);
  globalForWiring.__nextly_tag_ledger_withdrawn = false;
  // What a withdrawn ledger left kept is retried into this one.
  resumeRecordRetry();
  if (waiting.length > 0) {
    void handoff.handOff(waiting, "waiting at registration");
    // The default kept them for Next.js's own cache too, which the ledger
    // does not reach.
    holdForNextRequest(waiting);
  }
}

/** Withdraws the ledger and restores the in-process hand-off. */
export function withdrawTagExpiryLedger(): void {
  publishTagExpiryLedger(null);
  // A second withdrawal before the next registration keeps the in-process
  // hand-off the first installed, and the tags a write has left in it since:
  // replacing it would drop them before any ledger could take them.
  if (!isPendingExpiryHandoff(expiryHandoff())) setExpiryHandoff(null);
  globalForWiring.__nextly_tag_ledger_withdrawn = true;
  // The kept tags wait for the next ledger; no timer outlives this one.
  stopRecordRetry();
}
