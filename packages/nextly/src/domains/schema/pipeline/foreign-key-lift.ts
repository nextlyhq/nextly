/**
 * The foreign keys a MySQL column-type change has to lift, and the operation
 * sequence that lifts them.
 *
 * MySQL refuses to change the type of a column a foreign key covers or
 * references (errors 1832, 1833 and 3780) while the key is in place. One
 * answer to "which keys", shared by the two routes that change a type: dev
 * push's drizzle-kit route (`kit-route-constraints`) and every generated
 * migration file (`migrate:create`, app and plugin) — so a migration retyping
 * such a column applies on MySQL exactly as the push does.
 *
 * @module domains/schema/pipeline/foreign-key-lift
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type {
  AddForeignKeyOp,
  DropForeignKeyOp,
  ForeignKeySpec,
  Operation,
  TableSpec,
} from "./diff/types";

/**
 * `ops`, with every foreign key a type change must lift dropped first and
 * restored last — on MySQL. Other dialects change a covered column's type in
 * place, so their operations are returned unchanged.
 *
 * `before` is the schema the operations start from: the previous snapshot for
 * a migration file. Only a key that exists there can be dropped; the lift is
 * the same one dev push performs against the live schema.
 *
 * Applied to the UP operations only. A migration's down side is built by
 * inverting them, and the inverse of drop-change-add is drop-change-back-add,
 * which lifts the same keys around the reverse change.
 */
export function withForeignKeysLiftedForTypeChanges(
  ops: readonly Operation[],
  before: readonly TableSpec[],
  dialect: SupportedDialect
): Operation[] {
  if (dialect !== "mysql") return [...ops];
  const lifted = foreignKeysBlockingTypeChanges(ops, before);
  if (lifted.length === 0) return [...ops];
  return [
    ...lifted.map(lift => lift.drop),
    ...ops,
    ...lifted.map(lift => lift.restore),
  ];
}

/**
 * One key lifted around a type change: dropped under the names it has
 * BEFORE the operations run, restored under the names it has AFTER them —
 * which differ when the same operations rename its table or a column it
 * covers or references.
 */
export interface LiftedForeignKey {
  drop: DropForeignKeyOp;
  restore: AddForeignKeyOp;
}

/**
 * The foreign keys a MySQL column-type change must lift for its duration:
 * those in the LIVE schema whose own columns or referenced columns include a
 * changed column. Read from what exists, because only an existing key can be
 * dropped — one this apply adds is created afterwards by its own operation.
 * A key the diff already drops is left to that drop, and to the add that
 * replaces it when it is being re-keyed. So is a key that will not survive the
 * apply at all — on a table it drops, or over a column it drops — since there
 * would be nothing to add it back to.
 *
 * A changed column is named as the operations leave it, and a key as it
 * exists before them. Each key is therefore carried through the renames the
 * operations make before it is compared, and restored under those names. A
 * rename that also changes the column's type is a type change in its own
 * right.
 */
export function foreignKeysBlockingTypeChanges(
  ops: readonly Operation[],
  liveTables: readonly TableSpec[]
): LiftedForeignKey[] {
  const changed = new Set([
    ...keysOf(ops, "change_column_type", op =>
      columnKey(op.tableName, op.columnName)
    ),
    ...ops.flatMap(op =>
      op.type === "rename_column" && op.fromType !== op.toType
        ? [columnKey(op.tableName, op.toColumn)]
        : []
    ),
  ]);
  if (changed.size === 0) return [];
  const survives = survivalCheck(ops);
  const renamed = renamesOf(ops);
  return liveTables.flatMap(table =>
    (table.foreignKeys ?? [])
      .filter(foreignKey => survives(table.name, foreignKey))
      .map(foreignKey => ({
        live: foreignKey,
        final: renamed.foreignKey(table.name, foreignKey),
        table: renamed.table(table.name),
      }))
      .filter(key => touchesChangedColumn(key.table, key.final, changed))
      .map(key => ({
        drop: {
          type: "drop_foreign_key" as const,
          tableName: table.name,
          foreignKey: key.live,
        },
        restore: {
          type: "add_foreign_key" as const,
          tableName: key.table,
          foreignKey: key.final,
        },
      }))
  );
}

/**
 * The names the operations' renames give a table, a column, and a whole key.
 * A rename-column op names its table as the operations leave it.
 */
function renamesOf(ops: readonly Operation[]) {
  const tables = new Map<string, string>();
  const columns = new Map<string, string>();
  for (const op of ops) {
    if (op.type === "rename_table") {
      tables.set(op.fromName.toLowerCase(), op.toName);
    } else if (op.type === "rename_column") {
      columns.set(columnKey(op.tableName, op.fromColumn), op.toColumn);
    }
  }
  const table = (name: string): string =>
    tables.get(name.toLowerCase()) ?? name;
  const column = (tableName: string, name: string): string =>
    columns.get(columnKey(table(tableName), name)) ?? name;
  return {
    table,
    foreignKey: (tableName: string, key: ForeignKeySpec): ForeignKeySpec => ({
      ...key,
      columns: key.columns.map(name => column(tableName, name)),
      referencesTable: table(key.referencesTable),
      referencesColumns: key.referencesColumns.map(name =>
        column(key.referencesTable, name)
      ),
    }),
  };
}

/**
 * Whether a live key outlasts the apply untouched: not dropped (or re-keyed)
 * by the diff itself, and not on a table or over a column the apply drops.
 */
function survivalCheck(
  ops: readonly Operation[]
): (tableName: string, foreignKey: ForeignKeySpec) => boolean {
  const dropped = keysOf(ops, "drop_foreign_key", op =>
    columnKey(op.tableName, op.foreignKey.name)
  );
  const droppedTables = keysOf(ops, "drop_table", op =>
    op.tableName.toLowerCase()
  );
  const droppedColumns = keysOf(ops, "drop_column", op =>
    columnKey(op.tableName, op.columnName)
  );
  return (tableName, foreignKey) =>
    !droppedTables.has(tableName.toLowerCase()) &&
    !dropped.has(columnKey(tableName, foreignKey.name)) &&
    !foreignKey.columns.some(column =>
      droppedColumns.has(columnKey(tableName, column))
    );
}

/** The keys `keyOf` gives for every operation of one type. */
function keysOf<T extends Operation["type"]>(
  ops: readonly Operation[],
  type: T,
  keyOf: (op: Extract<Operation, { type: T }>) => string
): Set<string> {
  return new Set(
    ops
      .filter((op): op is Extract<Operation, { type: T }> => op.type === type)
      .map(keyOf)
  );
}

function touchesChangedColumn(
  tableName: string,
  foreignKey: ForeignKeySpec,
  changed: ReadonlySet<string>
): boolean {
  return (
    foreignKey.columns.some(column =>
      changed.has(columnKey(tableName, column))
    ) ||
    foreignKey.referencesColumns.some(column =>
      changed.has(columnKey(foreignKey.referencesTable, column))
    )
  );
}

function columnKey(tableName: string, name: string): string {
  return `${tableName.toLowerCase()}\u0000${name.toLowerCase()}`;
}
