/**
 * Running a record's write in the transaction its decision needs, for every
 * writer whose rows can name a plugin-defined person: the audit log and the
 * email delivery log.
 *
 * One routine for both, because the rule is one rule. A write that decides
 * from a lock is only worth anything inside a transaction; on SQLite the
 * adapter's transaction is what queues it behind another request's open one;
 * and a write made where a plugin's own transaction holds the deleted-people
 * lock has to join that transaction, or each waits on the other.
 *
 * @module domains/audit/person-write
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { pluginTransactionInFlow } from "../../plugins/database/plugin-transaction-in-flow";
import { linkedTransaction } from "../../plugins/database/plugin-transaction-link";
import {
  serializeOnSqlite,
  type SerializingAdapter,
} from "../../shared/lib/run-adapter-transaction";

import { holdsDeletionLock } from "./principal-digest";

/** A database handle that can open a transaction over the same surface. */
interface TransactionalDb<Db> {
  transaction<T>(work: (tx: Db) => Promise<T>): Promise<T>;
}

/**
 * Run `write` in the transaction its decision needs.
 *
 * - **SQLite**: through the adapter's transaction, which queues it behind
 *   another request's open transaction rather than letting it run inside one,
 *   whose rollback would undo it, and whose `BEGIN IMMEDIATE` holds the write
 *   lock across the decision and the write. Inside the caller's own
 *   transaction it nests there.
 * - **A plugin transaction holding the deleted-people lock** in the calling
 *   flow: inside that transaction, since one of its own would wait for the
 *   plugin's commit while the plugin waits for the write. Contained there
 *   (`runContained`): both writers record fail-safe and carry on past a
 *   failure, and on PostgreSQL a failed statement left in the plugin's
 *   transaction would abort it, so its commit would roll back the plugin's
 *   deletion and its report while the plugin was told they committed.
 * - **A write naming a person, or one taking another lock**: in a transaction
 *   of its own, which holds the lock until it commits.
 * - Otherwise directly.
 *
 * @param operation - What a refused linked transaction names.
 */
export async function runLockedWrite<Db, R>(
  adapter: SerializingAdapter,
  db: unknown,
  dialect: SupportedDialect,
  write: (executor: Db) => Promise<R>,
  needs: { namesPerson: boolean; needsLock: boolean },
  operation: string
): Promise<R> {
  if (dialect === "sqlite") {
    return serializeOnSqlite(adapter, () => write(db as Db));
  }
  const reporting = needs.namesPerson ? reportingTransaction() : undefined;
  if (reporting) {
    return linkedTransaction(reporting, operation).runContained(tx =>
      write(tx.getDrizzle<Db>())
    );
  }
  if (needs.namesPerson || needs.needsLock) {
    return (db as TransactionalDb<Db>).transaction(tx => write(tx));
  }
  return write(db as Db);
}

/**
 * The plugin transaction the calling flow is inside, when it holds the
 * deleted-people lock; undefined otherwise.
 */
function reportingTransaction(): object | undefined {
  const handle = pluginTransactionInFlow();
  return handle !== undefined && holdsDeletionLock(handle) ? handle : undefined;
}
