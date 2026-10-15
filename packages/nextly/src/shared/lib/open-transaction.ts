/**
 * Refusing a write that must outlive any rollback while the calling flow is
 * inside an open transaction.
 *
 * Some writes must commit on their own whatever happens to the work around
 * them: the count of a failed attempt, the spend of a single-use secret. Made
 * inside an open transaction on SQLite, such a write joins it as a savepoint
 * and is undone if it rolls back, so a caller that rolls back after every
 * failure is never counted. On PostgreSQL and MySQL the same write would
 * commit on a connection of its own; it is refused there too, so code that
 * passes there does not fail on SQLite.
 *
 * "Inside an open transaction" is judged for the calling async flow, never for
 * the connection: on SQLite every request shares one connection, and another
 * request's open transaction must not make this one's write refused. Its own
 * transaction queues behind that one instead.
 *
 * @module shared/lib/open-transaction
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../errors/nextly-error";

/** The adapter, as far as telling whether the calling flow is in a transaction. */
export type OpenTransactionProbe = Pick<
  DrizzleAdapter,
  "transactionOpenInFlow"
>;

/**
 * Refuse `operation` when the calling async flow is inside a transaction on
 * `adapter` that has not finished.
 *
 * A precondition: call it before the write, and open the write's own
 * transaction only once it has passed.
 *
 * @param adapter - The database adapter the write goes through
 * @param operation - What was refused, named in the log
 * @throws {NextlyError} `INTERNAL_ERROR` when a transaction is open: the
 *   calling code is wrong, and must make the call before it opens its
 *   transaction or after that transaction has finished
 */
export function assertNoOpenTransaction(
  adapter: OpenTransactionProbe,
  operation: string
): void {
  if (!adapter.transactionOpenInFlow()) return;
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "An unexpected error occurred.",
    logMessage: `${operation} was called inside an open transaction. It commits on its own and never joins one: call it before opening the transaction, or after it has finished.`,
    logContext: { operation },
  });
}
