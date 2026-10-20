/**
 * A record a caller asks a content write to keep in its own transaction.
 *
 * Some callers need to know afterwards, durably, that a write committed: the
 * releases drain must not write a document a second time after a pass the
 * host ended part-way, and the promise a write returns says nothing once that
 * process is gone. A row the caller writes AFTER the commit leaves a window in
 * which the write committed and the record did not; a row it writes INSIDE the
 * write's transaction commits or rolls back with it, so it is the write's own
 * receipt rather than a second account of it.
 *
 * The content write paths run their own transactions and take no outside work,
 * so the caller pins the receipt for the length of the write and the write
 * path performs it before its transaction ends. `AsyncLocalStorage`, as
 * `request-scope.ts` pins a request: writes run concurrently, and a module
 * variable would hand one write's receipt to another.
 *
 * A receipt names the one document it is for, so a write to any other
 * document made while it is pinned (a hook writing elsewhere, say) leaves it
 * alone.
 *
 * @module shared/lib/write-receipt
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

/** The document a receipt is for. */
export interface WriteReceiptTarget {
  scopeKind: "collection" | "single";
  scopeSlug: string;
  /**
   * The entry, for a collection document. A Single is one document per slug,
   * so its receipt matches on the slug alone: its row id can be created by the
   * very write the receipt is for.
   */
  entryId: string;
}

/** What the write left on the live row, as its own transaction stored it. */
export interface WrittenState {
  /** The stored `status` after the write, or undefined where there is none. */
  status: string | undefined;
}

export interface WriteReceipt {
  target: WriteReceiptTarget;
  /**
   * Called inside the write's transaction, once the live row is written. Its
   * writes commit or roll back with the content write.
   *
   * May run more than once for one write: a write that loses a version race
   * runs its transaction again, and the earlier attempt rolled back. So it
   * must be idempotent, and only the attempt that commits counts.
   */
  record(tx: TransactionContext, written: WrittenState): Promise<void>;
}

const receiptScope = new AsyncLocalStorage<WriteReceipt>();

/** Run `operation` with `receipt` pinned for the content write inside it. */
export function runWithWriteReceipt<T>(
  receipt: WriteReceipt,
  operation: () => T
): T {
  return receiptScope.run(receipt, operation);
}

/**
 * Perform the pinned receipt, inside the write's transaction, when it is for
 * the document this write changed. Nothing happens when no receipt is pinned,
 * which is every write but the ones a caller asked a record of.
 *
 * Called by a write path only once it has written the live row: a change held
 * as a working draft leaves the live document as it was, so it is not the
 * write a receipt records.
 */
export async function recordWriteReceipt(
  tx: TransactionContext,
  target: WriteReceiptTarget,
  written: WrittenState
): Promise<void> {
  const receipt = receiptScope.getStore();
  if (receipt === undefined) return;
  const pinned = receipt.target;
  if (pinned.scopeKind !== target.scopeKind) return;
  if (pinned.scopeSlug !== target.scopeSlug) return;
  if (target.scopeKind === "collection" && pinned.entryId !== target.entryId) {
    return;
  }
  await receipt.record(tx, written);
}
