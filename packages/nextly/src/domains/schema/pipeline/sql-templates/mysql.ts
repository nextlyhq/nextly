// F11 PR 3: MySQL SQL templates per Operation type.
//
// Differences from PG:
// - Identifier quoting uses backticks (handled by quoteIdent).
// - ALTER COLUMN TYPE → MODIFY COLUMN (no TYPE keyword).
// - DROP NOT NULL / SET NOT NULL → MODIFY COLUMN with the type re-stated.
// - DROP TABLE doesn't take CASCADE (FK cascading uses different DDL).
// - RENAME COLUMN supported on MySQL 8.0+ (per F17 minimum).
//
// Pure functions. No I/O. No semicolons.

import type {
  AddColumnOp,
  AddTableOp,
  ChangeColumnDefaultOp,
  ChangeColumnNullableOp,
  ChangeColumnTypeOp,
  ColumnSpec,
  DropColumnOp,
  DropTableOp,
  Operation,
  RenameColumnOp,
  RenameTableOp,
} from "../diff/types";

import { quoteIdent } from "./identifier-quoting";

const q = (n: string) => quoteIdent(n, "mysql");

function columnDef(c: ColumnSpec): string {
  const nullable = c.nullable ? "" : " NOT NULL";
  const def = c.default !== undefined ? ` DEFAULT ${c.default}` : "";
  return `${q(c.name)} ${c.type}${nullable}${def}`;
}

export function generateMysqlSQL(op: Operation): string {
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
      return generateChangeColumnType(op);
    case "change_column_nullable":
      return generateChangeColumnNullable(op);
    case "change_column_default":
      return generateChangeColumnDefault(op);
    default: {
      const exhaustive: never = op;
      void exhaustive;
      throw new Error(
        `generateMysqlSQL: unsupported op ${(op as { type: string }).type}`
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

// F11 PR 3 review fix #1: MySQL MODIFY COLUMN requires the column type
// to be re-stated. ChangeColumnTypeOp carries `toType` so we can emit
// valid SQL — but the original column's NOT NULL / DEFAULT clauses are
// dropped (operator must hand-edit if they need to preserve them).
// Acceptable trade-off for v1.
function generateChangeColumnType(op: ChangeColumnTypeOp): string {
  return `ALTER TABLE ${q(op.tableName)} MODIFY COLUMN ${q(op.columnName)} ${op.toType}`;
}

// F11 PR 3 review fix #1: previously emitted SQL with a comment-as-
// placeholder for the missing column type. That parses (block comment
// is valid MySQL), but `MODIFY COLUMN` REQUIRES the column type — so
// the SQL would fail at apply time, NOT at migrate:create time. That
// is the worst possible failure mode: migrate:create succeeds, the
// operator commits the file, then prod CI fails with a confusing error
// pointing at a comment.
//
// Fix: throw at template-generation time (parallel to SQLite). F12 may
// extend ChangeColumnNullableOp with `columnType: string` (the diff
// engine has access to it; see RenameColumnOp.fromType for precedent).
// Until then, MySQL operators must use migrate:create --blank and
// hand-write the MODIFY COLUMN with the explicit type.
function generateChangeColumnNullable(op: ChangeColumnNullableOp): string {
  throw new MysqlUnsupportedOperationError(
    "change_column_nullable",
    `Cannot generate valid MODIFY COLUMN SQL for ${op.tableName}.${op.columnName} ` +
      `because the column type is not tracked on this operation. F12 will extend ` +
      `ChangeColumnNullableOp with the type. For now, use 'nextly migrate:create --blank' ` +
      `and hand-write 'ALTER TABLE \`${op.tableName}\` MODIFY COLUMN \`${op.columnName}\` ` +
      `<TYPE> ${op.toNullable ? "NULL" : "NOT NULL"};'.`
  );
}

function generateChangeColumnDefault(op: ChangeColumnDefaultOp): string {
  return op.toDefault === undefined
    ? `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} DROP DEFAULT`
    : `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} SET DEFAULT ${op.toDefault}`;
}

export class MysqlUnsupportedOperationError extends Error {
  constructor(opType: string, hint: string) {
    super(`MySQL F11 PR 3 limitation: ${opType}. ${hint}`);
    this.name = "MysqlUnsupportedOperationError";
  }
}
