// F11 PR 3: SQLite SQL templates per Operation type.
//
// SQLite limitations:
// - Supports RENAME COLUMN since 3.25 (F17 minimum is 3.38; safe).
// - Supports ADD COLUMN.
// - Does NOT support ALTER COLUMN TYPE in place — requires recreate-table.
// - Does NOT support change_column_nullable / change_column_default in
//   place — also requires recreate-table.
// - DROP COLUMN supported since 3.35 (F17 minimum is 3.38; safe).
// - DROP TABLE has no CASCADE keyword (FK behavior governed by the
//   foreign_keys = ON pragma the F3 pipeline already toggles).
//
// For unsupported in-place changes (type/nullable/default), F11 throws
// a clear error pointing operators at recreate-table or pushSchema.
// This is documented as an F11 limitation; F18 testing matrix asserts
// the error fires for SQLite.
//
// Pure functions. No I/O. No semicolons.

import type {
  AddColumnOp,
  AddTableOp,
  ColumnSpec,
  DropColumnOp,
  DropTableOp,
  Operation,
  RenameColumnOp,
  RenameTableOp,
} from "../diff/types";

import { quoteIdent } from "./identifier-quoting";

const q = (n: string) => quoteIdent(n, "sqlite");

function columnDef(c: ColumnSpec): string {
  const nullable = c.nullable ? "" : " NOT NULL";
  const def = c.default !== undefined ? ` DEFAULT ${c.default}` : "";
  return `${q(c.name)} ${c.type}${nullable}${def}`;
}

export class SqliteUnsupportedOperationError extends Error {
  constructor(opType: string, hint: string) {
    super(
      `SQLite does not support ${opType} in place. ${hint} For migrate:create, ` +
        `you may need to write a manual recreate-table migration via --blank.`
    );
    this.name = "SqliteUnsupportedOperationError";
  }
}

export function generateSqliteSQL(op: Operation): string {
  switch (op.type) {
    case "add_table":
      return generateAddTable(op);
    case "drop_table":
      return generateDropTable(op);
    case "rename_table":
      return generateRenameTable(op);
    case "add_column":
      return generateAddColumn(op);
    case "drop_column":
      return generateDropColumn(op);
    case "rename_column":
      return generateRenameColumn(op);
    case "change_column_type":
      throw new SqliteUnsupportedOperationError(
        "change_column_type",
        "Use ALTER TABLE ... RENAME TO ... + CREATE TABLE ... + INSERT INTO ... SELECT + DROP TABLE ..."
      );
    case "change_column_nullable":
      throw new SqliteUnsupportedOperationError(
        "change_column_nullable",
        "Same recreate-table workaround as change_column_type."
      );
    case "change_column_default":
      throw new SqliteUnsupportedOperationError(
        "change_column_default",
        "Same recreate-table workaround as change_column_type."
      );
    default: {
      const exhaustive: never = op;
      void exhaustive;
      throw new Error(
        `generateSqliteSQL: unsupported op ${(op as { type: string }).type}`
      );
    }
  }
}

function generateAddTable(op: AddTableOp): string {
  const cols = op.table.columns.map(c => `  ${columnDef(c)}`).join(",\n");
  return `CREATE TABLE ${q(op.table.name)} (\n${cols}\n)`;
}

function generateDropTable(op: DropTableOp): string {
  return `DROP TABLE ${q(op.tableName)}`;
}

function generateRenameTable(op: RenameTableOp): string {
  return `ALTER TABLE ${q(op.fromName)} RENAME TO ${q(op.toName)}`;
}

function generateAddColumn(op: AddColumnOp): string {
  return `ALTER TABLE ${q(op.tableName)} ADD COLUMN ${columnDef(op.column)}`;
}

function generateDropColumn(op: DropColumnOp): string {
  return `ALTER TABLE ${q(op.tableName)} DROP COLUMN ${q(op.columnName)}`;
}

function generateRenameColumn(op: RenameColumnOp): string {
  return `ALTER TABLE ${q(op.tableName)} RENAME COLUMN ${q(op.fromColumn)} TO ${q(op.toColumn)}`;
}
