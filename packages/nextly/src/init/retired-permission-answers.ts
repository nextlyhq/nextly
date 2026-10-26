/**
 * Emptying the retired `user_permission_cache` table while it still exists.
 *
 * Nothing in this release reads the table: a user's access is kept in memory
 * and retired by the role version. An instance still running a release that
 * reads it can share the database during an upgrade, though, including one
 * that skipped the release in between. Such an instance answers from a stored
 * row until the row's own expiry, and the role version tells it only to drop
 * what it holds in memory. So every access change empties the table before the
 * version is published, for as long as the table is there; once `nextly
 * migrate` has dropped it, this does nothing.
 *
 * Declared by its owning-user column alone, as the retired sign-in tables
 * are: emptying it needs nothing else, and nothing here gives the schema
 * pipeline a table it could create again.
 *
 * @module init/retired-permission-answers
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { retiredOwnedTable } from "./retired-accounts-erasure";
import { hasRetiredShape, liveColumnsOf } from "./retired-auth-tables";

/** The retired table this module empties; named here alone. */
const RETIRED_PERMISSION_ANSWERS_TABLE = "user_permission_cache";

/** The part of an adapter this module uses. */
export interface PermissionAnswersStore {
  readonly dialect: SupportedDialect;
  tableExists(table: string): Promise<boolean>;
  getDrizzle(): unknown;
}

/** The one statement this module runs: a delete of every row. */
interface RowDeleter {
  delete(table: unknown): PromiseLike<unknown>;
}

/** What emptying the stored answers asks of the database. */
export interface StoredAnswersOps {
  tableExists(table: string): Promise<boolean>;
  columnsOf(table: string): Promise<string[]>;
  /** Delete every row of the stored answers. */
  deleteAll(): PromiseLike<unknown>;
}

/**
 * Delete every stored answer, if the table is still there in the shape Nextly
 * created it.
 *
 * A table that only shares the name is not Nextly's: a host app sharing the
 * database may own one, and emptying it would delete that app's rows. It is
 * left alone, as the startup report and the drop leave it.
 *
 * Every row, whatever the change: a stored answer is a copy, recomputed by
 * whichever instance asks next, and naming the rows a change reaches would
 * take the same reads the copies were made to save. Throws when the table is
 * there and cannot be emptied, so the caller can withhold the version.
 */
export async function emptyRetiredPermissionAnswers(
  store: PermissionAnswersStore
): Promise<void> {
  const table = retiredOwnedTable(
    RETIRED_PERMISSION_ANSWERS_TABLE,
    store.dialect
  );
  await emptyStoredAnswers({
    tableExists: name => store.tableExists(name),
    columnsOf: liveColumnsOf(store.getDrizzle(), store.dialect),
    deleteAll: () => (store.getDrizzle() as RowDeleter).delete(table),
  });
}

/** The decision itself, over the operations it asks of the database. */
export async function emptyStoredAnswers(ops: StoredAnswersOps): Promise<void> {
  const name = RETIRED_PERMISSION_ANSWERS_TABLE;
  if (!(await ops.tableExists(name))) return;
  if (!hasRetiredShape(name, await ops.columnsOf(name))) return;
  try {
    await ops.deleteAll();
  } catch (error) {
    // `nextly migrate` can drop the table between the checks above and the
    // delete. Gone, it holds nothing a reader could serve, so this is the
    // emptying succeeding, not failing: failing would withhold the version
    // from every instance for a table nobody can read any more.
    if (!(await ops.tableExists(name))) return;
    throw error;
  }
}
