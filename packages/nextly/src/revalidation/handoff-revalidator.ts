/**
 * The default {@link CacheRevalidator} where no framework adapter is installed:
 * the CLI, a script, a job runner. There is no request to expire tags in, so a
 * write's tags go to the installed expiry hand-off, which records them in the
 * cache tag expiry ledger for every instance's cache handlers to see.
 *
 * With only the in-process default hand-off installed (no ledger), nothing
 * outside a request could act on them, so it does nothing, as the no-op did:
 * a process that never serves a request would keep tags it can never drain.
 *
 * @module revalidation/handoff-revalidator
 */
import {
  handOffWithin,
  tagsToExpire,
} from "../runtime/cache/next-cache-revalidator";

import {
  expiryHandoff,
  isPendingExpiryHandoff,
  takePendingExpiries,
} from "./expiry-handoff";
import type { CacheRevalidator, RevalidationIntent } from "./types";

export class HandOffRevalidator implements CacheRevalidator {
  async flush(intents: RevalidationIntent[]): Promise<void> {
    const handoff = expiryHandoff();
    if (isPendingExpiryHandoff(handoff)) return;
    // Tags an earlier flush could not hand off are retried with this one's:
    // outside Next.js no request flush drains them.
    const tags = [
      ...new Set([...takePendingExpiries(), ...tagsToExpire(intents)]),
    ];
    if (tags.length === 0) return;
    // Bounded, as in a request: a ledger that never answers must not hold a
    // write that has already committed. What it does not take is kept.
    await handOffWithin(handoff, tags, "a write made outside Next.js");
  }
}
