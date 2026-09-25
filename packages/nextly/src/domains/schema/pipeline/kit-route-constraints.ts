/**
 * The check and foreign-key statements an apply on drizzle-kit's route runs
 * itself, on PostgreSQL and MySQL.
 *
 * On those dialects the runtime tables handed to drizzle-kit carry no checks
 * and no foreign keys — they are created by statements of their own — so the
 * kit never adds, changes or re-keys one, and its drops of the declared ones
 * are held back (`stripKitDropsOfDeclaredConstraints`). Every constraint
 * operation the diff planned is therefore this pipeline's to execute, through
 * the same statement templates a generated migration uses.
 *
 * SQLite is absent on purpose: its runtime tables DO declare their checks and
 * foreign keys, because it accepts them nowhere but CREATE TABLE, and the kit
 * applies a change to one by rebuilding the table.
 *
 * @module domains/schema/pipeline/kit-route-constraints
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { tableConstraintOps } from "./ddl-emitter";
import type {
  DropForeignKeyOp,
  ForeignKeySpec,
  Operation,
  TableSpec,
} from "./diff/types";
import { generateSQL } from "./sql-templates";

/** Statements to run before the kit's batch, and after it. */
export interface KitRouteConstraintStatements {
  before: string[];
  after: string[];
}

/**
 * Split so each statement runs where it can succeed.
 *
 * Before the kit — and before the pre-resolution drops of columns and tables,
 * which a constraint still in place would block: every drop the diff planned.
 * On MySQL also any foreign key that EXISTS and covers a column whose type the
 * kit is about to change — MySQL refuses that change while the key is there —
 * to be added back afterwards.
 *
 * After the kit: every add and action change, once the tables and columns
 * they name exist; and on PostgreSQL the constraints of each table the kit
 * created, which it created without them. MySQL's new tables were created
 * ahead of the kit by the emitter, constraints included.
 */
export function kitRouteConstraintStatements(
  ops: readonly Operation[],
  liveTables: readonly TableSpec[],
  dialect: SupportedDialect
): KitRouteConstraintStatements {
  if (dialect === "sqlite") return { before: [], after: [] };

  const before: Operation[] = [];
  const after: Operation[] = [];
  for (const op of ops) {
    switch (op.type) {
      case "drop_check":
      case "drop_foreign_key":
        before.push(op);
        break;
      case "add_check":
      case "add_foreign_key":
      case "change_foreign_key_action":
        after.push(op);
        break;
      case "add_table":
        if (dialect === "postgresql")
          after.push(...tableConstraintOps(op.table));
        break;
      default:
        break;
    }
  }
  if (dialect === "mysql") {
    const suspended = foreignKeysBlockingTypeChanges(ops, liveTables);
    before.push(...suspended);
    after.push(
      ...suspended.map(op => ({
        type: "add_foreign_key" as const,
        tableName: op.tableName,
        foreignKey: op.foreignKey,
      }))
    );
  }
  return {
    before: before.map(op => generateSQL(op, dialect)),
    after: after.map(op => generateSQL(op, dialect)),
  };
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
 */
function foreignKeysBlockingTypeChanges(
  ops: readonly Operation[],
  liveTables: readonly TableSpec[]
): DropForeignKeyOp[] {
  const changed = keysOf(ops, "change_column_type", op =>
    columnKey(op.tableName, op.columnName)
  );
  if (changed.size === 0) return [];
  const survives = survivalCheck(ops);
  return liveTables.flatMap(table =>
    (table.foreignKeys ?? [])
      .filter(
        foreignKey =>
          survives(table.name, foreignKey) &&
          touchesChangedColumn(table.name, foreignKey, changed)
      )
      .map(foreignKey => ({
        type: "drop_foreign_key" as const,
        tableName: table.name,
        foreignKey,
      }))
  );
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
