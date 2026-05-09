// F11 PR 3: PostgreSQL SQL templates per Operation type.
//
// Pure functions. No I/O. No semicolons (the apply pipeline runs each
// statement via tx.execute(); the file formatter adds `;` when joining
// statements for migrate:create output).

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

const q = (n: string) => quoteIdent(n, "postgresql");

function columnDef(c: ColumnSpec): string {
  const nullable = c.nullable ? "" : " NOT NULL";
  const def = c.default !== undefined ? ` DEFAULT ${c.default}` : "";
  return `${q(c.name)} ${c.type}${nullable}${def}`;
}

export function generatePgSQL(op: Operation): string {
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
        `generatePgSQL: unsupported op ${(op as { type: string }).type}`
      );
    }
  }
}

function generateAddTable(op: AddTableOp): string {
  const cols = op.table.columns.map(c => `  ${columnDef(c)}`).join(",\n");
  return `CREATE TABLE ${q(op.table.name)} (\n${cols}\n)`;
}

// PG CASCADE drops FK references atomically. Mirrors pre-resolution
// sql-templates behavior — the F11 sql-templates module is the single
// source of truth post-PR-3.
function generateDropTable(op: DropTableOp): string {
  return `DROP TABLE ${q(op.tableName)} CASCADE`;
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

function generateChangeColumnType(op: ChangeColumnTypeOp): string {
  return `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} TYPE ${op.toType}`;
}

function generateChangeColumnNullable(op: ChangeColumnNullableOp): string {
  return op.toNullable
    ? `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} DROP NOT NULL`
    : `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} SET NOT NULL`;
}

function generateChangeColumnDefault(op: ChangeColumnDefaultOp): string {
  return op.toDefault === undefined
    ? `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} DROP DEFAULT`
    : `ALTER TABLE ${q(op.tableName)} ALTER COLUMN ${q(op.columnName)} SET DEFAULT ${op.toDefault}`;
}
