/**
 * A SQLite table rebuilt to carry different checks or foreign keys.
 *
 * SQLite cannot add or drop a CHECK or a FOREIGN KEY on a table that exists:
 * both live only in the CREATE TABLE statement. The one way to change them is
 * to create the table again with the new definition and move its rows across,
 * which is what this renders. A single operation cannot say what the whole
 * table should look like afterwards, so this works from the table's target
 * spec rather than from the operation.
 *
 * The form is SQLite's own: create `__new_<t>` with the target definition,
 * copy the rows, drop `<t>`, rename `__new_<t>` into its place, recreate the
 * indexes the drop took with it. It relies on the migration runner's SQLite
 * contract: every file runs with `PRAGMA foreign_keys = OFF` around its
 * transaction and `PRAGMA foreign_key_check` before COMMIT. With foreign keys
 * off, dropping the table deletes nothing through another table's ON DELETE
 * action, and the rename leaves every other table's reference naming `<t>` —
 * which is the rebuilt table once the rename lands. The check before COMMIT
 * refuses a new foreign key the existing rows violate.
 *
 * Two things that contract does not cover are refused at apply time, before
 * anything is dropped, by a guard row whose CHECKs fail with a message naming
 * the table:
 *
 * - Foreign keys still ON. Then the drop fires every referencing table's ON
 *   DELETE action — a CASCADE child loses its rows, a SET NULL child its
 *   references — and `PRAGMA foreign_keys = OFF` inside a transaction is a
 *   no-op, so a runner that did not turn them off beforehand cannot be
 *   rescued from here. Measured on SQLite 3.53.
 * - Triggers on the table. They are dropped with it, and the schema model
 *   does not track triggers, so nothing here could recreate them.
 * - Foreign keys or checks the target spec does not TRACK (`undefined`, as an
 *   entity's spec leaves foreign keys) while the live table has some. The
 *   rebuilt table is declared from the spec, so it would come back without
 *   them — a cascade or a check silently gone. An entity's spec cannot track
 *   them: the Schema Builder declares a relationship's foreign key in CREATE
 *   TABLE, but on SQLite a relationship added to an existing table gets none
 *   (SQLite cannot add a constraint to a table), so two tables with the same
 *   fields hold different foreign keys depending on their history, and no
 *   spec derived from the fields could describe both. The refusal fires only
 *   where something would be lost. Foreign keys are counted from
 *   `pragma_foreign_key_list`; SQLite keeps no catalog of checks, so any
 *   `CHECK` in the stored CREATE statement counts, which refuses rather than
 *   risks a false "none".
 *
 * @module domains/schema/pipeline/sql-templates/sqlite-rebuild
 */
import { NextlyError } from "../../../../errors/nextly-error";
import type { Operation, TableSpec } from "../diff/types";

import { createIndexSql } from "./create-index";
import { createTableBody, resolvePrimaryKey } from "./create-table-body";
import { quoteIdent } from "./identifier-quoting";

const q = (name: string) => quoteIdent(name, "sqlite");

/** A SQL string literal. */
const literalOf = (text: string): string => `'${text.replace(/'/g, "''")}'`;

/** The operations SQLite can only perform by rebuilding the table. */
const REBUILD_OPERATIONS = new Set<Operation["type"]>([
  "add_check",
  "drop_check",
  "add_foreign_key",
  "drop_foreign_key",
  "change_foreign_key_action",
]);

/**
 * The tables, lower-cased, whose checks or foreign keys a list of operations
 * changes — each one SQLite can only change by rebuilding it. Shared with the
 * dev-push pipeline, whose SQLite applies rebuild the same tables.
 */
export function sqliteRebuiltTables(ops: readonly Operation[]): Set<string> {
  return new Set(
    ops.flatMap(op =>
      REBUILD_OPERATIONS.has(op.type)
        ? tablesOf(op).map(name => name.toLowerCase())
        : []
    )
  );
}

/**
 * The operations less the column drops a rebuild performs itself.
 *
 * SQLite refuses `ALTER TABLE ... DROP COLUMN` on a column a foreign key or a
 * check names, and the diff drops such a constraint in the same list as the
 * column. A table that is rebuilt is recreated from its target definition,
 * which no longer has the column, and only the target's columns are copied
 * across — so the drop happens there and must not run on its own first.
 */
export function withoutDropsLeftToRebuild(
  ops: readonly Operation[],
  rebuilt: ReadonlySet<string>
): Operation[] {
  return ops.filter(
    op =>
      !(op.type === "drop_column" && rebuilt.has(op.tableName.toLowerCase()))
  );
}

/**
 * The statements that rebuild one table to `table`'s definition, preserving
 * its rows. The live table must have every one of `table`'s columns; any it
 * has beyond them are not copied, which is how a column drop on a rebuilt
 * table takes effect.
 */
export function sqliteTableRebuildStatements(
  spec: TableSpec,
  /** The operations this rebuild stands in for (see `untrackedConstraintCounts`). */
  ops: readonly Operation[] = []
): string[] {
  const table = resolvePrimaryKey(spec);
  // Without a key the rebuilt table would silently lose it, and an INTEGER
  // PRIMARY KEY is the rowid itself, so this is refused rather than guessed.
  if (!table.columns.some(column => column.primaryKey === true)) {
    throw NextlyError.internal({
      logContext: {
        reason: "sqlite-rebuild-without-primary-key",
        table: table.name,
      },
    });
  }
  const name = table.name;
  const literal = literalOf(name);
  const rebuilt = `__new_${name}`;
  const guard = `__nextly_rebuild_${name}_guard`;
  const columns = table.columns.map(column => q(column.name)).join(", ");
  const needsForeignKeysOff = `rebuilding ${name} needs foreign keys off: apply it with nextly migrate`;
  const wouldDropTriggers = `rebuilding ${name} would drop the triggers on it`;
  const untracked = untrackedConstraintCounts(table, ops);
  return [
    // The guard: one row, checked on insert, before anything is dropped.
    `CREATE TABLE ${q(guard)} ("foreign_keys" INTEGER NOT NULL, ` +
      `"triggers" INTEGER NOT NULL, ` +
      `"untracked_foreign_keys" INTEGER NOT NULL, ` +
      `"untracked_checks" INTEGER NOT NULL, ` +
      `CONSTRAINT ${q(needsForeignKeysOff)} CHECK ("foreign_keys" = 0), ` +
      `CONSTRAINT ${q(wouldDropTriggers)} CHECK ("triggers" = 0), ` +
      `CONSTRAINT ${q(untrackedConstraintRefusal(name, "foreign keys"))} CHECK ("untracked_foreign_keys" <= 0), ` +
      `CONSTRAINT ${q(untrackedConstraintRefusal(name, "checks"))} CHECK ("untracked_checks" <= 0))`,
    `INSERT INTO ${q(guard)} ("foreign_keys", "triggers", ` +
      `"untracked_foreign_keys", "untracked_checks") ` +
      `SELECT (SELECT "foreign_keys" FROM pragma_foreign_keys), ` +
      `(SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ${literal}), ` +
      `${untracked.foreignKeys}, ${untracked.checks}`,
    `DROP TABLE ${q(guard)}`,
    `CREATE TABLE ${q(rebuilt)} (\n${createTableBody(table, q, "  ", "sqlite")}\n)`,
    `INSERT INTO ${q(rebuilt)} (${columns}) SELECT ${columns} FROM ${q(name)}`,
    `DROP TABLE ${q(name)}`,
    `ALTER TABLE ${q(rebuilt)} RENAME TO ${q(name)}`,
    // The drop took every index with it.
    ...(table.indexes ?? []).map(index =>
      createIndexSql(name, index, "sqlite", q)
    ),
  ];
}

/**
 * The refusal for a rebuild that would lose constraints the schema does not
 * describe. It says what to do, because the rebuild guard reports it as a bare
 * constraint name in "CHECK constraint failed: ...": no generated rebuild can
 * keep such a constraint, only a migration that declares it can.
 */
export function untrackedConstraintRefusal(
  table: string,
  kind: "foreign keys" | "checks"
): string {
  return `rebuilding ${table} would drop ${kind} its schema does not track: write this change as a manual migration (nextly migrate:create --blank) that recreates ${table} with its ${kind}`;
}

/**
 * SQL expressions counting the constraints the LIVE table `table.name` has
 * that `table` does not declare — what rebuilding it from `table` would
 * silently lose. Evaluated against the database, never against a snapshot:
 * whether such a constraint exists is a fact of the table's history (a Schema
 * Builder table on SQLite has a relationship's foreign key only if the
 * relationship existed when the table was created), which no spec records.
 *
 * The one implementation of that question: the migration rebuild's guard
 * embeds these expressions, and the dev-push pipeline runs them before
 * handing a SQLite rebuild to drizzle-kit, which rebuilds from its runtime
 * tables and would lose the same constraints.
 *
 * - Foreign keys: `pragma_foreign_key_list` rows whose (referenced table,
 *   column) pair no declared foreign key covers. Case-folded, as SQLite
 *   resolves names.
 * - Checks: SQLite keeps no catalog of them, so the `CHECK (` clauses in the
 *   stored CREATE statement are counted, less the declared checks whose name
 *   appears quoted in it. A positive count is an undeclared check. Whitespace
 *   inside the clause opener is folded first, so `CHECK\n(` still counts.
 */
export function untrackedConstraintCounts(
  table: TableSpec,
  /**
   * The operations the rebuild carries out. A constraint they drop is live
   * and no longer declared, and it is gone on purpose, so it counts as known.
   */
  ops: readonly Operation[]
): {
  foreignKeys: string;
  checks: string;
} {
  const name = literalOf(table.name);
  const onThisTable = ops.filter(
    op =>
      op.type !== "add_table" &&
      op.type !== "rename_table" &&
      op.tableName.toLowerCase() === table.name.toLowerCase()
  );
  const knownForeignKeys = [
    ...(table.foreignKeys ?? []),
    ...onThisTable.flatMap(op =>
      op.type === "drop_foreign_key" ? [op.foreignKey] : []
    ),
  ];
  const knownChecks = [
    ...(table.checks ?? []),
    ...onThisTable.flatMap(op => (op.type === "drop_check" ? [op.check] : [])),
  ];
  const declaredPairs = [
    ...knownForeignKeys.flatMap(fk =>
      fk.columns.map(column =>
        literalOf(`${fk.referencesTable}.${column}`.toLowerCase())
      )
    ),
    // A referential-action change keeps its key: same column, same target.
    ...onThisTable.flatMap(op =>
      op.type === "change_foreign_key_action"
        ? [literalOf(`${op.referencesTable}.${op.columnName}`.toLowerCase())]
        : []
    ),
  ];
  const foreignKeys =
    `(SELECT COUNT(*) FROM pragma_foreign_key_list(${name})` +
    (declaredPairs.length > 0
      ? ` WHERE lower("table" || '.' || "from") NOT IN (${declaredPairs.join(", ")})`
      : "") +
    ")";
  const folded =
    "replace(replace(replace(replace(replace(upper(sql), char(10), ' '), char(13), ' '), char(9), ' '), '  ', ' '), '  ', ' ')";
  const clauses =
    `((length(${folded}) - length(replace(${folded}, 'CHECK (', ''))) / 7 + ` +
    `(length(${folded}) - length(replace(${folded}, 'CHECK(', ''))) / 6)`;
  const declared = knownChecks.map(
    check =>
      `(instr(sql, ${literalOf(`"${check.name}"`)}) > 0 OR instr(sql, ${literalOf(`\`${check.name}\``)}) > 0)`
  );
  // COALESCE: a table with no stored statement has no checks to lose.
  const checks =
    `COALESCE((SELECT ${clauses}${declared.length > 0 ? ` - (${declared.join(" + ")})` : ""} ` +
    `FROM sqlite_master WHERE type = 'table' AND name = ${name}), 0)`;
  return { foreignKeys, checks };
}

/** Every table name an operation reads or writes. */
function tablesOf(op: Operation): string[] {
  switch (op.type) {
    case "add_table":
      return [op.table.name];
    case "rename_table":
      return [op.fromName, op.toName];
    default:
      return [op.tableName];
  }
}

/**
 * SQLite statements for a list of operations, with every check and
 * foreign-key change folded into one rebuild per table.
 *
 * The rebuild takes the place of the LAST operation that touches its table,
 * so every column, index and rename change to that table has already run and
 * the live table has the target's columns when its rows are copied. Its column
 * drops are the exception: they are left to the rebuild, which copies only the
 * target's columns (`withoutDropsLeftToRebuild`). The
 * target is the table as it stands once the whole list has run, looked up by
 * name in `tablesAfter`.
 */
export function sqliteStatements(
  ops: readonly Operation[],
  tablesAfter: readonly TableSpec[],
  render: (op: Operation) => string
): string[] {
  const rebuilt = sqliteRebuiltTables(ops);
  const planned = withoutDropsLeftToRebuild(ops, rebuilt);
  const lastTouch = new Map<string, number>();
  planned.forEach((op, position) => {
    for (const table of tablesOf(op)) {
      const key = table.toLowerCase();
      if (rebuilt.has(key)) lastTouch.set(key, position);
    }
  });
  const statements: string[] = [];
  planned.forEach((op, position) => {
    if (!REBUILD_OPERATIONS.has(op.type)) statements.push(render(op));
    for (const [table, last] of lastTouch) {
      if (last !== position) continue;
      const target = tablesAfter.find(
        spec => spec.name.toLowerCase() === table
      );
      if (target === undefined) {
        throw NextlyError.internal({
          logContext: { reason: "sqlite-rebuild-without-target", table },
        });
      }
      statements.push(...sqliteTableRebuildStatements(target, ops));
    }
  });
  return statements;
}
