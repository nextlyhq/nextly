/**
 * Writing again after a write refused as made from a replaced version.
 *
 * A route that reads a document, changes one thing in it and writes it back
 * sends the version of its read, so another save in between refuses the
 * write rather than being overwritten. The refusal is not the route's answer:
 * the route reads again and makes only its own change on what is stored now,
 * a bounded number of times. Only a refusal for a replaced version is tried
 * again, or one whose transaction read from before the composition graph
 * lock's last holder committed (`composition-graph-lock`); any other failure
 * is the answer, since it may have committed or would fail the same way.
 *
 * @module stale-retry
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { isGraphSnapshotRefusal } from "./composition-graph-lock";
import { inCauses } from "./judged-writes";

/**
 * How many times, in all, a write made from a read is tried before its
 * refusal as stale is the answer.
 */
export const STALE_WRITE_ATTEMPTS = 3;

/** Whether a write was refused because the document changed since it was read. */
export function isStaleVersion(error: unknown): boolean {
  return inCauses(error, NextlyError)?.code === "STALE_VERSION";
}

/**
 * Whether a refused write is made again from a fresh read: refused for a
 * replaced version, or because its transaction read from a snapshot older than
 * the composition graph lock. Both say only that something committed since the
 * write's read; read again, it is judged on that.
 */
function isWrittenAgain(error: unknown): boolean {
  return isStaleVersion(error) || isGraphSnapshotRefusal(error);
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
  let current = first === undefined ? await read() : first.read;
  for (let tried = 1; ; tried += 1) {
    try {
      return await attempt(current);
    } catch (error) {
      if (!isWrittenAgain(error) || tried >= STALE_WRITE_ATTEMPTS) throw error;
      current = await read();
    }
  }
}
