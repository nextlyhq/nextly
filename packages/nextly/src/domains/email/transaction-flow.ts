/**
 * Whether the calling flow has a transaction open on this adapter.
 *
 * The email services are never handed a caller's transaction, so a read they
 * make while one is open runs on another connection, outside it. What they
 * read on the render path (the engine state, the brand settings) is kept as a
 * snapshot for exactly that case, and this says when to answer from it. An
 * adapter that can't say (a hand-built one; the check is experimental) counts
 * as having none, so the table is read as before.
 *
 * @module domains/email/transaction-flow
 */
export function transactionOpenInFlow(adapter: unknown): boolean {
  const check = (adapter as { transactionOpenInFlow?: () => boolean } | null)
    ?.transactionOpenInFlow;
  return typeof check === "function" && check.call(adapter);
}
