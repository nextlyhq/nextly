/**
 * A pooled adapter's Drizzle transactions, each on a connection the adapter
 * checks out and returns itself.
 *
 * Drizzle's own `transaction()` on a pool checks a connection out, but does
 * not return it as carefully as the adapter's `transaction()` does: it sends
 * BEGIN outside its `try`, so a failed BEGIN never gives the connection back;
 * and when its ROLLBACK fails it hands the connection to the pool as if
 * nothing had happened, possibly still inside the transaction, and throws the
 * ROLLBACK's error in place of the work's. Core services open their
 * transactions through that handle, so it gets the same care here: Drizzle
 * runs the transaction on a connection this module owns, and this module
 * decides how the connection goes back.
 *
 * @module pinned-transaction
 */

/**
 * Drizzle's database handle, as far as running a transaction goes.
 *
 * The callback takes `unknown` and the options `never`, so every dialect's
 * handle fits, whose callback receives its own transaction type and whose
 * options are its own.
 */
export interface DrizzleTransactor {
  transaction<T>(work: (tx: unknown) => Promise<T>, config?: never): Promise<T>;
}

/** One connection a pooled adapter checked out for one transaction. */
export interface PinnedConnection {
  /** Drizzle bound to this connection alone, with the handle's relations. */
  drizzle: DrizzleTransactor;
  /**
   * Sends ROLLBACK on this connection. Harmless when no transaction is open
   * on it: PostgreSQL answers with a warning, MySQL does nothing.
   */
  rollback(): Promise<unknown>;
  /**
   * Gives the connection back: to the pool, or, when `dirty`, closed and
   * removed from it, because it may still be inside the transaction.
   */
  release(dirty: boolean): void;
}

/**
 * Replaces `db`'s `transaction` with one that runs each transaction on a
 * connection from `checkout`.
 *
 * Drizzle, bound to that single connection, runs BEGIN, the work and COMMIT
 * or ROLLBACK as it always does. When the transaction fails, a second
 * ROLLBACK goes to the connection: a no-op when Drizzle's own reached it,
 * and the confirmation that the connection is out of the transaction when
 * Drizzle's did not. If that ROLLBACK fails too, nothing can confirm it, and
 * the connection is closed rather than pooled. The work's own error is what
 * the caller receives, never a ROLLBACK's.
 *
 * @param db - A Drizzle handle on the adapter's pool
 * @param checkout - Checks out a connection for one transaction
 * @returns The same handle, its `transaction` replaced
 */
export function pinTransactions<D extends DrizzleTransactor>(
  db: D,
  checkout: () => Promise<PinnedConnection>
): D {
  const pinned: DrizzleTransactor["transaction"] = async (work, config) => {
    const connection = await checkout();
    let dirty = false;
    // Boxed, so a work that throws `undefined` is still told apart from one
    // that did not throw.
    let workFailure: { error: unknown } | undefined;
    try {
      return await connection.drizzle.transaction(async tx => {
        try {
          return await work(tx);
        } catch (error) {
          workFailure = { error };
          throw error;
        }
      }, config);
    } catch (error) {
      await connection.rollback().catch(() => {
        dirty = true;
      });
      throw workFailure ? workFailure.error : error;
    } finally {
      connection.release(dirty);
    }
  };
  // An own property over the prototype's method, on this handle alone.
  Object.defineProperty(db, "transaction", {
    value: pinned,
    configurable: true,
    writable: true,
  });
  return db;
}
