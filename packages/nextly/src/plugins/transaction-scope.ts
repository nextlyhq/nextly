/**
 * How long the handle a plugin transaction passes its work stays usable, and
 * what the transaction's outcome is once that work and everything it started
 * has finished.
 *
 * @module plugins/transaction-scope
 */

import { NextlyError } from "../errors/nextly-error";

/**
 * The method a plugin author called to open the transaction, named in the
 * refusal so the message points at the callback the work belongs in.
 */
export type PluginTransactionMethod =
  | "ctx.db.transaction"
  | "ctx.db.raw.transaction"
  | "ctx.services.collections.withTransaction";

/**
 * The refusal for the handle a transaction passed its work, used once that
 * work has settled.
 *
 * By then the transaction has committed or rolled back, and its handle is
 * bound to a connection it no longer owns: on SQLite a statement through it
 * runs on the shared connection outside any transaction, and on PostgreSQL
 * and MySQL on a client already returned to the pool, possibly to another
 * request. `logContext.reason` tells it apart from a failure of the work
 * itself, and from a token that was never a transaction's: the handle is
 * genuine, the work merely ran too late. Built here, for every transaction a
 * plugin holds, so one refusal has one shape.
 */
export function transactionFinishedError(
  method: PluginTransactionMethod
): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: "tx",
        code: "INVALID",
        message: `This transaction has already finished: do this work inside the callback you passed to ${method}.`,
      },
    ],
    logContext: { reason: "plugin-transaction-finished" },
  });
}

/** The lifetime of one transaction's handle; see {@link transactionScope}. */
export interface TransactionScope {
  /** Throws the finished refusal once the scope has closed. */
  assertOpen: () => void;
  /**
   * Records a statement started on the handle, and returns a promise that
   * settles as it does. The caller's promise is derived from the recorded
   * one rather than being it, so a failure the caller never handles still
   * reaches Node's unhandled-rejection report.
   */
  track: <R>(work: PromiseLike<R>) => Promise<R>;
  /**
   * How many statements `track` has recorded so far, so work that must not
   * overlap another statement can tell whether one started while it ran.
   */
  started: () => number;
  /**
   * Records a failure the transaction must roll back for, though nobody
   * awaiting a statement saw it: `run` then rejects with it once the work and
   * its statements have settled. The first one recorded is the one reported.
   */
  fail: (error: unknown) => void;
  /**
   * Runs the transaction's work and decides what the transaction resolves
   * to: the work's own result, or the error that must roll it back.
   */
  run: <R>(work: () => Promise<R>) => Promise<R>;
}

/**
 * The lifetime of the handle a transaction passes its work: open while the
 * work runs, closed for good once it has settled and every statement it
 * started has finished.
 *
 * Closing when the work settles is not enough, because a statement is two
 * steps apart: its handle is read when the call is made, and the statement
 * reaches the driver on a later tick. A callback that starts `tx.insert(...)`
 * without awaiting it can return first. On PostgreSQL and MySQL any such
 * statement would then run after the commit, on a client already back in the
 * pool. On SQLite a single statement runs synchronously on better-sqlite3 and
 * cannot outlive the callback, but work of more than one step can — the
 * read-back `insertReturning` makes once its insert lands — and its later step
 * would run on the shared connection outside any transaction. So every
 * statement started on the handle is recorded, and `run` waits for all of
 * them before the transaction is allowed to end.
 *
 * `run` drains BEFORE it closes. A statement started while the work ran may
 * need the handle again after its first step, and closing first would refuse
 * that second step after the first had written. Anything that reaches the
 * handle during the drain still runs before the commit, inside the
 * transaction; once the drain finds nothing left, the handle refuses.
 *
 * A statement that fails WHILE `run` DRAINS decides the outcome: one still
 * in flight when the work settled, or one started during the drain. Nobody
 * else can act on that failure before the commit — the work has already
 * returned — and it is otherwise lost: on PostgreSQL the failed statement
 * aborts the transaction, so the COMMIT silently rolls back while the
 * transaction resolves, and on SQLite and MySQL the rest commits without it.
 * Rejecting with the first such failure, in the order the statements were
 * started, makes the adapter roll back on every dialect, and the caller
 * learns why.
 *
 * A statement that settled BEFORE the work settled is the work's business,
 * awaited or not. The work could see it and chose what to do: catching a
 * refusal and carrying on is legitimate, and through `withTransaction` the
 * refusal may be a service's validation error that never reached the
 * database. One it did not await and that failed early is still reported,
 * through the promise `track` handed back, as an unhandled rejection.
 *
 * If the work itself rejected, its error is the one that propagates — it is
 * what the author's own code saw — and the drain still finishes first, so
 * nothing the work started is left running when the rollback begins.
 *
 * A failure recorded through `fail` decides the outcome after those: core
 * code that ran inside the transaction records one when it could not keep
 * the transaction whole, and nothing the author awaited would show it.
 *
 * Shared by every transaction a plugin holds — `ctx.db.transaction`,
 * `ctx.db.raw.transaction` and `ctx.services.collections.withTransaction` —
 * so the handle each passes its work ends by one rule, and refuses with the
 * same error naming the method the author called.
 */
export function transactionScope(
  method: PluginTransactionMethod
): TransactionScope {
  let open = true;
  const inFlight = new Set<Promise<unknown>>();
  let startedCount = 0;
  const recorded: unknown[] = [];

  /**
   * Waits for every statement still in flight, and returns the failures
   * among them, in the order those statements were started. A statement
   * that settled earlier has already left the set, so it is not among them.
   */
  const drain = async (): Promise<unknown[]> => {
    const failures: unknown[] = [];
    // Looped because a statement settling can start another on the handle
    // (`insertReturning`'s read-back), which joins the set mid-drain.
    while (inFlight.size > 0) {
      for (const result of await Promise.allSettled([...inFlight])) {
        if (result.status === "rejected") failures.push(result.reason);
      }
    }
    return failures;
  };

  return {
    assertOpen() {
      if (!open) throw transactionFinishedError(method);
    },
    track<R>(work: PromiseLike<R>): Promise<R> {
      // `Promise.resolve` subscribes once, now. Drizzle's queries are lazy
      // thenables that run when first awaited and again on every later
      // await, so the one handed back is a settled-once native promise:
      // awaited after the transaction it cannot run a second time outside it.
      const running = Promise.resolve(work);
      startedCount += 1;
      inFlight.add(running);
      const forget = (): void => {
        inFlight.delete(running);
      };
      void running.then(forget, forget);
      // A fresh promise over the same outcome. Handing back `running`
      // itself would hand back a promise that already has a rejection
      // handler (the one above), and Node would never report a failure the
      // caller left unhandled.
      return running.then(value => value);
    },
    started: () => startedCount,
    fail(error: unknown) {
      recorded.push(error);
    },
    async run<R>(work: () => Promise<R>): Promise<R> {
      let outcome: { ok: true; value: R } | { ok: false; error: unknown };
      try {
        outcome = { ok: true, value: await work() };
      } catch (error) {
        outcome = { ok: false, error };
      }
      const drained = await drain();
      open = false;
      if (!outcome.ok) throw outcome.error;
      if (drained.length > 0) throw drained[0];
      if (recorded.length > 0) throw recorded[0];
      return outcome.value;
    },
  };
}
