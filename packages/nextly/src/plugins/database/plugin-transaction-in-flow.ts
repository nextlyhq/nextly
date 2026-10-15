/**
 * Which plugin transaction, if any, the calling async flow is inside.
 *
 * Core code a plugin hands its `tx` to writes through that transaction
 * (`plugin-transaction-link`). Some core writes are not handed one and open
 * their own, and on PostgreSQL and MySQL their own is another connection. When
 * the plugin's transaction holds a row lock such a write needs, the write
 * waits for the plugin's commit while the plugin's callback waits for the
 * write, and neither database sees the cycle. A write that knows the flow's
 * transaction can join it instead.
 *
 * `AsyncLocalStorage`, so only the callback's own call chain is inside, while
 * other requests are served concurrently. The flow counts as inside only
 * until the callback settles: work it left running past that point is no
 * longer the callback's, and the transaction is about to end.
 *
 * @module plugins/database/plugin-transaction-in-flow
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface FlowTransaction {
  /** The handle `ctx.db.transaction` passed its callback. */
  handle: object;
  /** False once the callback has settled. */
  open: boolean;
}

const flowTransaction = new AsyncLocalStorage<FlowTransaction>();

/**
 * Run a plugin transaction's callback marked as inside the transaction whose
 * handle is `handle`.
 */
export async function runInPluginTransactionFlow<T>(
  handle: object,
  work: () => Promise<T>
): Promise<T> {
  const marker: FlowTransaction = { handle, open: true };
  try {
    return await flowTransaction.run(marker, work);
  } finally {
    marker.open = false;
  }
}

/**
 * The handle of the plugin transaction whose callback the calling flow is
 * running in, or undefined outside one or once that callback has settled.
 */
export function pluginTransactionInFlow(): object | undefined {
  const marker = flowTransaction.getStore();
  return marker?.open ? marker.handle : undefined;
}
