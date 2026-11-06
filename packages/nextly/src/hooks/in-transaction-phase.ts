/**
 * The in-transaction hook phase: the handlers that run last inside a write's
 * own transaction, before it commits.
 *
 * The four timings a write offers, in order:
 *
 * 1. before the write (`beforeOperation`, `before*`, `beforeChange`);
 * 2. in the transaction: this phase, which a version-conflict retry runs again
 *    with each attempt;
 * 3. after the commit, once (`after*`, the collection event);
 * 4. after the response is shaped (field `afterChange`).
 *
 * A handler's writes through the transaction it is handed commit or roll back
 * with the entry, so a plugin can keep a row of its own exactly in step with
 * the entry it describes. A handler that throws aborts the write: the error
 * reaches the caller with its own status, and nothing of the write is kept.
 *
 * Loaded on first use, by a write that has a handler to run
 * (`HookRegistry.hasInTransaction`), so a process that registers none never
 * loads it and every module that writes stays as light as it was.
 *
 * @module hooks/in-transaction-phase
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../errors/nextly-error";
import { getNextlyLogger } from "../observability/logger";
import { markWriteIntegrityFailure } from "../shared/write-integrity";

import type { HookRegistry } from "./hook-registry";
import { runWatched, watchOutboundCalls } from "./in-transaction-outbound";
import { normalizeHookError } from "./normalize-hook-error";
import type { InTransactionWrite } from "./types";

/**
 * How deeply the phase may nest. A handler may write through the Direct API
 * or `ctx.services`, and that write runs its own phase inside the same
 * transaction, whose handlers may write again. Two handlers that each write to
 * the other's collection would otherwise recurse until the stack overflowed,
 * holding the transaction open the whole time.
 */
export const MAX_IN_TRANSACTION_DEPTH = 8;

/** How many phases enclose the current one, in this flow. */
const phaseDepth = new AsyncLocalStorage<number>();

/** What a write hands the phase: its shared context is copied and frozen here. */
export type InTransactionPhaseInput = Omit<InTransactionWrite, "context"> & {
  context: Record<string, unknown>;
};

/**
 * Run a write's in-transaction handlers on its transaction: the '*' ones
 * first, then the collection's own, each in registration order. What a
 * handler returns is ignored.
 *
 * Every handler sees the same frozen copy of the shared hook context, made
 * afresh on each call, so state a handler wanted to carry cannot leak from a
 * discarded attempt into the one that commits.
 *
 * A failure is thrown as the write's own failure, normalized as every phase's
 * is (a `NextlyError` keeps its code and status, anything else becomes an
 * internal error), and marked a write-integrity failure: a batch of writes
 * sharing one transaction stops there rather than committing the entry
 * without what its handler failed to write, since MySQL cannot undo one
 * entry's part of a shared transaction.
 */
export async function runInTransactionPhase(
  registry: HookRegistry,
  tx: TransactionContext,
  input: InTransactionPhaseInput
): Promise<void> {
  const entries = registry.inTransactionEntries(input.collection);
  if (entries.length === 0) return;
  // In development, a handler that calls out of the process is told so: the
  // call is not undone with a discarded attempt. A no-op anywhere else.
  watchOutboundCalls(getNextlyLogger());

  const depth = (phaseDepth.getStore() ?? 0) + 1;
  if (depth > MAX_IN_TRANSACTION_DEPTH) {
    throw markWriteIntegrityFailure(
      NextlyError.internal({
        logContext: {
          reason: "in-transaction-phase-too-deep",
          collection: input.collection,
          operation: input.operation,
          maxDepth: MAX_IN_TRANSACTION_DEPTH,
        },
      })
    );
  }

  const write: InTransactionWrite = {
    ...input,
    context: Object.freeze({ ...input.context }),
  };
  await phaseDepth.run(depth, async () => {
    for (const { handler, owner } of entries) {
      try {
        await runWatched(owner, () => handler(tx, write));
      } catch (error: unknown) {
        throw markWriteIntegrityFailure(
          normalizeHookError(error, "inTransaction", input.collection, {
            operation: input.operation,
          })
        );
      }
    }
  });
}
