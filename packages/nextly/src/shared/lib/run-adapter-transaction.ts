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
import { getNextlyLogger } from "../../observability/logger";

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

/** The adapter surface {@link serializeOnSqlite} needs. */
export interface SerializingAdapter {
  getCapabilities(): { dialect: string };
  transaction<R>(work: () => Promise<R>): Promise<R>;
}

/**
 * Run a write that must not be undone by another request's rollback.
 *
 * On SQLite every request shares the one connection, so a plain statement
 * issued while another request's transaction is open runs inside that
 * transaction, and its rollback undoes it: a deleted refresh row comes back,
 * a failed-attempt count returns to zero. Run through the adapter's own
 * transaction, the write queues behind the open one instead, and commits on
 * its own. A call already inside a transaction this request opened nests in
 * it as a savepoint, and stands or falls with it, as it should.
 *
 * PostgreSQL and MySQL give each statement a pooled connection of its own,
 * where another transaction cannot reach it, so there `work` runs directly.
 */
export function serializeOnSqlite<T>(
  adapter: SerializingAdapter,
  work: () => Promise<T>
): Promise<T> {
  if (adapter.getCapabilities().dialect !== "sqlite") return work();
  return runAdapterTransaction(run => adapter.transaction(() => run()), work);
}

/** The adapter surface {@link afterCommit} needs. */
export interface AfterCommitAdapter {
  afterCommit(
    effect: () => unknown,
    onDeferredFailure?: (error: unknown) => void
  ): Promise<void>;
}

/**
 * Run what a write does outside the database — an event, an after-hook, a
 * cache flush, a webhook drain — once that write is durable.
 *
 * Call it after the service's own transaction has resolved. On PostgreSQL and
 * MySQL that transaction had its own connection and has committed, so
 * `effect` runs now and its failure reaches the caller as before. On SQLite a
 * service called inside an enclosing transaction (a plugin's
 * `ctx.db.transaction`) wrote in a savepoint that the enclosing transaction
 * can still roll back: `effect` then waits for the outermost commit, never
 * runs for a change that was rolled back, and a failure after that commit is
 * logged rather than thrown, since the caller has long had its answer.
 */
export function afterCommit(
  adapter: AfterCommitAdapter,
  effect: () => unknown
): Promise<void> {
  return adapter.afterCommit(effect, error => {
    getNextlyLogger().error({
      kind: "after-commit-effect-failed",
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
