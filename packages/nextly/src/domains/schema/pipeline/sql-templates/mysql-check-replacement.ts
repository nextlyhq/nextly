/**
 * MySQL check replacements, run as one `ALTER TABLE` per table.
 *
 * MySQL commits every schema statement on its own, so a `drop_check` run ahead
 * of the `add_check` replacing it leaves the column unconstrained the moment
 * the add fails — and the add fails exactly when a row breaks the new check.
 * Every replacement this module can pair is therefore folded into the one
 * statement of its table, drops and adds together, so MySQL validates the new
 * checks before anything changes and keeps the old ones if a row is in the way.
 *
 * One statement per TABLE rather than per pair: two checks that exchange names
 * (column x's check taking the name column y's held, and the other way round)
 * are valid only once both old checks are gone, which separate statements never
 * reach — the first add would find its name still taken.
 *
 * Both the push path (`kit-route-constraints.ts`) and a generated migration
 * (`generateStatements`) render replacements through here, so a change applies
 * the same way whether it is pushed in development or migrated in production.
 *
 * @module domains/schema/pipeline/sql-templates/mysql-check-replacement
 */
import { enumColumnIn } from "../../extension/enum-check";
import type {
  AddCheckOp,
  CheckSpec,
  DropCheckOp,
  Operation,
} from "../diff/types";

import { checkClause } from "./create-table-body";
import { quoteIdent } from "./identifier-quoting";

const q = (n: string) => quoteIdent(n, "mysql");

/** The drops and adds of one table that run as one statement. */
interface TableReplacement {
  table: string;
  drops: DropCheckOp[];
  adds: AddCheckOp[];
}

/** The paired operations, and the statement each table's pairs become. */
export interface MysqlCheckReplacements {
  pairedDrops: Set<DropCheckOp>;
  pairedAdds: Set<AddCheckOp>;
  /** One `ALTER TABLE` per table holding a pair, in the order tables first pair. */
  statements: string[];
  /** The statement for the table an add belongs to, by that add. */
  statementFor: Map<AddCheckOp, string>;
}

/**
 * Where the replacements are written. An apply's own statements (`push`) run
 * a rename that MySQL refuses while a check uses the column, so a check on a
 * column the apply renames or alters is dropped ahead, on its own. A migration
 * file's (`file`) rename carries the column's checks across in its one
 * statement (`mysql-live-restate.ts`), and a type, nullability or default
 * change leaves them in force, so there only a column or table the file drops
 * takes its check's drop ahead with it.
 */
export type ReplacementRoute = "push" | "file";

interface AlteredScope {
  droppedTables: Set<string>;
  tablesWithAlteredColumns: Set<string>;
  alteredColumns: Set<string>;
  /** Table and old column name, lower-cased, to the name a rename gives it. */
  renamedTo: Map<string, string>;
}

/** Whether `op` changes a column so that a check on it must be dropped first. */
function blocksDeferral(op: Operation, route: ReplacementRoute): boolean {
  if (op.type === "drop_column") return true;
  if (route === "file") return false;
  return (
    op.type === "change_column_type" ||
    op.type === "change_column_nullable" ||
    op.type === "change_column_default" ||
    op.type === "rename_column"
  );
}

/** Collects tables and columns modified by the operations, which a live check could block. */
function collectAlteredScope(
  ops: readonly Operation[],
  route: ReplacementRoute
): AlteredScope {
  const droppedTables = new Set<string>();
  const tablesWithAlteredColumns = new Set<string>();
  const alteredColumns = new Set<string>();
  const renamedTo = new Map<string, string>();
  const markColumn = (table: string, column: string) => {
    const t = table.toLowerCase();
    tablesWithAlteredColumns.add(t);
    alteredColumns.add(`${t}.${column.toLowerCase()}`);
  };
  for (const op of ops) {
    if (op.type === "drop_table") {
      droppedTables.add(op.tableName.toLowerCase());
    } else if (op.type === "rename_column") {
      renamedTo.set(
        `${op.tableName.toLowerCase()}.${op.fromColumn.toLowerCase()}`,
        op.toColumn.toLowerCase()
      );
      if (blocksDeferral(op, route)) {
        markColumn(op.tableName, op.fromColumn);
        markColumn(op.tableName, op.toColumn);
      }
    } else if ("columnName" in op && blocksDeferral(op, route)) {
      markColumn(op.tableName, op.columnName);
    }
  }
  return { droppedTables, tablesWithAlteredColumns, alteredColumns, renamedTo };
}

/** Whether `drop` can stay in place until its replacement is added. */
function canDeferDrop(
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

/**
 * Finds an unpaired `add_check` replacing `drop` on the same table: one on the
 * same column, followed through a rename of it, or else one of the same name.
 */
function findMatchingAdd(
  drop: DropCheckOp,
  dropColumn: string | null,
  adds: readonly AddCheckOp[],
  pairedAdds: ReadonlySet<AddCheckOp>,
  scope: AlteredScope
): AddCheckOp | undefined {
  const tableKey = drop.tableName.toLowerCase();
  const liveColumn = dropColumn?.toLowerCase();
  const targetColumn =
    liveColumn === undefined
      ? undefined
      : (scope.renamedTo.get(`${tableKey}.${liveColumn}`) ?? liveColumn);
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
 * Replaces a table's MySQL CHECK constraints in one `ALTER TABLE`: every drop
 * first, then every add, so a name an old check held is free for its new one.
 */
function replaceMysqlChecksSql(
  tableName: string,
  dropCheckNames: readonly string[],
  addChecks: readonly CheckSpec[]
): string {
  const clauses = [
    ...dropCheckNames.map(name => `DROP CHECK ${q(name)}`),
    ...addChecks.map(
      check => `ADD CONSTRAINT ${q(check.name)} ${checkClause(check)}`
    ),
  ];
  return `ALTER TABLE ${q(tableName)} ${clauses.join(", ")}`;
}

/**
 * Pairs each `drop_check` with the `add_check` replacing it, where the route
 * lets the drop wait for the add (`ReplacementRoute`), and renders each
 * table's pairs as one statement.
 */
export function mysqlCheckReplacements(
  ops: readonly Operation[],
  route: ReplacementRoute
): MysqlCheckReplacements {
  const scope = collectAlteredScope(ops, route);
  const drops = ops.filter((op): op is DropCheckOp => op.type === "drop_check");
  const adds = ops.filter((op): op is AddCheckOp => op.type === "add_check");

  const pairedDrops = new Set<DropCheckOp>();
  const pairedAdds = new Set<AddCheckOp>();
  const tables = new Map<string, TableReplacement>();

  for (const drop of drops) {
    const dropColumn = enumColumnIn(drop.check.sql);
    if (!canDeferDrop(drop, dropColumn, scope)) continue;
    const match = findMatchingAdd(drop, dropColumn, adds, pairedAdds, scope);
    if (match === undefined) continue;
    pairedDrops.add(drop);
    pairedAdds.add(match);
    const key = match.tableName.toLowerCase();
    const entry = tables.get(key) ?? {
      table: match.tableName,
      drops: [],
      adds: [],
    };
    entry.drops.push(drop);
    entry.adds.push(match);
    tables.set(key, entry);
  }

  const statements: string[] = [];
  const statementFor = new Map<AddCheckOp, string>();
  for (const entry of tables.values()) {
    const statement = replaceMysqlChecksSql(
      entry.table,
      entry.drops.map(drop => drop.check.name),
      entry.adds.map(add => add.check)
    );
    statements.push(statement);
    for (const add of entry.adds) statementFor.set(add, statement);
  }
  return { pairedDrops, pairedAdds, statements, statementFor };
}

/**
 * A MySQL migration file's statements with every pairable check replacement
 * folded into its table's one statement, placed where the table's first paired
 * add stood; `render` renders every other operation as before.
 */
export function withMysqlCheckReplacements(
  ops: readonly Operation[],
  render: (op: Operation) => string[]
): string[] {
  const replacements = mysqlCheckReplacements(ops, "file");
  const emitted = new Set<string>();
  return ops.flatMap(op => {
    if (op.type === "drop_check" && replacements.pairedDrops.has(op)) return [];
    if (op.type === "add_check" && replacements.pairedAdds.has(op)) {
      const statement = replacements.statementFor.get(op);
      if (statement === undefined || emitted.has(statement)) return [];
      emitted.add(statement);
      return [statement];
    }
    return render(op);
  });
}
