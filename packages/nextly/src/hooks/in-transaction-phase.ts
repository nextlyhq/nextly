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
 * loads it and every module that writes stays as light as it was. A write
 * asks the registry once and keeps the answer, an
 * {@link InTransactionHandlerSet}: the same set decides how much of the
 * document the write assembles and which handlers it runs, so a handler
 * registered meanwhile waits for the next write rather than being handed a
 * document assembled for none.
 *
 * @module hooks/in-transaction-phase
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../errors/nextly-error";
import { getNextlyLogger } from "../observability/logger";
import { markWriteIntegrityFailure } from "../shared/write-integrity";

import { runWatched, watchOutboundCalls } from "./in-transaction-outbound";
import { normalizeHookError } from "./normalize-hook-error";
import type {
  HookOwner,
  InTransactionRunner,
  InTransactionWrite,
} from "./types";

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

/**
 * The in-transaction handlers one write runs, taken from the registry once per
 * write ('*' ones first, then the collection's own, suspended owners left out),
 * each with its owner, whom the outbound-call warning names.
 *
 * @internal
 */
export type InTransactionHandlerSet = ReadonlyArray<{
  readonly handler: InTransactionRunner;
  readonly owner: HookOwner;
}>;

/** What a write hands the phase: its shared context is copied and frozen here. */
export type InTransactionPhaseInput = Omit<InTransactionWrite, "context"> & {
  context: Record<string, unknown>;
};

/** What a write with nothing in its shared context hands every handler. */
const EMPTY_CONTEXT: Readonly<Record<string, unknown>> = Object.freeze({});

/** Marks a value {@link copyPlainData} leaves out. */
const LEFT_OUT = Symbol("left out");

/**
 * Run a write's in-transaction handlers on its transaction, in the order of
 * the set the write took. What a handler returns is ignored.
 *
 * Every handler sees the same {@link detachedContext} of the shared hook
 * context, made afresh on each call, so state a handler wanted to carry
 * cannot leak from a discarded attempt into the one that commits, nor into
 * the hooks that run after it.
 *
 * A failure is thrown as the write's own failure, normalized as every phase's
 * is (a `NextlyError` keeps its code and status, anything else becomes an
 * internal error), and marked a write-integrity failure: a batch of writes
 * sharing one transaction stops there rather than committing the entry
 * without what its handler failed to write, since MySQL cannot undo one
 * entry's part of a shared transaction.
 */
export async function runInTransactionPhase(
  entries: InTransactionHandlerSet,
  tx: TransactionContext,
  input: InTransactionPhaseInput
): Promise<void> {
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
    context: detachedContext(input.context),
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

/**
 * A detached, deeply frozen copy of a write's shared hook context, for one
 * attempt's handlers.
 *
 * Only plain data is copied: primitives, arrays, and objects whose prototype
 * is `Object.prototype` or `null`, at any depth. Anything else (a class
 * instance, a function, a `Date`, a `Map`, a `Set`, a typed array) is left
 * out, as is a reference back to an object that encloses it: a key holding
 * one is absent from the copy, and an array slot holding one reads
 * `undefined`. Failing closed this way, a handler is never handed a reference
 * through which it could change what a retried attempt or a later hook sees.
 *
 * Costs nothing for an empty context, and a walk of the values otherwise.
 */
export function detachedContext(
  context: Record<string, unknown>
): Readonly<Record<string, unknown>> {
  if (Object.keys(context).length === 0) return EMPTY_CONTEXT;
  const copy = copyPlainData(context, new Set());
  return copy === LEFT_OUT ? EMPTY_CONTEXT : (copy as Record<string, unknown>);
}

/** `value` copied and frozen when it is plain data, else {@link LEFT_OUT}. */
function copyPlainData(value: unknown, enclosing: Set<object>): unknown {
  if (typeof value === "function") return LEFT_OUT;
  if (typeof value !== "object" || value === null) return value;
  if (enclosing.has(value)) return LEFT_OUT;
  const proto: unknown = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype) return LEFT_OUT;
    enclosing.add(value);
    const items: unknown[] = [];
    for (const item of value as unknown[]) {
      const copied = copyPlainData(item, enclosing);
      items.push(copied === LEFT_OUT ? undefined : copied);
    }
    enclosing.delete(value);
    return Object.freeze(items);
  }
  if (proto !== Object.prototype && proto !== null) return LEFT_OUT;
  enclosing.add(value);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const copied = copyPlainData(
      (value as Record<string, unknown>)[key],
      enclosing
    );
    if (copied !== LEFT_OUT) out[key] = copied;
  }
  enclosing.delete(value);
  return Object.freeze(out);
}
