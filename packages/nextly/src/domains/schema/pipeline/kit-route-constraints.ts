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

import { enumColumnIn } from "../extension/enum-check";

import { tableConstraintOps } from "./ddl-emitter";
import type {
  AddCheckOp,
  DropCheckOp,
  Operation,
  TableSpec,
} from "./diff/types";
import { foreignKeysBlockingTypeChanges } from "./foreign-key-lift";
import { generateSQL, replaceMysqlCheckSql } from "./sql-templates";

/** Statements to run before the kit's batch, and after it. */
export interface KitRouteConstraintStatements {
  before: string[];
  after: string[];
  /**
   * The statements in `after` that add back a key `before` lifted on MySQL: what an apply failing
   * between the two batches owes the database, since MySQL commits the drop as it runs.
   */
  liftRestores: string[];
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
  if (dialect === "sqlite") return { before: [], after: [], liftRestores: [] };

  const atomic =
    dialect === "mysql"
      ? mysqlAtomicCheckReplacements(ops)
      : {
          pairedDrops: new Set<DropCheckOp>(),
          pairedAdds: new Set<AddCheckOp>(),
          statements: [],
        };

  const { before, after } = partitionConstraintOps(ops, dialect, atomic);
  const suspended =
    dialect === "mysql" ? foreignKeysBlockingTypeChanges(ops, liveTables) : [];
  before.push(...suspended.map(lift => lift.drop));
  after.push(...suspended.map(lift => lift.restore));
  const afterStatements = [
    ...atomic.statements,
    ...after.map(op => generateSQL(op, dialect)),
  ];
  return {
    before: before.map(op => generateSQL(op, dialect)),
    after: afterStatements,
    // The lifted keys' restores are the last of `after`, so they are read from it rather than
    // rendered a second time: a failed apply adds back exactly what a successful one would.
    liftRestores: afterStatements.slice(
      afterStatements.length - suspended.length
    ),
  };
}

function isPreKitConstraintDrop(
  op: Operation,
  pairedDrops: ReadonlySet<DropCheckOp>
): boolean {
  if (op.type === "drop_check") return !pairedDrops.has(op);
  // A key ahead of a conversion is the pre-resolution pass's to drop, before the conversion.
  return op.type === "drop_foreign_key" && op.beforeConversion !== true;
}

function postKitConstraintOps(
  op: Operation,
  dialect: SupportedDialect,
  pairedAdds: ReadonlySet<AddCheckOp>
): Operation[] {
  switch (op.type) {
    case "add_check":
      return pairedAdds.has(op) ? [] : [op];
    case "add_foreign_key":
    case "change_foreign_key_action":
      return [op];
    case "add_table":
      return dialect === "postgresql" ? tableConstraintOps(op.table) : [];
    default:
      return [];
  }
}

/** Splits non-paired constraint operations into pre-kit `before` and post-kit `after`. */
function partitionConstraintOps(
  ops: readonly Operation[],
  dialect: SupportedDialect,
  paired: { pairedDrops: Set<DropCheckOp>; pairedAdds: Set<AddCheckOp> }
): { before: Operation[]; after: Operation[] } {
  const before: Operation[] = [];
  const after: Operation[] = [];
  for (const op of ops) {
    if (isPreKitConstraintDrop(op, paired.pairedDrops)) {
      before.push(op);
    } else {
      after.push(...postKitConstraintOps(op, dialect, paired.pairedAdds));
    }
  }
  return { before, after };
}

interface AlteredScope {
  droppedTables: Set<string>;
  tablesWithAlteredColumns: Set<string>;
  alteredColumns: Set<string>;
}

/** Collects tables and columns modified by the apply, which a live check could block. */
function collectAlteredScope(ops: readonly Operation[]): AlteredScope {
  const droppedTables = new Set<string>();
  const tablesWithAlteredColumns = new Set<string>();
  const alteredColumns = new Set<string>();
  const markColumn = (table: string, column: string) => {
    const t = table.toLowerCase();
    tablesWithAlteredColumns.add(t);
    alteredColumns.add(`${t}.${column.toLowerCase()}`);
  };
  for (const op of ops) {
    if (op.type === "drop_table") {
      droppedTables.add(op.tableName.toLowerCase());
    } else if (
      op.type === "drop_column" ||
      op.type === "change_column_type" ||
      op.type === "change_column_nullable" ||
      op.type === "change_column_default"
    ) {
      markColumn(op.tableName, op.columnName);
    } else if (op.type === "rename_column") {
      markColumn(op.tableName, op.fromColumn);
      markColumn(op.tableName, op.toColumn);
    }
  }
  return { droppedTables, tablesWithAlteredColumns, alteredColumns };
}

/** Whether `drop` can stay in place until `after` for atomic replacement on MySQL. */
function canDeferMysqlCheckDrop(
  drop: DropCheckOp,
  dropColumn: string | null,
  scope: AlteredScope
): boolean {
  const tableKey = drop.tableName.toLowerCase();
  if (scope.droppedTables.has(tableKey)) return false;
  if (dropColumn !== null) {
    return !scope.alteredColumns.has(`${tableKey}.${dropColumn.toLowerCase()}`);
  }
  return !scope.tablesWithAlteredColumns.has(tableKey);
}

/** Finds an unpaired `add_check` replacing `drop` on the same table and column/name. */
function findMatchingAddCheck(
  drop: DropCheckOp,
  dropColumn: string | null,
  adds: readonly AddCheckOp[],
  pairedAdds: ReadonlySet<AddCheckOp>
): AddCheckOp | undefined {
  const tableKey = drop.tableName.toLowerCase();
  const targetColumn = dropColumn?.toLowerCase();
  const targetName = drop.check.name.toLowerCase();
  return adds.find(add => {
    if (pairedAdds.has(add) || add.tableName.toLowerCase() !== tableKey) {
      return false;
    }
    if (targetColumn !== undefined) {
      return enumColumnIn(add.check.sql)?.toLowerCase() === targetColumn;
    }
    return add.check.name.toLowerCase() === targetName;
  });
}

/**
 * Pairs each MySQL `drop_check` + `add_check` that can run as one atomic
 * `ALTER TABLE` when neither the table nor the constrained column is dropped,
 * renamed, or altered in the same apply.
 */
function mysqlAtomicCheckReplacements(ops: readonly Operation[]): {
  pairedDrops: Set<DropCheckOp>;
  pairedAdds: Set<AddCheckOp>;
  statements: string[];
} {
  const scope = collectAlteredScope(ops);
  const drops = ops.filter((op): op is DropCheckOp => op.type === "drop_check");
  const adds = ops.filter((op): op is AddCheckOp => op.type === "add_check");

  const pairedDrops = new Set<DropCheckOp>();
  const pairedAdds = new Set<AddCheckOp>();
  const statements: string[] = [];

  for (const drop of drops) {
    const dropColumn = enumColumnIn(drop.check.sql);
    if (!canDeferMysqlCheckDrop(drop, dropColumn, scope)) continue;
    const match = findMatchingAddCheck(drop, dropColumn, adds, pairedAdds);
    if (match === undefined) continue;
    pairedDrops.add(drop);
    pairedAdds.add(match);
    statements.push(
      replaceMysqlCheckSql(match.tableName, drop.check.name, match.check)
    );
  }

  return { pairedDrops, pairedAdds, statements };
}
