/**
 * The link from a transaction handle a plugin holds to the adapter transaction
 * behind it, so core code a plugin calls with `{ tx }` writes inside the
 * plugin's own transaction and commits or rolls back with it.
 *
 * `ctx.db.transaction` hands its callback a restricted surface, and the plugin
 * cannot reach the adapter's transaction through it. Core code can, through
 * this module alone: the surface is registered here when it is built, with the
 * adapter transaction it runs on and the scope that knows whether that
 * transaction is still open. Anything not registered (a forged object, a
 * `ctx.db.raw` handle, the pooled `ctx.db`) is refused rather than written
 * through, and so is a handle whose transaction has finished, so a core write
 * never lands outside the transaction the plugin meant.
 *
 * @module plugins/database/plugin-transaction-link
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";

/** What core code needs from a plugin's open transaction. */
export interface LinkedTransaction {
  /**
   * Run `work` on the plugin's transaction. Refused once the transaction has
   * finished; counted among its statements in flight while it runs, so the
   * transaction waits for it before it ends, and its failure rolls the
   * transaction back.
   */
  run<R>(work: (tx: TransactionContext) => Promise<R>): Promise<R>;
  /**
   * Run `work` on the plugin's transaction so that its failure is its own,
   * for a write whose caller carries on past its failure — a record written
   * fail-safe, beside the plugin's work rather than as part of it.
   *
   * On PostgreSQL a failed statement aborts the whole transaction, and every
   * later statement and the commit with it, so a failure caught and carried
   * past would take the plugin's writes down with it. Run under a savepoint,
   * the failure is rolled back to the savepoint instead and the transaction
   * stays usable. A plugin statement that started while `work` ran would be
   * rolled back with it, unseen, so then the transaction is failed instead:
   * its writes are not kept, and the plugin is told. Contained runs on one
   * transaction take turns, so one never rolls back another's write. Where
   * the transaction has no savepoints (MySQL, which keeps a transaction
   * usable after a failed statement), `work` runs as `run` runs it.
   */
  runContained<R>(work: (tx: TransactionContext) => Promise<R>): Promise<R>;
}

/** What `ctx.db.transaction` knows about the transaction it opened. */
interface TransactionScopeView {
  assertOpen(): void;
  track<R>(work: PromiseLike<R>): Promise<R>;
  started(): number;
  fail(error: unknown): void;
}

const links = new WeakMap<object, LinkedTransaction>();

/** Savepoint names, unique within a process so nested ones never collide. */
let savepointSequence = 0;

/**
 * Register the surface `ctx.db.transaction` hands its callback, with the
 * adapter transaction it runs on. Called once, where that surface is built.
 */
export function linkPluginTransaction(
  surface: object,
  tx: TransactionContext,
  scope: TransactionScopeView
): void {
  // The contained run before which the next one waits, and how many have
  // been asked for: each is tracked as a statement, and one waiting its turn
  // is not a plugin statement that a rollback to a savepoint could undo.
  let lastContained: Promise<unknown> = Promise.resolve();
  let containedCount = 0;
  links.set(surface, {
    // Async so a refusal, or work that throws before it returns its promise,
    // rejects rather than throws, as every other path does. Nothing here
    // awaits before `track`, so the check and the tracking still happen as
    // the call is made: a transaction cannot finish in between.
    async run<R>(work: (tx: TransactionContext) => Promise<R>): Promise<R> {
      scope.assertOpen();
      return scope.track(work(tx));
    },
    async runContained<R>(
      work: (tx: TransactionContext) => Promise<R>
    ): Promise<R> {
      scope.assertOpen();
      containedCount += 1;
      const others = (): number => scope.started() - containedCount;
      const turn = lastContained.then(() =>
        runUnderSavepoint(tx, scope, others, work)
      );
      lastContained = turn.catch(() => undefined);
      return scope.track(turn);
    },
  });
}

/**
 * Run `work` under a savepoint of `tx`, rolling back to it when `work` fails;
 * see {@link LinkedTransaction.runContained}. `others` counts the plugin's
 * statements started so far.
 */
async function runUnderSavepoint<R>(
  tx: TransactionContext,
  scope: TransactionScopeView,
  others: () => number,
  work: (tx: TransactionContext) => Promise<R>
): Promise<R> {
  if (!tx.savepoint || !tx.rollbackToSavepoint || !tx.releaseSavepoint) {
    return work(tx);
  }
  savepointSequence += 1;
  const name = `nextly_contained_${savepointSequence}`;
  // Read as the savepoint is asked for: a statement started before this
  // reached the connection ahead of it, and nothing rolls it back.
  const before = others();
  await tx.savepoint(name);
  let result: R;
  try {
    result = await work(tx);
  } catch (error) {
    try {
      await tx.rollbackToSavepoint(name);
      await tx.releaseSavepoint(name);
    } catch (rollbackError) {
      // The transaction is in no known state, so none of it is kept.
      scope.fail(rollbackError);
      throw error;
    }
    if (others() !== before) scope.fail(undoneStatementError());
    throw error;
  }
  await tx.releaseSavepoint(name);
  return result;
}

/**
 * Why a transaction is failed when rolling a contained write back to its
 * savepoint undid a statement the plugin started meanwhile: that statement
 * reported success, and its write is gone.
 */
function undoneStatementError(): NextlyError {
  return NextlyError.internal({
    logContext: {
      reason: "plugin-transaction-statement-undone",
      detail:
        "A core write in this transaction failed and was rolled back to its savepoint, undoing a statement the plugin started while it ran.",
    },
  });
}

/**
 * The open transaction behind `handle`, which must be the handle a plugin's
 * `ctx.db.transaction` callback received. Throws a validation error naming
 * `operation` for anything else.
 */
export function linkedTransaction(
  handle: unknown,
  operation: string
): LinkedTransaction {
  const link =
    typeof handle === "object" && handle !== null
      ? links.get(handle)
      : undefined;
  if (link) return link;
  throw NextlyError.validation({
    errors: [
      {
        path: "tx",
        code: "INVALID_TRANSACTION",
        message:
          "`tx` must be the handle `ctx.db.transaction` passes its callback.",
      },
    ],
    logContext: { operation },
  });
}
