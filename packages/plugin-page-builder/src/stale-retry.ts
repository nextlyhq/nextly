/**
 * Writing again after a write refused as made from a replaced version.
 *
 * A route that reads a document, changes one thing in it and writes it back
 * sends the version of its read, so another save in between refuses the
 * write rather than being overwritten. The refusal is not the route's answer:
 * the route reads again and makes only its own change on what is stored now,
 * a bounded number of times. Only a refusal for a replaced version is tried
 * again; any other failure is the answer, since it may have committed or
 * would fail the same way.
 *
 * @module stale-retry
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { inCauses } from "./judged-writes";
import { attemptUntilFresh, STALE_WRITE_ATTEMPTS } from "./stale-attempts";

// The bound lives with the loop, which the editor runs too; named here as
// well for the routes that state it.
export { STALE_WRITE_ATTEMPTS };

/** Whether a write was refused because the document changed since it was read. */
export function isStaleVersion(error: unknown): boolean {
  return inCauses(error, NextlyError)?.code === "STALE_VERSION";
}

/**
 * Run `attempt` on a read, and on a fresh `read` each time it throws a stale
 * refusal, at most {@link STALE_WRITE_ATTEMPTS} times in all. `attempt` makes
 * its checks and its change on the read it is handed, so each try is judged
 * on what is stored then. After the last try the stale refusal is thrown: it
 * is true, the document kept changing. `first` is a read already in hand,
 * used for the first try instead of reading again.
 */
export async function retryOnStale<TRead, TResult>(
  read: () => Promise<TRead>,
  attempt: (read: TRead) => Promise<TResult>,
  first?: { readonly read: TRead }
): Promise<TResult> {
  // The one loop, with the server's recogniser of the refusal.
  return attemptUntilFresh(read, attempt, {
    isStale: isStaleVersion,
    ...(first === undefined ? {} : { first }),
  });
}
