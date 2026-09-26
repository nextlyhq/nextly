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
import type { Operation, TableSpec } from "./diff/types";
import { foreignKeysBlockingTypeChanges } from "./foreign-key-lift";
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
    before.push(...suspended.map(lift => lift.drop));
    after.push(...suspended.map(lift => lift.restore));
  }
  return {
    before: before.map(op => generateSQL(op, dialect)),
    after: after.map(op => generateSQL(op, dialect)),
  };
}
