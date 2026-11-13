/**
 * Which MySQL check drops and adds are one replacement, to run as one
 * `ALTER TABLE` (`replaceMysqlCheckSql`).
 *
 * MySQL commits each DDL statement as it runs, so a drop followed by a separate
 * add leaves the column unconstrained when the add fails — as it does while a
 * row holds a value a narrowed enum takes away. Both an apply's statements
 * (`kit-route-constraints.ts`) and a migration file's (`generateStatements`)
 * are paired here, so each path replaces a check the same way.
 *
 * @module domains/schema/pipeline/sql-templates/mysql-check-replacement
 */
import { enumColumnIn } from "../../extension/enum-check";
import type { AddCheckOp, DropCheckOp, Operation } from "../diff/types";

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

/** Whether `drop` can stay in place until its replacement's add on MySQL. */
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
 * Pairs each MySQL `drop_check` with the `add_check` replacing it, when
 * neither the table nor the constrained column is dropped, renamed or altered
 * among `ops`, so the drop can wait for its add. Keyed by the add, in the order
 * of the drops.
 */
export function mysqlCheckReplacements(
  ops: readonly Operation[]
): Map<AddCheckOp, DropCheckOp> {
  const scope = collectAlteredScope(ops);
  const adds = ops.filter((op): op is AddCheckOp => op.type === "add_check");
  const pairs = new Map<AddCheckOp, DropCheckOp>();
  const pairedAdds = new Set<AddCheckOp>();
  for (const drop of ops) {
    if (drop.type !== "drop_check") continue;
    const dropColumn = enumColumnIn(drop.check.sql);
    if (!canDeferMysqlCheckDrop(drop, dropColumn, scope)) continue;
    const match = findMatchingAddCheck(drop, dropColumn, adds, pairedAdds);
    if (match === undefined) continue;
    pairs.set(match, drop);
    pairedAdds.add(match);
  }
  return pairs;
}
