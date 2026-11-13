/**
 * What a create left out of the table it was asked for: the requested columns the live table does
 * not hold, or holds as another type.
 *
 * A create is recorded applied only when this is empty. "The table exists" says nothing about its
 * columns: a table built from a different request, or a statement that stopped part-way, stands
 * under the same name with other columns.
 *
 * Judged by the comparison every push already makes between a desired table and the live one
 * (`diffSnapshots`), from the same desired table (`buildDesiredTableFrom*Fields`) and the same
 * introspection. A second, plainer comparison of the creating SQL's own rendering against the live
 * types would read several field kinds differently (float widths, inline uniques, companion-owned
 * columns) and call working tables broken; this one cannot disagree with a push about whether a
 * table matches, because it is the push's own answer. Only a requested column missing or of
 * another type counts: what a create adds beyond its request is not the question here.
 *
 * @module domains/schema/services/created-table-shape
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { isNextlyOwnedDocumentColumn } from "../../../lib/system-columns";
import { diffSnapshots } from "../pipeline/diff/diff";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import type { TableSpec } from "../pipeline/diff/types";

/** A requested column the created table does not hold as asked. */
export interface ColumnNotAsRequested {
  column: string;
  /** Absent from the table, or present as another type (`liveType` instead of `requestedType`). */
  problem: "missing" | "otherType";
  requestedType: string;
  liveType?: string;
}

/**
 * The requested columns of `requested` that the live table of its name does not hold as asked.
 * Every requested column is missing when the table is not there at all.
 */
export async function columnsTheCreateLeftOut(
  db: unknown,
  dialect: SupportedDialect,
  requested: TableSpec
): Promise<ColumnNotAsRequested[]> {
  const live = (
    await introspectLiveColumns(db, dialect, [requested.name])
  ).tables.find(table => table.name === requested.name);
  const requestedType = new Map(
    requested.columns.map(column => [column.name, column.type])
  );
  const requestedSpec = new Map(
    requested.columns.map(column => [column.name, column])
  );
  if (!live) {
    return requested.columns.map(column => ({
      column: column.name,
      problem: "missing",
      requestedType: column.type,
    }));
  }

  const leftOut: ColumnNotAsRequested[] = [];
  for (const op of diffSnapshots(
    { tables: [{ ...live, indexes: undefined }] },
    { tables: [{ ...requested, indexes: undefined }] }
  )) {
    if (op.type === "add_column") {
      leftOut.push({
        column: op.column.name,
        problem: "missing",
        requestedType: op.column.type,
      });
    } else if (
      op.type === "change_column_type" &&
      !keysSameReference(requestedSpec.get(op.columnName), op.fromType)
    ) {
      leftOut.push({
        column: op.columnName,
        problem: "otherType",
        requestedType: requestedType.get(op.columnName) ?? op.toType,
        liveType: op.fromType,
      });
    }
  }
  // The comparison leaves out the columns a step of `nextly migrate` owns (`_revision`,
  // `_changed_*`), so a push never fights that step over them. A create asks for them all the same,
  // and a write expects them, so each one requested is looked for by name.
  const liveNames = new Set(live.columns.map(column => column.name));
  for (const column of requested.columns) {
    if (
      isNextlyOwnedDocumentColumn(column.name) &&
      !liveNames.has(column.name)
    ) {
      leftOut.push({
        column: column.name,
        problem: "missing",
        requestedType: column.type,
      });
    }
  }
  return leftOut;
}

/** The scalar types an id is held in: `uuid`, and a text or fixed-width character column. */
const SCALAR_ID_TYPES = new Set([
  "uuid",
  "text",
  "varchar",
  "character varying",
  "char",
  "character",
  "bpchar",
]);

/**
 * Whether a requested single reference is held as asked in a column of `liveType`. The creating
 * SQL keys a reference to one entry by its target's id type (a PostgreSQL `uuid`, a MySQL
 * `varchar(36)`), where the desired table names the descriptor's `text`; a push leaves either
 * spelling as it is. Any scalar id type holds the reference; anything else (a number, JSON) does
 * not.
 */
function keysSameReference(
  requested: TableSpec["columns"][number] | undefined,
  liveType: string
): boolean {
  if (requested?.holdsSingleReference !== true) return false;
  const base = liveType
    .trim()
    .toLowerCase()
    .replace(/\s*\(.*$/, "");
  return SCALAR_ID_TYPES.has(base);
}

/** The left-out columns as one line for a log or a refusal: each column and what is wrong. */
export function describeColumnsLeftOut(
  leftOut: readonly ColumnNotAsRequested[]
): string {
  return leftOut
    .map(entry =>
      entry.problem === "missing"
        ? `"${entry.column}" is missing`
        : `"${entry.column}" is ${entry.liveType} rather than ${entry.requestedType}`
    )
    .join("; ");
}
