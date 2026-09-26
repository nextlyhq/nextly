/**
 * The statements every dialect spells the same way but for how it quotes an
 * identifier, written once with the quote function as a parameter.
 *
 * The per-dialect template modules used to carry a copy each, identical but
 * for the quote character — and copies drift: MySQL's check and foreign-key
 * statements had kept raw backticks after the others moved to the quote
 * function. What genuinely differs by dialect (dropping a check or a foreign
 * key, dropping a table, dropping an index, the column-altering statements)
 * stays in each dialect's module.
 *
 * @module domains/schema/pipeline/sql-templates/common-statements
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type {
  AddCheckOp,
  AddColumnOp,
  AddForeignKeyOp,
  AddTableOp,
  DropColumnOp,
  Operation,
  RenameColumnOp,
  RenameTableOp,
} from "../diff/types";

import { createIndexSql } from "./create-index";
import {
  checkClause,
  columnDefinition,
  createTableBody,
  foreignKeyClause,
  renderedType,
  type QuoteIdentifier,
} from "./create-table-body";

/**
 * A new table: its CREATE statement, then its tracked indexes, joined as one
 * entry. When `indexes` is undefined (a snapshot predating index tracking)
 * none are emitted. The table's own column types travel to the index
 * renderer, which on MySQL keys a TEXT/BLOB column by prefix.
 */
function addTableSql(
  op: AddTableOp,
  dialect: SupportedDialect,
  q: QuoteIdentifier
): string {
  const body = createTableBody(op.table, q, "  ", dialect);
  const createTable = `CREATE TABLE ${q(op.table.name)} (\n${body}\n)`;
  const columnTypes = new Map(
    op.table.columns.map(c => [c.name, renderedType(c)])
  );
  const indexStmts = (op.table.indexes ?? []).map(index =>
    createIndexSql(op.table.name, index, dialect, q, { columnTypes })
  );
  return [createTable, ...indexStmts].join(";\n");
}

/**
 * A check added to a table that exists. No dialect offers IF NOT EXISTS for
 * a constraint; the diff never adds a name the previous snapshot carried, so
 * a collision is a real drift. MySQL needs 8.0.16 for CHECK to be enforced
 * rather than parsed and ignored; the adapter's capability probe refuses
 * older servers.
 */
function addCheckSql(op: AddCheckOp, q: QuoteIdentifier): string {
  return `ALTER TABLE ${q(op.tableName)} ADD CONSTRAINT ${q(op.check.name)} ${checkClause(op.check)}`;
}

/** A foreign key added to a table that exists. */
function addForeignKeySpecSql(op: AddForeignKeyOp, q: QuoteIdentifier): string {
  return `ALTER TABLE ${q(op.tableName)} ADD CONSTRAINT ${q(op.foreignKey.name)} ${foreignKeyClause(op.foreignKey, q)}`;
}

function renameTableSql(op: RenameTableOp, q: QuoteIdentifier): string {
  return `ALTER TABLE ${q(op.fromName)} RENAME TO ${q(op.toName)}`;
}

function addColumnSql(op: AddColumnOp, q: QuoteIdentifier): string {
  return `ALTER TABLE ${q(op.tableName)} ADD COLUMN ${columnDefinition(op.column, q)}`;
}

function dropColumnSql(op: DropColumnOp, q: QuoteIdentifier): string {
  return `ALTER TABLE ${q(op.tableName)} DROP COLUMN ${q(op.columnName)}`;
}

function renameColumnSql(op: RenameColumnOp, q: QuoteIdentifier): string {
  return `ALTER TABLE ${q(op.tableName)} RENAME COLUMN ${q(op.fromColumn)} TO ${q(op.toColumn)}`;
}

/** The operations every dialect renders alike, but for its quote function. */
export type CommonOperation = Extract<
  Operation,
  {
    type:
      | "add_table"
      | "rename_table"
      | "add_column"
      | "drop_column"
      | "rename_column"
      | "add_check"
      | "add_foreign_key";
  }
>;

/**
 * One of those operations, for the dialect dispatchers to route to. A switch
 * of its own, so it too is exhaustive: a member added to `CommonOperation`
 * without a statement here is a compile error.
 */
export function commonStatementSql(
  op: CommonOperation,
  dialect: SupportedDialect,
  q: QuoteIdentifier
): string {
  switch (op.type) {
    case "add_table":
      return addTableSql(op, dialect, q);
    case "rename_table":
      return renameTableSql(op, q);
    case "add_column":
      return addColumnSql(op, q);
    case "drop_column":
      return dropColumnSql(op, q);
    case "rename_column":
      return renameColumnSql(op, q);
    case "add_check":
      return addCheckSql(op, q);
    case "add_foreign_key":
      return addForeignKeySpecSql(op, q);
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

/**
 * A check or foreign key dropped by name. Each dialect names its own verb:
 * PostgreSQL's `DROP CONSTRAINT IF EXISTS` for both, MySQL's `DROP CHECK` and
 * `DROP FOREIGN KEY` (it accepts `DROP CONSTRAINT` only from 8.0.19).
 */
export function dropConstraintSql(
  tableName: string,
  constraintName: string,
  verb: string,
  q: QuoteIdentifier
): string {
  return `ALTER TABLE ${q(tableName)} ${verb} ${q(constraintName)}`;
}
