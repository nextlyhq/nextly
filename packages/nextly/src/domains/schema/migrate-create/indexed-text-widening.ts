/**
 * The refusal of a MySQL migration that would widen a keyed column into TEXT or BLOB.
 *
 * MySQL keys a TEXT or BLOB column only by a prefix length, so `MODIFY COLUMN … TEXT` over a column
 * a whole-column index or key still covers fails with ERROR 1170, and the migration stops there on
 * every site that runs it. A column an earlier migration made `varchar(255)` and indexed whole is
 * such a column once the field's rule reads it as unbounded. Lifting the index around the change,
 * and recreating it by prefix as the Schema Builder keys a TEXT column, is not written yet, so the
 * run is refused before any file is written, naming each column and what keeps it bounded.
 *
 * @module domains/schema/migrate-create/indexed-text-widening
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import type { NextlySchemaSnapshot, Operation } from "../pipeline/diff/types";
import { isMysqlTextOrBlobType } from "../pipeline/sql-templates/create-index";

/** Refuses `operations` when one widens a column a recorded index keys into TEXT or BLOB. */
export function refuseIndexedTextWidening(args: {
  operations: readonly Operation[];
  /** The tables as the newest snapshot recorded them, with their indexes. */
  previous: NextlySchemaSnapshot | undefined;
  dialect: SupportedDialect;
}): void {
  if (args.dialect !== "mysql" || args.previous === undefined) return;
  const errors: { path: string; code: string; message: string }[] = [];
  for (const widening of wideningsOf(args.operations)) {
    const blocking = indexesBlocking(widening, args.operations, args.previous);
    if (blocking === "none") continue;
    errors.push({
      path: `${widening.table}.${widening.column}`,
      code: "INDEXED_COLUMN_WIDENING",
      message:
        `${widening.table}.${widening.column} would change from ${widening.fromType} to ` +
        `${widening.toType}, which MySQL cannot do while ` +
        (blocking === "unknown"
          ? "an index may key the whole column: the newest snapshot predates recording indexes, so " +
            "whether one does cannot be read. "
          : `the index ${blocking.join(", ")} keys the whole column. `) +
        "Give the field a maxLength, which keeps the column bounded and its index, or remove the " +
        "field's index, then run migrate:create again.",
    });
  }
  if (errors.length === 0) return;
  // Each refusal in the message itself, as the run's other refusals are, so the command prints
  // the columns and the way out rather than a bare "validation failed".
  throw new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage: errors.map(e => e.message).join(" "),
    publicData: { errors },
    logContext: {
      reason: "indexed column widened to text",
      columns: errors.map(e => e.path),
    },
  });
}

/** A column this run widens into TEXT or BLOB, by its names before and after the run. */
interface Widening {
  /** The table and column as the run leaves them. */
  table: string;
  column: string;
  /** The table and column as the newest snapshot recorded them. */
  recordedTable: string;
  recordedColumn: string;
  fromType: string;
  toType: string;
}

/**
 * Every column the operations widen from a type MySQL keys whole into TEXT or BLOB: a type change,
 * and a rename that changes the type with it. A renamed column or table is traced back to the
 * name the snapshot recorded, which its indexes still use: the rename decisions are applied
 * before this is asked, so a type change names the column as it will be.
 */
function wideningsOf(operations: readonly Operation[]): Widening[] {
  const renames = renamesOf(operations);
  return operations.flatMap(op => {
    const widening = wideningOf(op, renames);
    return widening === undefined ? [] : [widening];
  });
}

/** The names a run's renames gave tables and columns, mapped back to the names they had. */
interface Renames {
  tableBefore: ReadonlyMap<string, string>;
  /** Keyed `table.column`, by the names the run leaves. */
  columnBefore: ReadonlyMap<string, string>;
}

function renamesOf(operations: readonly Operation[]): Renames {
  const tableBefore = new Map<string, string>();
  const columnBefore = new Map<string, string>();
  for (const op of operations) {
    if (op.type === "rename_table") tableBefore.set(op.toName, op.fromName);
    if (op.type === "rename_column") {
      columnBefore.set(`${op.tableName}.${op.toColumn}`, op.fromColumn);
    }
  }
  return { tableBefore, columnBefore };
}

/** A column's type change, by its names as the run leaves them: a retype, or a rename's. */
interface TypeChange {
  table: string;
  column: string;
  /** The column's recorded name, where the operation itself is the rename. */
  recorded: string | undefined;
  fromType: string;
  toType: string;
}

function typeChangeOf(op: Operation): TypeChange | undefined {
  switch (op.type) {
    case "change_column_type":
      return {
        table: op.tableName,
        column: op.columnName,
        recorded: undefined,
        fromType: op.fromType,
        toType: op.toType,
      };
    case "rename_column":
      return {
        table: op.tableName,
        column: op.toColumn,
        recorded: op.fromColumn,
        fromType: op.fromType,
        toType: op.toType,
      };
    default:
      return undefined;
  }
}

/** `op` as a widening from a type MySQL keys whole into TEXT or BLOB, or undefined. */
function wideningOf(op: Operation, renames: Renames): Widening | undefined {
  const change = typeChangeOf(op);
  if (
    change === undefined ||
    !isMysqlTextOrBlobType(change.toType) ||
    isMysqlTextOrBlobType(change.fromType)
  ) {
    return undefined;
  }
  return {
    table: change.table,
    column: change.column,
    recordedTable: renames.tableBefore.get(change.table) ?? change.table,
    recordedColumn:
      change.recorded ??
      renames.columnBefore.get(`${change.table}.${change.column}`) ??
      change.column,
    fromType: change.fromType,
    toType: change.toType,
  };
}

/**
 * The recorded indexes that key `widening`'s column and that the run keeps, by name; `none`; or
 * `unknown` where the snapshot recorded no indexes for the table, which a snapshot written before
 * indexes were recorded does not, and an index there cannot be ruled out. An index the same run
 * drops (a unique flag turned off with the widening) stands no longer when the column changes.
 */
function indexesBlocking(
  widening: Widening,
  operations: readonly Operation[],
  previous: NextlySchemaSnapshot
): string[] | "none" | "unknown" {
  const table = previous.tables.find(t => t.name === widening.recordedTable);
  if (table === undefined) return "none";
  if (table.indexes === undefined) return "unknown";
  const dropped = new Set(
    operations.flatMap(op =>
      op.type === "drop_index" &&
      (op.tableName === widening.table ||
        op.tableName === widening.recordedTable)
        ? [op.index.name]
        : []
    )
  );
  const blocking = table.indexes
    .filter(
      index =>
        index.columns.includes(widening.recordedColumn) &&
        !dropped.has(index.name)
    )
    .map(index => index.name);
  return blocking.length === 0 ? "none" : blocking;
}
