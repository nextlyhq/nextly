/**
 * Statements that escape an open transaction, caught as the suites run.
 *
 * On PostgreSQL and MySQL a transaction holds one pooled connection. Anything
 * the same flow takes from the pool while it is open, such as a query through a
 * pool-bound handle, a nested transaction or a helper that never received the
 * `tx`, runs on another connection: outside the transaction, blind to its
 * uncommitted writes, kept when it rolls back, and able to stall a small pool.
 * SQLite has one connection, so the same code passes there, which is why
 * nothing noticed.
 *
 * The adapters report each such pool access to the observer installed here
 * (`DrizzleAdapter.notePoolAccess`). The setup file fails the test that caused
 * one, naming its call site, unless the call site is listed below as a known
 * or deliberate escape. Each known one names the change that removes it, and
 * that change deletes its entry.
 *
 * Dependency-free, like `aborted-transaction-sightings`, because the setup
 * file it serves is loaded into every unit test as well.
 *
 * @module __tests__/transaction-escapes
 */

/** One escape, as the adapter reported it. */
export interface TransactionEscape {
  dialect: string;
  /** The first frame outside the adapters and dependencies: where to look. */
  site: string;
  stack: string;
}

/** An escape the run accepts, matched against any frame of its stack. */
interface AcceptedEscape {
  /** A substring of a stack frame (`<file>:` or a function name). */
  frame: string;
  /** Why it is accepted: deliberate, or known and waiting for its fix. */
  reason: string;
}

/**
 * Escapes the run accepts. A deliberate one stays; a known one names the
 * change that removes it and is deleted by that change.
 */
export const ACCEPTED_ESCAPES: readonly AcceptedEscape[] = [
  {
    frame: "open-transaction.integration.test.ts:",
    reason:
      "deliberate: opens a transaction nested in another to prove flow tracking survives it",
  },
  {
    frame: "transaction-one-connection.integration.test.ts:",
    reason:
      "deliberate: reads the sessions from another connection while a transaction is open, the detector's positive control",
  },
];

const OBSERVER = Symbol.for("nextly.transactionEscapeObserver");

/** Escapes reported since the last `takeTransactionEscapes`. */
const seen: TransactionEscape[] = [];

/**
 * The first frame that is neither the adapters, a dependency, Node itself nor
 * the test harness: the code that reached the pool.
 */
function callSiteOf(stack: string): string {
  const frames = stack
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/^at /, ""));
  const site = frames.find(
    frame =>
      !frame.includes("/packages/adapter-") &&
      !frame.includes("/node_modules/") &&
      !frame.includes("node:") &&
      !frame.includes("transaction-escapes.ts") &&
      // The test harness's own wrapper around every transaction callback.
      !frame.includes("/plugins/test-nextly.")
  );
  return site ?? frames[0] ?? "(no stack)";
}

/** Installs the observer the adapters report to. Idempotent. */
export function installTransactionEscapeObserver(): void {
  (globalThis as Record<symbol, unknown>)[OBSERVER] = (report: {
    dialect: string;
    stack: string;
  }): void => {
    const accepted = ACCEPTED_ESCAPES.find(entry =>
      report.stack.includes(entry.frame)
    );
    if (accepted !== undefined) return;
    seen.push({
      dialect: report.dialect,
      site: callSiteOf(report.stack),
      stack: report.stack,
    });
  };
}

/** The escapes reported since the last call, removing them from the buffer. */
export function takeTransactionEscapes(): TransactionEscape[] {
  return seen.splice(0, seen.length);
}

/**
 * The failure message for `escapes`, or undefined when there are none. Each
 * call site once, with how many times it escaped and the full stack of the
 * first, since the site alone does not always say which path led there.
 */
export function describeTransactionEscapes(
  escapes: readonly TransactionEscape[]
): string | undefined {
  if (escapes.length === 0) return undefined;
  const bySite = new Map<string, TransactionEscape[]>();
  for (const escape of escapes) {
    const key = `${escape.dialect} ${escape.site}`;
    bySite.set(key, [...(bySite.get(key) ?? []), escape]);
  }
  const lines = [...bySite.entries()].map(
    ([key, group]) =>
      `- ${key} (${String(group.length)}x)\n${group[0].stack
        .split("\n")
        .slice(1, 12)
        .join("\n")}`
  );
  return (
    `${String(escapes.length)} statement(s) ran on another connection while ` +
    `their flow held an open transaction: outside it, blind to its writes and ` +
    `kept on rollback. Pass the transaction's \`tx\` down to them, or list the ` +
    `call site in ACCEPTED_ESCAPES (src/__tests__/transaction-escapes.ts) with ` +
    `why.\n${lines.join("\n")}`
  );
}
