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
//   1. drop_check / drop_foreign_key operations — ahead of everything, since
//      a constraint still in place blocks dropping the table it points at
//      and dropping or retyping a column it names; reversed for the down
//      migration, their re-adds then follow the tables and columns they need.
//   2. drop_table operations, a table before the tables it referenced.
//   3. add_table operations, a table after the tables it references (ties
//      and cycles by name, see `byForeignKeyDependency`).
//   4. drop_index operations that cover a dropped column (tables
//      alphabetical) — BEFORE column ops, so the index is gone before the
//      column drop (SQLite cannot drop an indexed column), and so reversed
//      inverse ops create columns before the indexes that cover them.
//   5. Per-table column ops (tables alphabetical):
//      a. drop_column (alphabetical by columnName)
//      b. add_column (alphabetical by columnName)
//      c. change_column_type (alphabetical)
//      d. change_column_nullable (alphabetical)
//      e. change_column_default (alphabetical)
//   6. add_index operations (tables alphabetical) — AFTER column ops, so a
//      new column exists before its index is created.
//   7. The remaining index drops, and every constraint add, in the order
//      their diff produced them.

import { isNextlyOwnedDocumentColumn } from "../../../../lib/system-columns";
import { isMysqlTextOrBlobType } from "../sql-templates/create-index";
import { renderedType } from "../sql-templates/create-table-body";

import { typesDiffer } from "./declared-size";
import { isManagedIndexName, keyedIndexes } from "./index-util";
import { normalizeCheckExpression } from "./normalize-check";
import { normalizeDefault } from "./normalize-default";
import type {
  AddColumnOp,
  AddTableOp,
  ChangeColumnDefaultOp,
  ChangeColumnNullableOp,
  ChangeColumnTypeOp,
  CheckSpec,
  ForeignKeySpec,
  ColumnSpec,
  DropColumnOp,
  DropTableOp,
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "./types";
import { conversionBetweenShapes } from "./types";

/** A table's columns without the ones a step of `nextly migrate` owns. */
function withoutMigrateStepColumns(columns: ColumnSpec[]): ColumnSpec[] {
  return columns.filter(column => !isNextlyOwnedDocumentColumn(column.name));
}

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

  const addedTables: TableSpec[] = [];
  const droppedTables: TableSpec[] = [];
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
      addedTables.push(curT);
      continue;
    }
    if (prevT && !curT) {
      droppedTables.push(prevT);
      continue;
    }
    if (prevT && curT) {
      // Pass 2: column-level ops for tables present in both snapshots. The
      // columns `nextly migrate` adds to every existing content table are
      // left out of the comparison on both sides: no migration file carries
      // them, so a file's snapshot without them beside a table with them is
      // the same schema, and reporting them would refuse the file as drift.
      columnOps.push(
        ...diffColumns(
          name,
          withoutMigrateStepColumns(prevT.columns),
          withoutMigrateStepColumns(curT.columns)
        )
      );
      // Pass 3: index-level ops (sentinel: skip when either side untracked).
      // A RE-KEYED index (same name, changed predicate/expression) is the one
      // case where the usual add-first ordering is wrong: the add renders
      // with IF NOT EXISTS, so it no-ops against the old index still carrying
      // the name, and the drop after it then removes the index outright. The
      // pair routes through one bucket with the drop ahead of its add.
      const indexOps = diffIndexes(name, prevT, curT);
      const rekeyedNames = new Set(
        indexOps
          .filter(
            (op): op is Extract<Operation, { type: "drop_index" }> =>
              op.type === "drop_index"
          )
          .map(op => op.index.name)
      );
      const rekeyAdds: Operation[] = [];
      for (const op of indexOps) {
        if (op.type === "drop_index") {
          dropIndexOps.push(op);
        } else if (op.type === "add_index" && rekeyedNames.has(op.index.name)) {
          rekeyAdds.push(op);
        } else {
          addIndexOps.push(op);
        }
      }
      dropIndexOps.push(...rekeyAdds);
      // Pass 3b: check constraints, with the same untracked sentinel — a
      // snapshot written before checks were tracked reads as "don't know",
      // never as "this table has none". All of them route through ONE
      // bucket, in the order diffChecks produced: a changed expression is a
      // drop-plus-add under the SAME name, and the add-bucket-first assembly
      // would otherwise emit the add first — a name collision on every
      // dialect, since constraints cannot coexist under one name.
      for (const op of diffChecks(name, prevT.checks, curT.checks)) {
        dropIndexOps.push(op);
      }
      // Pass 3c: foreign keys, structurally compared, with the same
      // sentinel and the same one-group routing for the same reason.
      for (const op of diffForeignKeys(
        name,
        prevT.foreignKeys,
        curT.foreignKeys
      )) {
        dropIndexOps.push(op);
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
  const columnsAnIndexBlocks = new Set(
    columnOps
      .filter(op => op.type === "drop_column")
      .map(op => `${op.tableName}\u0000${op.columnName}`)
  );
  // A column a relation's switch retypes counts too: MySQL refuses to retype an indexed column to
  // text or JSON, and a generated migration runs its operations in this order. (A live apply's
  // pre-resolution pass already drops indexes ahead of its conversions.)
  const retypedForSwitches = retypedForReferenceSwitches(columnOps);
  for (const op of retypedForSwitches) {
    columnsAnIndexBlocks.add(`${op.tableName}\u0000${op.columnName}`);
  }
  // So does any column retyped to TEXT or BLOB, a field's Unique turned off among them: MySQL
  // refuses the retype while an index keys the whole column, so an index this run drops goes
  // first. Dropping it ahead of the change is as good on the other dialects.
  for (const op of columnOps) {
    if (op.type === "change_column_type" && isMysqlTextOrBlobType(op.toType)) {
      columnsAnIndexBlocks.add(`${op.tableName}\u0000${op.columnName}`);
    }
  }
  const dropIndexBeforeColumns: Operation[] = [];
  const dropIndexAfterAdds: Operation[] = [];
  // A replaced key that something in this diff needs gone is dropped first after all: kept until
  // its replacement is added, it would block the drop of the table it points at, of a column at
  // either end or of an index supporting it, or (MySQL) a change of type of a column.
  const droppedNames = new Set(droppedTables.map(table => table.name));
  // Every column this diff retypes or drops, at either end of a key: neither runs under it.
  const retyped = new Set(
    columnOps.flatMap(op =>
      op.type === "change_column_type" || op.type === "drop_column"
        ? [`${op.tableName}\u0000${op.columnName}`]
        : []
    )
  );
  // And every column an index this diff drops stands on: a key may be what that index supports.
  for (const op of dropIndexOps) {
    if (op.type !== "drop_index") continue;
    for (const column of op.index.columns) {
      retyped.add(`${op.tableName}\u0000${column}`);
    }
  }
  const blocksThisDiff = (fk: ForeignKeySpec, tableName: string) =>
    droppedNames.has(fk.referencesTable) ||
    fk.columns.some(c => retyped.has(`${tableName}\u0000${c}`)) ||
    fk.referencesColumns.some(c =>
      retyped.has(`${fk.referencesTable}\u0000${c}`)
    );
  const ordered = dropIndexOps.map(op =>
    op.type === "drop_foreign_key" &&
    op.afterReplacement === true &&
    blocksThisDiff(op.foreignKey, op.tableName)
      ? {
          type: op.type,
          tableName: op.tableName,
          foreignKey: op.foreignKey,
          ...(op.beforeConversion === true
            ? { beforeConversion: true as const }
            : {}),
        }
      : op
  );
  for (const op of ordered) {
    const coversBlockedColumn =
      op.type === "drop_index" &&
      op.index.columns.some(column =>
        columnsAnIndexBlocks.has(`${op.tableName}\u0000${column}`)
      );
    // A check or foreign key goes ahead of every column change as well: while
    // it exists it blocks dropping — on MySQL even retyping — a column it
    // names, and a check's columns cannot be read from its SQL. Its add, when
    // it is being re-keyed, stays behind the columns, so the pair still runs
    // drop-then-add and the inverse still re-adds after re-creating columns.
    // A key a replacement on the same columns supersedes is the exception: it is dropped after
    // that replacement is added, in the order the foreign-key diff produced (`afterReplacement`).
    const isConstraintDrop =
      op.type === "drop_check" ||
      (op.type === "drop_foreign_key" && op.afterReplacement !== true);
    if (coversBlockedColumn || isConstraintDrop)
      dropIndexBeforeColumns.push(op);
    else dropIndexAfterAdds.push(op);
  }

  // Tables in foreign-key order: a new table after the tables it references,
  // a dropped one before the tables that referenced it. PostgreSQL and MySQL
  // refuse a key to a table that does not exist yet, and refuse to drop a
  // table another still references; name order made both depend on spelling.
  const tableOps: Operation[] = [
    ...byForeignKeyDependency(droppedTables)
      .reverse()
      .map(
        table =>
          ({ type: "drop_table", tableName: table.name }) satisfies DropTableOp
      ),
    ...byForeignKeyDependency(addedTables).map(
      table => ({ type: "add_table", table }) satisfies AddTableOp
    ),
  ];

  // Constraint drops lead even the table ops: the diff plans them only for a
  // table present on both sides, so one can point at a table dropped here.
  const constraintDrops = dropIndexBeforeColumns.filter(
    op => op.type === "drop_check" || op.type === "drop_foreign_key"
  );
  const indexDropsBeforeColumns = dropIndexBeforeColumns.filter(
    op => op.type === "drop_index"
  );

  // A guard requiring a column empty (`requireEmpty`) leads everything: a migration file runs its
  // operations in this order, and a guard refusing after any DDL has run would leave a dialect
  // that commits each statement half-changed.
  const guards = columnOps.filter(isEmptyColumnGuard);
  return [
    ...guards,
    ...keysDroppedBeforeConversions(constraintDrops, columnOps, prevByName),
    ...tableOps,
    ...indexDropsBeforeColumns,
    ...columnOps.filter(op => !isEmptyColumnGuard(op)),
    ...addIndexOps,
    ...dropIndexAfterAdds,
  ];
}

/** Whether `op` is a guard requiring a column empty before a relation's switch (`requireEmpty`). */
function isEmptyColumnGuard(op: Operation): op is ChangeColumnTypeOp {
  return op.type === "change_column_type" && op.conversion === "requireEmpty";
}

/**
 * The type changes among `columnOps` that a relation's switch makes: one converting the column
 * between one reference and a list, and the plain retype a guarded switch (`requireEmpty`) needs.
 * A conversion that keeps the type (SQLite's text) rewrites values only, and blocks on no key or
 * index.
 */
function retypedForReferenceSwitches(
  columnOps: readonly Operation[]
): ChangeColumnTypeOp[] {
  const guarded = new Set(
    columnOps
      .filter(isEmptyColumnGuard)
      .map(op => `${op.tableName}.${op.columnName}`)
  );
  return columnOps.filter(
    (op): op is ChangeColumnTypeOp =>
      op.type === "change_column_type" &&
      op.fromType !== op.toType &&
      (op.conversion !== undefined ||
        guarded.has(`${op.tableName}.${op.columnName}`))
  );
}

/**
 * `drops` with each foreign key on a column `columnOps` converts between one reference and a list
 * marked to run ahead of that conversion: the conversion runs before either apply route, and no
 * database retypes a column a key would then break. A conversion that keeps the column's type
 * (SQLite's text) rewrites values only, so its key is left to the apply route, which on SQLite
 * drops one only by rebuilding the table.
 *
 * A key over a column becoming a list is dropped even where the desired side tracks no keys, as a
 * table built from config does: no key to one row can hold a list, so the key cannot survive the
 * conversion, and left in place it refuses the retype (PostgreSQL) or is put back over the list
 * (MySQL's lift around a type change). Read from the previous side, which is where it exists.
 */
function keysDroppedBeforeConversions(
  drops: readonly Operation[],
  columnOps: readonly Operation[],
  prevByName: ReadonlyMap<string, TableSpec>
): Operation[] {
  const retyped = retypedForReferenceSwitches(columnOps);
  const converted = new Set(
    retyped.map(op => `${op.tableName}.${op.columnName}`)
  );
  const marked = drops.map(op =>
    op.type === "drop_foreign_key" &&
    op.foreignKey.columns.some(column =>
      converted.has(`${op.tableName}.${column}`)
    )
      ? { ...op, beforeConversion: true as const }
      : op
  );
  const alreadyDropped = new Set(
    drops.flatMap(op =>
      op.type === "drop_foreign_key"
        ? [`${op.tableName}.${op.foreignKey.name}`]
        : []
    )
  );
  // Every column a switch retypes into JSON: a list, or references naming their collections.
  const toList = new Set(
    retyped
      .filter(op => op.conversion !== "referenceScalar")
      .map(op => `${op.tableName}.${op.columnName}`)
  );
  const keysOverLists: Operation[] = [...prevByName.values()].flatMap(table =>
    (table.foreignKeys ?? [])
      .filter(
        fk =>
          !alreadyDropped.has(`${table.name}.${fk.name}`) &&
          fk.columns.some(column => toList.has(`${table.name}.${column}`))
      )
      .map(fk => ({
        type: "drop_foreign_key" as const,
        tableName: table.name,
        foreignKey: fk,
        beforeConversion: true as const,
      }))
  );
  return [...marked, ...keysOverLists];
}

/**
 * `tables` ordered so each comes after every other table in the list that it
 * references, ties broken by name. A reference to a table outside the list —
 * one that already exists — constrains nothing.
 *
 * A cycle cannot be ordered. The walk starts from the first table by name and
 * places each table after the ones it references that are not already being
 * placed, so for `a` ↔ `b` it yields `b` then `a`, with `b`'s key pointing
 * forward. SQLite accepts that. On PostgreSQL and MySQL the forward key is
 * added once both tables exist — by the dev-push emitter, which adds every new
 * table's keys last, and in every generated migration file (`migrate:create`,
 * plugin modules, `migrate:baseline`) by `withCyclicForeignKeysSplit`, which
 * also breaks a dropped cycle before its tables go.
 */
function byForeignKeyDependency(tables: readonly TableSpec[]): TableSpec[] {
  const byName = new Map(tables.map(table => [table.name, table]));
  const ordered: TableSpec[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (table: TableSpec): void => {
    if (state.has(table.name)) return;
    state.set(table.name, "visiting");
    const targets = [
      ...new Set((table.foreignKeys ?? []).map(fk => fk.referencesTable)),
    ].sort();
    for (const target of targets) {
      const referenced = byName.get(target);
      if (referenced !== undefined && target !== table.name) visit(referenced);
    }
    state.set(table.name, "done");
    ordered.push(table);
  };
  for (const table of [...tables].sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    visit(table);
  }
  return ordered;
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
  prevT: TableSpec,
  curT: TableSpec
): Operation[] {
  if (prevT.indexes === undefined || curT.indexes === undefined) return [];
  const ops: Operation[] = [];
  // Each side is read against its OWN column types: a column changing from
  // text to integer keeps its authored `::text` on the new side.
  const prevByKey = keyedIndexes(prevT.indexes, prevT.columns);
  const curByKey = keyedIndexes(curT.indexes, curT.columns);
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

/**
 * Emit add_foreign_key / drop_foreign_key for a table present in both
 * snapshots. Matched by NAME and compared STRUCTURALLY — introspection
 * reports columns, target and actions reliably on every dialect, unlike the
 * textual shapes checks compare. A changed shape is a drop-plus-add under
 * the same name, in that order, for the same collision reason as checks.
 */
function diffForeignKeys(
  tableName: string,
  prev: ForeignKeySpec[] | undefined,
  cur: ForeignKeySpec[] | undefined
): Operation[] {
  if (prev === undefined || cur === undefined) return [];
  const ops: Operation[] = [];
  const prevByName = new Map(prev.map(f => [f.name, f]));
  const curByName = new Map(cur.map(f => [f.name, f]));
  const sameShape = (a: ForeignKeySpec, b: ForeignKeySpec) =>
    a.columns.join("\u0000") === b.columns.join("\u0000") &&
    a.referencesTable === b.referencesTable &&
    a.referencesColumns.join("\u0000") === b.referencesColumns.join("\u0000") &&
    a.onDelete === b.onDelete &&
    a.onUpdate === b.onUpdate;
  for (const [name, fk] of curByName) {
    const before = prevByName.get(name);
    if (before === undefined) {
      ops.push({ type: "add_foreign_key", tableName, foreignKey: fk });
    } else if (!sameShape(before, fk)) {
      ops.push({ type: "drop_foreign_key", tableName, foreignKey: before });
      ops.push({ type: "add_foreign_key", tableName, foreignKey: fk });
    }
  }
  for (const [name, fk] of prevByName) {
    if (!curByName.has(name)) {
      ops.push({ type: "drop_foreign_key", tableName, foreignKey: fk });
    }
  }
  return replacementsAfterTheirAdds(ops);
}

/**
 * `ops` with each key that another, under a new name on the same columns, replaces dropped after
 * that replacement is added (`afterReplacement`), so a key moving to another target never leaves
 * its columns unkeyed, even where each statement commits on its own. A key whose replacement shares
 * its name is a change of shape, dropped first as before: two keys cannot share a name.
 */
function replacementsAfterTheirAdds(ops: Operation[]): Operation[] {
  const columnsOf = (fk: ForeignKeySpec) => fk.columns.join("\u0000");
  const added = new Set(
    ops.flatMap(op =>
      op.type === "add_foreign_key" ? [columnsOf(op.foreignKey)] : []
    )
  );
  const addedNames = new Set(
    ops.flatMap(op =>
      op.type === "add_foreign_key" ? [op.foreignKey.name] : []
    )
  );
  const replaced = (op: Operation) =>
    op.type === "drop_foreign_key" &&
    !addedNames.has(op.foreignKey.name) &&
    added.has(columnsOf(op.foreignKey));
  return [
    ...ops.filter(op => !replaced(op)),
    ...ops.flatMap(op =>
      op.type === "drop_foreign_key" && replaced(op)
        ? [{ ...op, afterReplacement: true as const }]
        : []
    ),
  ];
}

/**
 * Emit add_check / drop_check for a table present in both snapshots. Matched
 * by NAME, with the expressions compared in canonical form: a changed
 * expression is a drop plus an add under the same name, because no dialect
 * rewrites a check's expression in place — and matching on the expression
 * alone would leave a rename indistinguishable from an add, piling constraints
 * under new names.
 *
 * Canonical rather than textual because PostgreSQL reports a check in its own
 * spelling (`x = ANY (ARRAY[...])` for `x IN (...)`, casts and parentheses
 * added), so the declared text never equals the live text. The operations keep
 * each side's original text; the canonical form is only compared.
 */
function diffChecks(
  tableName: string,
  prev: CheckSpec[] | undefined,
  cur: CheckSpec[] | undefined
): Operation[] {
  if (prev === undefined || cur === undefined) return [];
  const ops: Operation[] = [];
  const prevByName = new Map(prev.map(c => [c.name, c]));
  const curByName = new Map(cur.map(c => [c.name, c]));
  for (const [name, check] of curByName) {
    const before = prevByName.get(name);
    if (
      before === undefined ||
      normalizeCheckExpression(before.sql) !==
        normalizeCheckExpression(check.sql)
    ) {
      if (before !== undefined) {
        ops.push({ type: "drop_check", tableName, check: before });
      }
      ops.push({ type: "add_check", tableName, check });
    }
  }
  for (const [name, check] of prevByName) {
    if (!curByName.has(name)) {
      ops.push({ type: "drop_check", tableName, check });
    }
  }
  return ops;
}

/**
 * The operation that moves a column from one declaration to the other, or
 * undefined when the two describe the same column.
 *
 * Separate from `diffColumns` because it answers a question of its own: what a
 * type change has to RESTATE. On MySQL that is the whole definition, so the
 * attributes travel with the types, and reading that beside the nullability and
 * default comparisons that follow it made one function responsible for both.
 */
function columnTypeChanges(
  tableName: string,
  columnName: string,
  prevC: ColumnSpec,
  curC: ColumnSpec
): ChangeColumnTypeOp[] {
  const shapes = shapeChange(prevC, curC);
  // A switch to or from naming several collections: a guard of its own, which the diff moves ahead
  // of every other operation, and then whatever retype the column needs, plain.
  if (shapes === "requireEmpty") {
    const retype = columnTypeChange(tableName, columnName, prevC, curC, {});
    return [
      inPlaceConversion(tableName, columnName, prevC, "requireEmpty"),
      ...(retype === undefined ? [] : [retype]),
    ];
  }
  const conversion =
    shapes === undefined
      ? referenceMarkerConversion(prevC, curC)
      : { conversion: shapes };
  const retype = columnTypeChange(
    tableName,
    columnName,
    prevC,
    curC,
    conversion
  );
  if (retype !== undefined) return [retype];
  // The type is the same either way (SQLite's text), so only the values change.
  return shapes === undefined
    ? []
    : [inPlaceConversion(tableName, columnName, curC, shapes)];
}

/** The change between the shapes both sides state (`conversionBetweenShapes`). */
function shapeChange(
  prevC: ColumnSpec,
  curC: ColumnSpec
): NonNullable<ChangeColumnTypeOp["conversion"]> | undefined {
  return conversionBetweenShapes(prevC.referenceShape, curC.referenceShape);
}

/**
 * The conversion a type change makes when the shapes are not both known, as a snapshot written
 * before they were recorded, or a live column no road annotated: read from the desired side's
 * marker. A column becoming a relation's list of references holds a bare id, an array literal or a
 * JSON list, and a plain cast reads none of them as a list; a previous snapshot can carry the same
 * flag, and what matters is what the column is becoming.
 */
function referenceMarkerConversion(
  prevC: ColumnSpec,
  curC: ColumnSpec
): Pick<ChangeColumnTypeOp, "conversion"> {
  if (curC.holdsReferenceList === true) return { conversion: "referenceList" };
  // A relation switched from many related entries to one: the list's one id is kept.
  if (curC.holdsSingleReference === true && isJsonColumnType(prevC.type)) {
    return { conversion: "referenceScalar" };
  }
  return {};
}

/** A conversion with the column's type unchanged: the values change, or are required absent. */
function inPlaceConversion(
  tableName: string,
  columnName: string,
  column: ColumnSpec,
  conversion: NonNullable<ChangeColumnTypeOp["conversion"]>
): ChangeColumnTypeOp {
  return {
    type: "change_column_type",
    tableName,
    columnName,
    fromType: renderedType(column),
    toType: renderedType(column),
    nullable: column.nullable,
    fromNullable: column.nullable,
    conversion,
  };
}

function columnTypeChange(
  tableName: string,
  columnName: string,
  prevC: ColumnSpec,
  curC: ColumnSpec,
  conversion: Pick<ChangeColumnTypeOp, "conversion">
): ChangeColumnTypeOp | undefined {
  // Compared as normalised token PLUS declared size — the live side reads PG's
  // `udt_name` (`int4`, `bool`, `varchar` without length) while the desired
  // side authors SQL names (`integer`, `boolean`, `varchar(255)`). A raw string
  // compare flags every core column as a "type change" and makes
  // `nextly migrate` refuse every existing Postgres DB; comparing the token
  // ALONE went the other way and let a narrowing through unseen, because
  // `numeric(10,2)` and `numeric(5,1)` reduce to one token. See
  // ./declared-size.ts.
  if (!typesDiffer(prevC, curC)) return undefined;

  return {
    type: "change_column_type",
    tableName,
    columnName,
    // The DECLARATIONS, so the ALTER states the size it is moving to.
    // Reporting `type` alone would cast a narrowing target back to an
    // unbounded column and quietly undo the change being made.
    fromType: renderedType(prevC),
    toType: renderedType(curC),
    // MySQL spells a type change as `MODIFY COLUMN`, which RESTATES the whole
    // definition and drops whatever it does not restate. A generated migration
    // has no schema push behind it to put the nullability and default back, and
    // its DOWN cannot recover them at all unless the previous pair travels too.
    // See ChangeColumnTypeOp.
    nullable: curC.nullable,
    ...(curC.default !== undefined ? { columnDefault: curC.default } : {}),
    fromNullable: prevC.nullable,
    ...(prevC.default !== undefined
      ? { fromColumnDefault: prevC.default }
      : {}),
    // How a relation's values cross the change, where they must (`columnTypeChanges`).
    ...conversion,
  };
}

/** Whether a column type holds JSON: what a relation's list of references is stored as. */
function isJsonColumnType(type: string): boolean {
  const t = type.trim().toLowerCase();
  return t === "json" || t === "jsonb";
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
      typeChanges.push(...columnTypeChanges(tableName, name, prevC, curC));

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
      // "Still declared serial" is asked two ways, because the desired side
      // can say it two ways. A snapshot written from a Drizzle table spells
      // the type `serial`; one compiled from the extension model spells it
      // `int4` — deliberately, so the type comparison matches introspection —
      // and carries the fact in `autoIncrement` instead. Reading only the
      // spelling meant an extension table's generated key was seen as a plain
      // integer whose live `nextval` default must be dropped, and applying
      // that stops the database assigning keys at all.
      const stillGenerated =
        SERIAL_TYPES.has((curC.type ?? "").trim().toLowerCase()) ||
        curC.autoIncrement === true;
      const sequenceDefaultUnchanged =
        curC.default === undefined &&
        prevC.ownedSequenceDefault === true &&
        stillGenerated;

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
