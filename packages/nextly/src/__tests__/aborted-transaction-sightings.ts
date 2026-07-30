/**
 * Shared buffer for PostgreSQL aborted-transaction sightings.
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
 * PostgreSQL's signature for "an earlier statement in this transaction failed".
 *
 * Always a SECONDARY error: the statement that actually broke was swallowed somewhere, and
 * everything after it in the transaction reports this instead.
 */
export const PG_ABORTED_TRANSACTION = "current transaction is aborted";

const sightings: string[] = [];

/** Record an aborted-transaction error. Called by the integration harness. */
export function recordAbortedTransaction(message: string): void {
  sightings.push(message);
}

/**
 * Everything seen since the last read, clearing as it goes so one test's failure cannot be
 * re-reported against the next.
 */
export function takeAbortedTransactionSightings(): string[] {
  return sightings.splice(0, sightings.length);
}
