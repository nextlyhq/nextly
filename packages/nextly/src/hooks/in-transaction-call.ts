/**
 * How a write calls the in-transaction phase: the one entry every write path
 * uses, collections and Singles alike, so they ask the same question before
 * the phase loads and hand it the same shapes.
 *
 * Light on purpose. It imports the phase only with `await import()`, once a
 * handler is registered for the write's target, so every module that writes
 * stays as light as it was before the phase existed.
 *
 * A write asks for its handlers once ({@link inTransactionHandlersFor}) and
 * keeps the set: the same set decides how much of the document the write
 * assembles and which handlers it runs, so a handler registered meanwhile
 * waits for the next write instead of being handed a document assembled for
 * none.
 *
 * @module hooks/in-transaction-call
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { HookRegistry } from "./hook-registry";
import type {
  InTransactionHandlerSet,
  InTransactionPhaseInput,
} from "./in-transaction-phase";

/** What a write hands {@link runInTransactionPhaseFor}. */
export type InTransactionCall = Omit<
  InTransactionPhaseInput,
  "data" | "originalData"
> & {
  /** Undefined when the write found no row: nothing was written. */
  data: Record<string, unknown> | undefined;
  /** The document before the write; null or absent when there was none. */
  originalData?: Record<string, unknown> | null;
};

/** The handler set of a write no in-transaction handler is registered for. */
const NO_IN_TRANSACTION_HANDLERS: InTransactionHandlerSet = Object.freeze([]);

/**
 * The in-transaction handlers one write to `target` runs, asked of the
 * registry once: a write keeps the set for the assembly decision and the run.
 * A presence check first, so a write with none costs one question. A service
 * given no registry runs none.
 */
export function inTransactionHandlersFor(
  registry: HookRegistry | undefined,
  target: string
): InTransactionHandlerSet {
  return registry?.hasInTransaction(target)
    ? registry.inTransactionEntries(target)
    : NO_IN_TRANSACTION_HANDLERS;
}

/**
 * Run the in-transaction phase for one write on its transaction, with the
 * handlers the write took. A write that found nothing to write, or took no
 * handler, runs no phase and loads nothing, so it does exactly what it did
 * before the phase existed.
 */
export async function runInTransactionPhaseFor(
  handlers: InTransactionHandlerSet,
  tx: TransactionContext,
  call: InTransactionCall
): Promise<void> {
  if (call.data === undefined || handlers.length === 0) return;
  const { runInTransactionPhase } = await import("./in-transaction-phase");
  await runInTransactionPhase(handlers, tx, {
    ...call,
    data: call.data,
    originalData: call.originalData ?? undefined,
  });
}

/** A held working draft, marked so it reads as one rather than as live. */
export function markedDraft(
  draft: Record<string, unknown>
): Record<string, unknown> {
  return { ...draft, _isWorkingDraft: true };
}

/**
 * What an update wrote, as an in-transaction handler is shown it: the pending
 * draft, marked, when the edit was held as one, else the document the write
 * left. One answer for every update path, collection or Single.
 */
export function writtenByUpdate(
  updated: Record<string, unknown>,
  draft: Record<string, unknown> | undefined
): Record<string, unknown> {
  return draft ? markedDraft(draft) : updated;
}

/**
 * What an update replaced, as an in-transaction handler is shown it: on a save
 * that accumulated onto a working draft, that prior draft, marked, as the
 * hooks compare against; else the document before the write. One answer for
 * every update path, collection or Single.
 */
export function replacedByUpdate<T>(
  previous: T,
  priorDraft: Record<string, unknown> | undefined
): T | Record<string, unknown> {
  return priorDraft ? markedDraft(priorDraft) : previous;
}
