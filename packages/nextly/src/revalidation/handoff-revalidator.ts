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
import { tagsToExpire } from "../runtime/cache/next-cache-revalidator";
import { consoleLogger } from "../shared/types";

import { expiryHandoff, isPendingExpiryHandoff } from "./expiry-handoff";
import type { CacheRevalidator, RevalidationIntent } from "./types";

export class HandOffRevalidator implements CacheRevalidator {
  async flush(intents: RevalidationIntent[]): Promise<void> {
    const handoff = expiryHandoff();
    if (isPendingExpiryHandoff(handoff)) return;
    const tags = tagsToExpire(intents);
    if (tags.length === 0) return;
    try {
      await handoff.handOff(tags, "a write made outside Next.js");
    } catch (error) {
      // Best-effort, as every revalidator is: the write is committed already.
      consoleLogger.error("[nextly] cache expiry could not be handed off", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
