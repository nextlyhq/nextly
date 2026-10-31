/**
 * Connects the tag expiry ledger to the rest of nextly when it registers.
 *
 * The cache handlers are handed the ledger, so they ask it what expired and
 * record what this instance expires. The expiry hand-off records into it too:
 * a write made outside a request (a job, the CLI, a script), whose tags
 * Next.js cannot expire there, reaches every instance through the ledger
 * instead of waiting for this process's next request. Both are withdrawn when
 * nextly's services are released, so a later registration starts from its own
 * adapter.
 *
 * @module runtime/cache/ledger-wiring
 */
import {
  holdForNextFlush,
  setExpiryHandoff,
  type ExpiryHandoff,
} from "../../revalidation/expiry-handoff";

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
    const recorded = await expireTags(tags);
    if (!recorded) holdForNextFlush(tags);
  }
}

/** Publishes `adapter`'s ledger to the handlers and installs the hand-off into it. */
export function installTagExpiryLedger(adapter: TagExpiryLedgerAdapter): void {
  const ledger: TagExpiryLedger = ledgerFor(adapter);
  publishTagExpiryLedger(ledger);
  setExpiryHandoff(new LedgerExpiryHandoff());
}

/** Withdraws the ledger and restores the in-process hand-off. */
export function withdrawTagExpiryLedger(): void {
  publishTagExpiryLedger(null);
  setExpiryHandoff(null);
}
