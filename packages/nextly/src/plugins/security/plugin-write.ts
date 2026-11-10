/**
 * Where a plugin security helper's write runs: on the plugin's own
 * transaction when it passed one (`{ tx }`), else in a transaction of its
 * own, never as a lone statement. Called without one while the calling flow
 * has a transaction open, the write is refused rather than silently joining
 * it, or, on PostgreSQL and MySQL, running beside it on another connection.
 *
 * One helper for every `ctx.security` write, so the one-purpose secrets and
 * the received-webhook claims answer this the same way.
 *
 * @module plugins/security/plugin-write
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { assertNoOpenTransaction } from "../../shared/lib/open-transaction";
import type { PluginTransaction } from "../database/plugin-database";
import { linkedTransaction } from "../database/plugin-transaction-link";

/** What a write needs from the database adapter. */
type PluginWriteAdapter = Pick<
  DrizzleAdapter,
  "transaction" | "transactionOpenInFlow"
>;

/**
 * Run `work` on `tx` when the plugin passed one, else in a transaction of its
 * own on the adapter resolved now, refused when the calling flow has one open.
 */
function runPluginWrite<R>(
  adapter: () => PluginWriteAdapter,
  operation: string,
  tx: PluginTransaction | undefined,
  work: (adapterTx: TransactionContext) => Promise<R>
): Promise<R> {
  if (tx !== undefined) return linkedTransaction(tx, operation).run(work);
  const resolved = adapter();
  assertNoOpenTransaction(resolved, operation);
  return resolved.transaction(work);
}

/** A helper's own `write`: `runPluginWrite` on the adapter it was built with. */
type PluginWrite = <R>(
  operation: string,
  tx: PluginTransaction | undefined,
  work: (adapterTx: TransactionContext) => Promise<R>
) => Promise<R>;

/** The `write` a helper built on `adapter` runs every write through. */
export function pluginWriter(adapter: () => PluginWriteAdapter): PluginWrite {
  return (operation, tx, work) => runPluginWrite(adapter, operation, tx, work);
}
