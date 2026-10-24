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

/**
 * How long an instance answers what a send reads on every render (the
 * template engine state and the brand settings) from its own copy before
 * reading the table again: the longest a change another instance made can go
 * unseen by this one. Inside a caller's open transaction the copy is used
 * whatever its age, since a read there would run on another connection.
 */
export const SNAPSHOT_MAX_AGE_MS = 30_000;
