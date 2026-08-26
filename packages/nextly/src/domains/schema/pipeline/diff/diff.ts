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
//   - Generate SQL. SQL templates live in pipeline/sql-templates/ (F11 PR 3)
//     for both apply pipeline (renames + drops) and migrate:create (all op
//     types). pushSchema still generates SQL for the additive remainder
//     during apply.
//   - Look at indexes / constraints / foreign keys. Out of scope for v1
//     (drizzle-kit pushSchema handles those after pre-resolution).
//
// Output ordering (deterministic for testability):
//   1. add_table operations, sorted by table name.
//   2. drop_table operations, sorted by table name.
//   3. drop_index operations (tables alphabetical) — BEFORE column ops, so
//      a dropped column's index is gone before the column drop (SQLite
//      cannot drop an indexed column), and so reversed inverse ops create
//      columns before the indexes that cover them.
//   4. Per-table column ops (tables alphabetical):
//      a. drop_column (alphabetical by columnName)
//      b. add_column (alphabetical by columnName)
//      c. change_column_type (alphabetical)
//      d. change_column_nullable (alphabetical)
//      e. change_column_default (alphabetical)
//   5. add_index operations (tables alphabetical) — AFTER column ops, so a
//      new column exists before its index is created.

import { renderedType } from "../sql-templates/create-table-body";

import { indexKey, isManagedIndexName } from "./index-util";
import { normalizeDefault } from "./normalize-default";
import { normalizeType } from "./normalize-type";
import type {
  AddColumnOp,
  AddTableOp,
  ChangeColumnDefaultOp,
  ChangeColumnNullableOp,
  ChangeColumnTypeOp,
  ColumnSpec,
  DropColumnOp,
  DropTableOp,
  IndexSpec,
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "./types";

/** The declared types whose sequence default is part of the type itself. */
const SERIAL_TYPES = new Set(["serial", "bigserial", "smallserial"]);

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
  const dropIndexOps: Operation[] = [];
  const addIndexOps: Operation[] = [];

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
      // Pass 3: index-level ops (sentinel: skip when either side untracked).
      for (const op of diffIndexes(name, prevT.indexes, curT.indexes)) {
        if (op.type === "drop_index") dropIndexOps.push(op);
        else addIndexOps.push(op);
      }
    }
  }

  // Only an index whose column this diff also drops moves ahead of the column
  // ops: SQLite refuses ALTER TABLE ... DROP COLUMN while an index still covers
  // the column, so that index has to be gone first. It also keeps
  // down-migrations sound — buildInverseOperations reverses the list, so
  // (drop_index, drop_column) inverts to (add_column, add_index), creating the
  // column before the index that needs it.
  //
  // Every other index drop stays behind add_index, which is where diffIndexes
  // put it. Changing a field from `index` to `unique` rekeys the index, so the
  // diff emits a drop and an add for the same column; dropping first would mean
  // that on a dialect where DDL auto-commits, a CREATE UNIQUE INDEX rejected by
  // existing duplicate rows leaves the table with neither the old index nor the
  // new constraint. Creating the replacement first fails safe: the old index is
  // still there. The two indexes differ in name (idx_ vs uq_), so both can
  // exist for the moment between the statements.
  const droppedColumnKeys = new Set(
    columnOps
      .filter(op => op.type === "drop_column")
      .map(op => `${op.tableName}\u0000${op.columnName}`)
  );
  const dropIndexBeforeColumns: Operation[] = [];
  const dropIndexAfterAdds: Operation[] = [];
  for (const op of dropIndexOps) {
    const coversDroppedColumn =
      op.type === "drop_index" &&
      op.index.columns.some(column =>
        droppedColumnKeys.has(`${op.tableName}\u0000${column}`)
      );
    if (coversDroppedColumn) dropIndexBeforeColumns.push(op);
    else dropIndexAfterAdds.push(op);
  }

  return [
    ...tableOps,
    ...dropIndexBeforeColumns,
    ...columnOps,
    ...addIndexOps,
    ...dropIndexAfterAdds,
  ];
}

/**
 * Emit add_index / drop_index for a table present in both snapshots. Matches by
 * logical key (sorted columns + uniqueness), so a constraint-backed unique and
 * a CREATE UNIQUE INDEX on the same column compare equal. Skips entirely when
 * either side's `indexes` is undefined (pre-C1 sentinel). Only drops indexes we
 * manage (idx_/uq_, never *_pkey) — external indexes are left alone.
 */
function diffIndexes(
  tableName: string,
  prev: IndexSpec[] | undefined,
  cur: IndexSpec[] | undefined
): Operation[] {
  if (prev === undefined || cur === undefined) return [];
  const ops: Operation[] = [];
  const prevByKey = new Map(prev.map(i => [indexKey(i), i]));
  const curByKey = new Map(cur.map(i => [indexKey(i), i]));
  for (const [key, idx] of curByKey) {
    if (!prevByKey.has(key)) {
      ops.push({ type: "add_index", tableName, index: idx });
    }
  }
  for (const [key, idx] of prevByKey) {
    if (!curByKey.has(key) && isManagedIndexName(idx.name)) {
      ops.push({ type: "drop_index", tableName, index: idx });
    }
  }
  return ops;
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
        // The DECLARATION, not the bare token. PostgreSQL introspection keeps
        // `numeric(10,2)` as `numeric` plus a separate modifier, so passing
        // `type` alone hands the rename detector a column that describes
        // itself as unbounded — and a narrowing conversion then reads as a
        // rename between two identical types.
        columnType: renderedType(prevC),
      });
      continue;
    }
    if (prevC && curC) {
      // Column present in both - check for changes.
      // Compare normalised type tokens — the live side reads PG's `udt_name`
      // (`int4`, `bool`, `varchar` without length) while the desired side
      // authors SQL names (`integer`, `boolean`, `varchar(255)`). A raw
      // string compare flags every core column as a "type change" and makes
      // `nextly migrate` refuse every existing Postgres DB. See
      // ./normalize-type.ts. The op carries the original, un-normalised names.
      if (normalizeType(prevC.type) !== normalizeType(curC.type)) {
        typeChanges.push({
          type: "change_column_type",
          tableName,
          columnName: name,
          fromType: prevC.type,
          toType: curC.type,
        });
      }
      // A primary key's nullability is not an independent attribute: it
      // follows from being the primary key, and the dialects disagree only on
      // whether they bother to write it down. SQLite records `id text PRIMARY
      // KEY` with no NOT NULL and reports it back as nullable, while the
      // desired side calls it required — a difference no ALTER can resolve,
      // because SQLite has no statement that adds NOT NULL to an existing
      // column. Comparing it produces an op that is emitted on every run,
      // never converges, and keeps handing the reconcile work to do; the
      // table rebuilds that follow are what silently drop indexes.
      const isPrimaryKey =
        curC.primaryKey === true || prevC.primaryKey === true;
      if (!isPrimaryKey && prevC.nullable !== curC.nullable) {
        nullableChanges.push({
          type: "change_column_nullable",
          tableName,
          columnName: name,
          fromNullable: prevC.nullable,
          toNullable: curC.nullable,
        });
      }
      // Compare normalised forms — PG's redundant `::<type>` cast suffix
      // on the live side (e.g. `'draft'::character varying`) must not
      // masquerade as a default change against the human-authored
      // `'draft'`. See ./normalize-default.ts for the bounded set of
      // equivalences. The emitted op carries the original, un-normalised
      // values so downstream tooling sees what's actually stored.
      // The column type is passed so a boolean default compares by meaning:
      // MySQL stores booleans as tinyint(1) and reports 1/0 where the schema
      // authored true/false.
      //
      // A serial column is the other asymmetry: its sequence default belongs
      // to the type, so the desired side declares no default while PostgreSQL
      // reports the materialised `nextval('<table>_id_seq'::regclass)`. Read
      // literally that is a default being removed on every reconcile.
      //
      // Two conditions, and both are needed. The live default must be over
      // the sequence the column OWNS (see ColumnSpec.ownedSequenceDefault) —
      // a `nextval` over any other sequence was pointed there deliberately
      // and is a real default. And the DESIRED column must still be declared
      // serial: moving to a plain integer drops the sequence, which the type
      // comparison cannot catch because serial and integer share a storage
      // type, so suppressing it would leave the column drawing from the
      // sequence forever.
      const sequenceDefaultUnchanged =
        curC.default === undefined &&
        prevC.ownedSequenceDefault === true &&
        SERIAL_TYPES.has((curC.type ?? "").trim().toLowerCase());

      if (
        !sequenceDefaultUnchanged &&
        normalizeDefault(prevC.default, prevC.type) !==
          normalizeDefault(curC.default, curC.type)
      ) {
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
