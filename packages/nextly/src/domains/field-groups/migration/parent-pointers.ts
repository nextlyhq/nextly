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

import type { TableColumns } from "./reconcile";

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
 * Every table that stores embedded field-group instances, per the catalog.
 *
 * Identified by the column rather than by the registry or by a name prefix.
 * The registry names only tables it still holds a row for, and a table named
 * through `dbName` carries no prefix at all — yet both can hold a pointer at a
 * renamed table, and a pointer missed in either is content that stops
 * resolving. The column is the one property every such table has and nothing
 * else does: collection and single tables do not carry it, and a localization
 * companion keys on `_parent` instead.
 */
export function parentPointerTables(args: {
  columns: readonly TableColumns[];
  identifierCase: IdentifierCaseRules;
}): string[] {
  const { columns, identifierCase } = args;
  return columns
    .filter(
      table =>
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
 * One statement per table, not one per table per rename: the whole set of
 * renamed-away names is asked at once, so the cost is a pass over each table
 * rather than a pass per name.
 */
export async function assertNoStaleParentPointers(args: {
  query: (statement: SQL) => Promise<Record<string, unknown>[]>;
  columns: readonly TableColumns[];
  identifierCase: IdentifierCaseRules;
  /** Names this run renamed away, which no row may still address. */
  staleNames: readonly string[];
}): Promise<void> {
  const { query, columns, identifierCase, staleNames } = args;
  if (staleNames.length === 0) return;

  // Built with `sql.join` rather than by interpolating the array, which is the
  // repository's idiom for an IN list: a bare array flattens wrongly for the
  // parameter forms the drivers expect.
  const names = sql.join(
    staleNames.map(name => sql`${name}`),
    sql`, `
  );

  for (const table of parentPointerTables({ columns, identifierCase })) {
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
