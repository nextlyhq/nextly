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
 * Before the kit: every drop the diff planned, since the constraint already
 * exists and the kit's changes may depend on it being gone. On MySQL also any
 * foreign key covering a column whose type the kit is about to change — MySQL
 * refuses that change while the key exists — to be added back afterwards.
 *
 * After the kit: every add and action change, once the tables and columns
 * they name exist; and on PostgreSQL the constraints of each table the kit
 * created, which it created without them. MySQL's new tables were created
 * ahead of the kit by the emitter, constraints included.
 */
export function kitRouteConstraintStatements(
  ops: readonly Operation[],
  desiredTables: readonly TableSpec[],
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
    const suspended = foreignKeysBlockingTypeChanges(ops, desiredTables);
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
 * The declared foreign keys a MySQL column-type change must lift for its
 * duration: those whose own columns or referenced columns include a changed
 * column. A key the diff already drops is left to that drop.
 */
function foreignKeysBlockingTypeChanges(
  ops: readonly Operation[],
  desiredTables: readonly TableSpec[]
): DropForeignKeyOp[] {
  const changed = new Set(
    ops
      .filter(op => op.type === "change_column_type")
      .map(op => columnKey(op.tableName, op.columnName))
  );
  if (changed.size === 0) return [];
  const alreadyDropped = new Set(
    ops
      .filter(op => op.type === "drop_foreign_key")
      .map(op => columnKey(op.tableName, op.foreignKey.name))
  );
  const blocking: DropForeignKeyOp[] = [];
  for (const table of desiredTables) {
    for (const foreignKey of table.foreignKeys ?? []) {
      if (alreadyDropped.has(columnKey(table.name, foreignKey.name))) continue;
      if (!touchesChangedColumn(table.name, foreignKey, changed)) continue;
      blocking.push({
        type: "drop_foreign_key",
        tableName: table.name,
        foreignKey,
      });
    }
  }
  return blocking;
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
