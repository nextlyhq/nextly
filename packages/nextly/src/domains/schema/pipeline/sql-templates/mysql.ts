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
} from "../diff/types.js";

import { quoteIdent } from "./identifier-quoting.js";

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

// MySQL has no ALTER COLUMN TYPE — must use MODIFY COLUMN, which requires
// re-stating the column type (and by extension would need nullable/default
// to preserve them). For F11 v1 we emit just the type change; if the
// column was NOT NULL or had a default, the operator must hand-edit the
// generated migration. Acceptable trade-off for v1 because the apply
// pipeline uses pushSchema which handles this differently anyway.
function generateChangeColumnType(op: ChangeColumnTypeOp): string {
  return `ALTER TABLE ${q(op.tableName)} MODIFY COLUMN ${q(op.columnName)} ${op.toType}`;
}

// MySQL MODIFY COLUMN requires the column type. We don't track the
// current type on a ChangeColumnNullableOp, so we look at fromNullable
// to decide whether the operator wants nullable=true (DROP NOT NULL)
// or nullable=false (SET NOT NULL). The operator must hand-edit if
// they need to preserve a non-default column type or default expression.
function generateChangeColumnNullable(op: ChangeColumnNullableOp): string {
  // Without the column's current type we emit a placeholder hint.
  // F12 may extend ChangeColumnNullableOp with the column type; until
  // then, document the limitation in the emitted SQL itself.
  const hint = "/* MySQL: re-state the column type after the column name */";
  const nullClause = op.toNullable ? "NULL" : "NOT NULL";
  return `ALTER TABLE ${q(op.tableName)} MODIFY COLUMN ${q(op.columnName)} ${hint} ${nullClause}`;
}

function generateChangeColumnDefault(op: ChangeColumnDefaultOp): string {
  return op.toDefault === undefined
    ? `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} DROP DEFAULT`
    : `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} SET DEFAULT ${op.toDefault}`;
}
