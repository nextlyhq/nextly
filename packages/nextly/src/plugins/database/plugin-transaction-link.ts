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
}

/** What `ctx.db.transaction` knows about the transaction it opened. */
interface TransactionScopeView {
  assertOpen(): void;
  track<R>(work: PromiseLike<R>): Promise<R>;
}

const links = new WeakMap<object, LinkedTransaction>();

/**
 * Register the surface `ctx.db.transaction` hands its callback, with the
 * adapter transaction it runs on. Called once, where that surface is built.
 */
export function linkPluginTransaction(
  surface: object,
  tx: TransactionContext,
  scope: TransactionScopeView
): void {
  links.set(surface, {
    // Async so a refusal, or work that throws before it returns its promise,
    // rejects rather than throws, as every other path does. Nothing here
    // awaits before `track`, so the check and the tracking still happen as
    // the call is made: a transaction cannot finish in between.
    async run<R>(work: (tx: TransactionContext) => Promise<R>): Promise<R> {
      scope.assertOpen();
      return scope.track(work(tx));
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
