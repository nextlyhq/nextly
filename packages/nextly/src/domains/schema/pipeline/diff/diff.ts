// Diffs two NextlySchemaSnapshots and emits structured Operation[].
//
// This is the heart of the new pipeline. Pure function, no I/O, no prompts.
// Replaces drizzle-kit pushSchema's diff role for the rename + destructive
// op detection paths. drizzle-kit still handles purely additive ops via the
// final pushSchema call after pre-resolution.
//
// What this DOESN'T do:
//   - Detect renames. drop_column + add_column on the same table are emitted
//     as separate ops; the F4 RegexRenameDetector reads them later and turns
//     confirmed pairs into rename_column ops via applyResolutions().
//   - Generate SQL. SQL templates live in pre-resolution/sql-templates.ts
//     (PR 2) for the ops we own; pushSchema generates SQL for the rest.
//   - Look at indexes / constraints / foreign keys. Out of scope for v1
//     (drizzle-kit pushSchema handles those after pre-resolution).
//
// Output ordering (deterministic for testability):
//   1. add_table operations, sorted by table name.
//   2. drop_table operations, sorted by table name.
//   3. Per-table column ops (tables alphabetical):
//      a. drop_column (alphabetical by columnName)
//      b. add_column (alphabetical by columnName)
//      c. change_column_type (alphabetical)
//      d. change_column_nullable (alphabetical)
//      e. change_column_default (alphabetical)

import type {
  AddColumnOp,
  AddTableOp,
  ChangeColumnDefaultOp,
  ChangeColumnNullableOp,
  ChangeColumnTypeOp,
  ColumnSpec,
  DropColumnOp,
  DropTableOp,
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "./types.js";

export function diffSnapshots(
  prev: NextlySchemaSnapshot,
  cur: NextlySchemaSnapshot
): Operation[] {
  const prevByName = new Map<string, TableSpec>();
  for (const t of prev.tables) prevByName.set(t.name, t);

  const curByName = new Map<string, TableSpec>();
  for (const t of cur.tables) curByName.set(t.name, t);

  const tableOps: Operation[] = [];
  const columnOps: Operation[] = [];

  // Pass 1: table-level ops (add_table, drop_table). rename_table is NOT
  // detected here; same as columns, the rename detector reads (drop, add)
  // table pairs later and merges confirmed pairs.
  const allTableNames = [
    ...new Set([...prevByName.keys(), ...curByName.keys()]),
  ].sort();

  for (const name of allTableNames) {
    const prevT = prevByName.get(name);
    const curT = curByName.get(name);

    if (!prevT && curT) {
      tableOps.push({ type: "add_table", table: curT } satisfies AddTableOp);
      continue;
    }
    if (prevT && !curT) {
      tableOps.push({
        type: "drop_table",
        tableName: name,
      } satisfies DropTableOp);
      continue;
    }
    if (prevT && curT) {
      // Pass 2: column-level ops for tables present in both snapshots.
      columnOps.push(...diffColumns(name, prevT.columns, curT.columns));
    }
  }

  return [...tableOps, ...columnOps];
}

function diffColumns(
  tableName: string,
  prev: ColumnSpec[],
  cur: ColumnSpec[]
): Operation[] {
  const prevByName = new Map<string, ColumnSpec>();
  for (const c of prev) prevByName.set(c.name, c);

  const curByName = new Map<string, ColumnSpec>();
  for (const c of cur) curByName.set(c.name, c);

  const drops: DropColumnOp[] = [];
  const adds: AddColumnOp[] = [];
  const typeChanges: ChangeColumnTypeOp[] = [];
  const nullableChanges: ChangeColumnNullableOp[] = [];
  const defaultChanges: ChangeColumnDefaultOp[] = [];

  const allColumnNames = [
    ...new Set([...prevByName.keys(), ...curByName.keys()]),
  ].sort();

  for (const name of allColumnNames) {
    const prevC = prevByName.get(name);
    const curC = curByName.get(name);

    if (!prevC && curC) {
      adds.push({ type: "add_column", tableName, column: curC });
      continue;
    }
    if (prevC && !curC) {
      drops.push({
        type: "drop_column",
        tableName,
        columnName: name,
        columnType: prevC.type,
      });
      continue;
    }
    if (prevC && curC) {
      // Column present in both - check for changes.
      if (prevC.type !== curC.type) {
        typeChanges.push({
          type: "change_column_type",
          tableName,
          columnName: name,
          fromType: prevC.type,
          toType: curC.type,
        });
      }
      if (prevC.nullable !== curC.nullable) {
        nullableChanges.push({
          type: "change_column_nullable",
          tableName,
          columnName: name,
          fromNullable: prevC.nullable,
          toNullable: curC.nullable,
        });
      }
      if (prevC.default !== curC.default) {
        defaultChanges.push({
          type: "change_column_default",
          tableName,
          columnName: name,
          fromDefault: prevC.default,
          toDefault: curC.default,
        });
      }
    }
  }

  return [
    ...drops,
    ...adds,
    ...typeChanges,
    ...nullableChanges,
    ...defaultChanges,
  ];
}
