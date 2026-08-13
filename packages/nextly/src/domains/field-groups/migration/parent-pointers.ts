/**
 * The pointer an embedded instance stores back to the table it hangs off.
 *
 * `_parent_table` holds a **physical table name**, not a slug and not a foreign
 * key. A field group nested inside another one therefore addresses its parent by
 * the very name this migration changes, and a rename that moves the table
 * without moving the stored strings leaves the rows intact but unreachable: the
 * read path matches on `_parent_table` and treats a parent it cannot match as
 * *no rows* rather than as an error, so the content disappears silently.
 *
 * The rewrite itself belongs with the rename that makes it necessary, and lives
 * in `steps`. What lives here is the vocabulary both sides share and the
 * end-of-run sweep that refuses to call a run finished while any instance still
 * addresses a name the run renamed away.
 *
 * @module domains/field-groups/migration/parent-pointers
 */

import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import {
  indexCatalog,
  resolveCatalogName,
  type IdentifierCaseRules,
} from "../../schema/utils/resolve-catalog-name";

import type { ManifestEntry } from "./manifest";
import type { TableColumns } from "./reconcile";
import { REFUSAL_KIND_KEY, type RefusalKind } from "./refusal-kind";

/**
 * The column an embedded instance records its parent's physical table in.
 *
 * Not renamed by this migration, and deliberately so: `STORAGE_FORMAT.columns`
 * describes the association every embedded instance carries, and none of those
 * spellings names the concept being renamed. Its stability is what lets the
 * sweep below address it under one name on both sides of a run.
 */
export const PARENT_TABLE_COLUMN = STORAGE_FORMAT.columns.parentTable;

/**
 * Every physical name this migration may address as field-group storage.
 *
 * 🔴 Nextly runs inside the user's own database, beside tables it did not
 * create and must never write to. Ownership therefore cannot be inferred from
 * shape: an application table that happens to carry a `_parent_table` column
 * would be rewritten, and a value coincidentally matching a renamed name would
 * be silently changed. So the candidate set is enumerated from what Nextly
 * knows it owns, and the column is only ever used to narrow it further.
 *
 * Both spellings of every renamed table are included, because a step addresses
 * whichever one the catalog currently holds and a resumed run can meet either.
 * Registry rows are included on top of the plan: a field group whose table was
 * named through `dbName` is renamed by nothing and so appears in no entry, yet
 * it still holds instances that can be nested inside a group that *is* renamed.
 *
 * A table orphaned by a deleted registry row is deliberately NOT included. Its
 * rows are already unreachable — no registry row means no read path finds
 * them — so a stale pointer there costs nothing, and reaching for it is not
 * worth a predicate that could match something a user owns.
 */
export function ownedDataTableNames(args: {
  rows: readonly { tableName: string }[];
  entries: readonly ManifestEntry[];
}): string[] {
  const names = new Set<string>();
  for (const row of args.rows) names.add(row.tableName);
  for (const entry of args.entries) {
    if (entry.kind !== "table") continue;
    names.add(entry.from);
    names.add(entry.to);
  }
  return [...names];
}

/**
 * Those owned names the catalog holds as tables storing embedded instances.
 *
 * Two conditions, and both are load-bearing. The name has to be one Nextly
 * owns, so nothing belonging to the host application can be reached. The table
 * has to carry the parent-pointer column, which is what separates a field-group
 * data table from the collection and single tables sharing the same registry
 * vocabulary, and from a localization companion — those key on `_parent`.
 */
export function parentPointerTables(args: {
  columns: readonly TableColumns[];
  identifierCase: IdentifierCaseRules;
  /** Physical names this migration owns, from `ownedDataTableNames`. */
  owned: readonly string[];
}): string[] {
  const { columns, identifierCase, owned } = args;
  // Matched under the server's own rules rather than by exact spelling: MySQL
  // with `lower_case_table_names=1` reports a lowercased name for a table
  // stored under a mixed-case one, and an exact comparison would read a table
  // Nextly owns as one it does not.
  const ownedCatalog = indexCatalog(owned, identifierCase.tables);
  return columns
    .filter(
      table =>
        resolveCatalogName(ownedCatalog, table.table) !== undefined &&
        resolveCatalogName(
          indexCatalog(table.columns, identifierCase.columns),
          PARENT_TABLE_COLUMN
        ) !== undefined
    )
    .map(table => table.table);
}

/**
 * Refuse to settle while any instance still addresses a renamed table.
 *
 * Asked of the rows rather than inferred from the steps having run, for the same
 * reason the structural check is: a step reports the postcondition it knows
 * about, and the one thing no step can see is a data table it never knew
 * existed. That is the failure this exists for — a table the per-step
 * observation missed, or one that gained a stale pointer while the run was in
 * flight — and refusing before the marker settles is what keeps the damage to a
 * migration an operator must finish rather than content a reader finds missing.
 *
 * One pass per table per batch of names, rather than one per table per name:
 * the renamed-away set is asked in as few statements as the driver's parameter
 * limit allows, so the cost is a scan of each table rather than a scan per name.
 */
export async function assertNoStaleParentPointers(args: {
  query: (statement: SQL) => Promise<Record<string, unknown>[]>;
  columns: readonly TableColumns[];
  identifierCase: IdentifierCaseRules;
  /** Physical names this migration owns, from `ownedDataTableNames`. */
  owned: readonly string[];
  /** Names this run renamed away, which no row may still address. */
  staleNames: readonly string[];
  /**
   * Bound parameters one statement may carry, from the adapter's capabilities.
   *
   * SQLite advertises 999 where the other two advertise 65535, and exceeding it
   * fails the statement outright. This runs *after* every rename has committed,
   * so an unchunked list would strand a finished migration in flight rather
   * than merely reporting slowly — which is why the limit is honoured rather
   * than assumed generous.
   */
  maxParams: number;
  /**
   * Whether re-reading could change this verdict, which depends on the caller.
   *
   * Verifying a SETTLED marker compares a marker captured at one instant against rows read later,
   * with no lock held between them, so a rollback rewriting `_parent_table` back to its legacy
   * spelling produces a mismatch the database was never actually in. Verifying after this run's OWN
   * steps holds the lock and reads rows those steps just wrote; a stale pointer there is real and
   * must stay loud.
   *
   * Defaults to `permanent`, so a caller that has not thought about it gets the refusal that
   * cannot be mistaken for contention.
   */
  kind?: RefusalKind;
}): Promise<void> {
  const { query, columns, identifierCase, owned, staleNames, maxParams } = args;
  if (staleNames.length === 0) return;

  const batches = chunk(staleNames, boundedBatchSize(maxParams));

  for (const table of parentPointerTables({ columns, identifierCase, owned })) {
    for (const batch of batches) {
      // Built with `sql.join` rather than by interpolating the array, which is
      // the repository's idiom for an IN list: a bare array flattens wrongly
      // for the parameter forms the drivers expect.
      const names = sql.join(
        batch.map(name => sql`${name}`),
        sql`, `
      );
      // Addressed by a name the ORM's schema registry does not declare — these
      // tables are created by the schema pipeline at runtime — so this is issued
      // as a Drizzle statement, which quotes the identifiers for the dialect in
      // use and binds the values in whichever form the driver expects.
      const rows = await query(
        sql`SELECT ${sql.identifier(PARENT_TABLE_COLUMN)}
            FROM ${sql.identifier(table)}
            WHERE ${sql.identifier(PARENT_TABLE_COLUMN)} IN (${names})
            LIMIT 1`
      );
      const found = rows[0]?.[PARENT_TABLE_COLUMN];
      if (found === undefined) continue;

      throw NextlyError.serviceUnavailable({
        logMessage:
          "field-group migration will not settle: embedded instances still address a table it renamed",
        logContext: {
          reason: "a parent pointer still names storage this run renamed away",
          [REFUSAL_KIND_KEY]: args.kind ?? "permanent",
          table,
          // The column is text on every dialect, so a non-string is an anomaly
          // worth naming rather than coercing: default stringification would
          // report an object as `[object Object]`, which tells an operator
          // nothing about the row that has to be repaired.
          pointer: typeof found === "string" ? found : JSON.stringify(found),
        },
      });
    }
  }
}

/**
 * A batch size that is always a usable positive integer.
 *
 * 🔴 `Math.max` propagates `NaN`, so clamping a missing or non-numeric limit
 * with it yields `NaN` — and a `NaN` stride makes `chunk` emit a single EMPTY
 * batch, which compiles to `IN ()`. That scans for nothing while looking
 * exactly like a scan that ran, which is the worst available outcome for a
 * check whose whole job is to refuse. Anything not finite falls back to one
 * name per statement: slower, and correct.
 */
function boundedBatchSize(maxParams: number): number {
  if (!Number.isFinite(maxParams)) return 1;
  return Math.max(1, Math.floor(maxParams));
}

/** Split a list into runs of at most `size`. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}
