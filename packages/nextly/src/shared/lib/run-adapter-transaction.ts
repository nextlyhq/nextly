/**
 * Running async work in the database adapter's own transaction.
 *
 * On SQLite every async transaction has to go through the adapter: Drizzle's
 * better-sqlite3 transaction refuses a callback that returns a promise. The
 * adapter classifies whatever escapes its transaction that is not already an
 * application error, so a caller's own error — a plugin's refusal class, a
 * driver error from its own query — arrived as a generic `DatabaseError`,
 * while on PostgreSQL and MySQL Drizzle's transaction hands back exactly what
 * the work threw.
 *
 * @module shared/lib/run-adapter-transaction
 */

/**
 * The adapter's transaction runner, bound to its adapter. `Tx` is the handle
 * it hands the work, where it hands one.
 */
export type AdapterTransactionRunner<Tx = void> = <R>(
  work: (tx: Tx) => Promise<R>
) => Promise<R>;

/**
 * Run `work` in `transaction`, and reject with the work's own error when it
 * throws.
 *
 * The transaction still rolls back on that error. A failure that is the
 * transaction's own — a `COMMIT` that fails after the work resolved — is the
 * adapter's to report, and rethrown as the adapter raised it.
 */
export async function runAdapterTransaction<T, Tx = void>(
  transaction: AdapterTransactionRunner<Tx>,
  work: (tx: Tx) => Promise<T>
): Promise<T> {
  let failure: { error: unknown } | undefined;
  try {
    return await transaction(async tx => {
      try {
        return await work(tx);
      } catch (error) {
        failure = { error };
        throw error;
      }
    });
  } catch (error) {
    throw failure ? failure.error : error;
  }
}
