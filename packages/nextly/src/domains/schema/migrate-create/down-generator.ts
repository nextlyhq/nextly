// Inverts a RESOLVED forward Operation[] (renames already collapsed by
// applyRenameDecisions) into the DOWN Operation[]. Inverting the resolved ops
// — rather than re-diffing snapshot[cur] vs snapshot[prev] — is what keeps
// renames data-preserving: a forward rename_column inverts to the reverse
// rename, not a drop+add. Object-removing ops (drop_table/drop_column) recover
// their original spec from the previous snapshot. Inverse ops are returned in
// reverse order of the forward ops.

import type {
  ColumnSpec,
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../pipeline/diff/types";

function findTable(snap: NextlySchemaSnapshot, name: string): TableSpec {
  const t = snap.tables.find(tbl => tbl.name === name);
  if (!t) {
    throw new Error(
      `down-generator: cannot invert drop_table '${name}' — not present in the previous snapshot.`
    );
  }
  return t;
}

function findColumn(
  snap: NextlySchemaSnapshot,
  tableName: string,
  columnName: string
): ColumnSpec {
  const t = snap.tables.find(tbl => tbl.name === tableName);
  const col = t?.columns.find(c => c.name === columnName);
  if (!col) {
    throw new Error(
      `down-generator: cannot invert drop_column '${tableName}.${columnName}' — not present in the previous snapshot.`
    );
  }
  return col;
}

function invertOne(op: Operation, prev: NextlySchemaSnapshot): Operation {
  switch (op.type) {
    case "add_table":
      return { type: "drop_table", tableName: op.table.name };
    case "drop_table":
      return { type: "add_table", table: findTable(prev, op.tableName) };
    case "add_column":
      return {
        type: "drop_column",
        tableName: op.tableName,
        columnName: op.column.name,
        columnType: op.column.type,
      };
    case "drop_column":
      return {
        type: "add_column",
        tableName: op.tableName,
        column: findColumn(prev, op.tableName, op.columnName),
      };
    case "rename_column":
      return {
        type: "rename_column",
        tableName: op.tableName,
        fromColumn: op.toColumn,
        toColumn: op.fromColumn,
        fromType: op.toType,
        toType: op.fromType,
      };
    case "rename_table":
      return { type: "rename_table", fromName: op.toName, toName: op.fromName };
    case "change_column_type":
      return {
        type: "change_column_type",
        tableName: op.tableName,
        columnName: op.columnName,
        fromType: op.toType,
        toType: op.fromType,
      };
    case "change_column_nullable":
      return {
        type: "change_column_nullable",
        tableName: op.tableName,
        columnName: op.columnName,
        fromNullable: op.toNullable,
        toNullable: op.fromNullable,
      };
    case "change_column_default":
      return {
        type: "change_column_default",
        tableName: op.tableName,
        columnName: op.columnName,
        fromDefault: op.toDefault,
        toDefault: op.fromDefault,
      };
    default: {
      const _exhaustive: never = op;
      throw new Error(`down-generator: unhandled op ${String(_exhaustive)}`);
    }
  }
}

export function buildInverseOperations(
  ops: Operation[],
  prev: NextlySchemaSnapshot
): Operation[] {
  // Reverse order: the last forward op must be undone first.
  return [...ops].reverse().map(op => invertOne(op, prev));
}
