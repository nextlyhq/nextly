/**
 * Shared buffer and detection for PostgreSQL aborted-transaction sightings.
 *
 * Deliberately dependency-free. `src/__tests__/setup.ts` is the setup file for BOTH the unit and
 * the integration vitest configs, so anything it imports is loaded into every unit test too.
 * Importing the integration harness there pulls in the DI registry, the adapters and the event
 * bus, which is enough to break unit suites that expect none of it. Keeping the buffer in its own
 * module lets the assertion live in the shared setup without dragging the harness along.
 *
 * @module __tests__/aborted-transaction-sightings
 */

/**
 * PostgreSQL's SQLSTATE for "an earlier statement in this transaction failed".
 *
 * The authoritative signal. Unlike the message text this is fixed by the wire protocol, so it
 * survives a server running with a non-English `lc_messages` — where the human-readable text is
 * translated and an English substring match would silently never fire, leaving the suite falsely
 * green.
 */
export const PG_ABORTED_TRANSACTION_SQLSTATE = "25P02";

/**
 * The English text for the same condition.
 *
 * Kept as a fallback for errors that reach us with the code stripped: the adapter preserves
 * `code` on the errors it classifies, but a value re-wrapped further up the stack may carry only
 * a message. Matching on both means the weaker signal never has to stand alone.
 */
export const PG_ABORTED_TRANSACTION = "current transaction is aborted";

/** How deep to follow `cause` before giving up, so a self-referencing chain cannot spin. */
const MAX_CAUSE_DEPTH = 10;

/**
 * Whether a thrown value reports an aborted transaction.
 *
 * Walks the `cause` chain because the PostgreSQL adapter classifies the driver's error into a
 * `DatabaseError` and keeps the original underneath: the code can be on either one, and which
 * depends on where in the stack the value was caught.
 */
export function isAbortedTransactionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth += 1) {
    if (typeof current === "string") {
      if (current.includes(PG_ABORTED_TRANSACTION)) return true;
      return false;
    }
    if (typeof current !== "object") return false;

    const candidate = current as { code?: unknown; message?: unknown };
    if (candidate.code === PG_ABORTED_TRANSACTION_SQLSTATE) return true;
    if (
      typeof candidate.message === "string" &&
      candidate.message.includes(PG_ABORTED_TRANSACTION)
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The buffer, on `globalThis` rather than in module scope.
 *
 * Module scope would give one array per module instance, and there is more than one instance. A
 * test importing the harness through the published `nextly/testing` subpath gets the copy bundled
 * into `dist/testing.mjs`, while `setup.ts` imports this source file: an abort recorded in one
 * array is invisible to an assertion reading the other, which fails open and reports green. The
 * same reasoning applies to Turbopack re-executing modules across an HMR cycle, and is why
 * `init/schema-snapshot-cache.ts` stores its caches the same way.
 */
interface SightingsBag {
  __nextly_abortedTransactionSightings?: string[];
}

function sightings(): string[] {
  const bag = globalThis as SightingsBag;
  bag.__nextly_abortedTransactionSightings ??= [];
  return bag.__nextly_abortedTransactionSightings;
}

/** Record an aborted-transaction error. Called by the integration harness. */
export function recordAbortedTransaction(message: string): void {
  sightings().push(message);
}

/**
 * Everything seen since the last read, clearing as it goes so one test's failure cannot be
 * re-reported against the next.
 */
export function takeAbortedTransactionSightings(): string[] {
  const buffer = sightings();
  return buffer.splice(0, buffer.length);
}
