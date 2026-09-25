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

import { NextlyError } from "../../../../errors/nextly-error";
import type {
  AddColumnOp,
  AddIndexOp,
  AddTableOp,
  ColumnSpec,
  DropColumnOp,
  DropIndexOp,
  DropTableOp,
  IndexSpec,
  Operation,
  RenameColumnOp,
  RenameTableOp,
} from "../diff/types";

import { columnDefinition, createTableBody } from "./create-table-body";
import { unsupportedOperation } from "./foreign-key-action";
import { quoteIdent } from "./identifier-quoting";

const q = (n: string) => quoteIdent(n, "sqlite");

function columnDef(c: ColumnSpec): string {
  return columnDefinition(c, q);
}

/**
 * What SQLite cannot do in place, refused with the codebase's own error.
 *
 * A `NextlyError` rather than a bare `Error` subclass, so this refusal carries
 * the code, status, public data and log context every other refusal in
 * `packages/nextly` carries — it reaches a caller as a typed envelope instead
 * of a message string. Kept as a named CLASS because callers and tests
 * identify it by type, and the message is unchanged for the same reason.
 */
export class SqliteUnsupportedOperationError extends NextlyError {
  constructor(opType: string, hint: string) {
    const message =
      `SQLite does not support ${opType} in place. ${hint} For migrate:create, ` +
      `you may need to write a manual recreate-table migration via --blank.`;
    super({
      code: "VALIDATION_ERROR",
      publicMessage: message,
      publicData: {
        errors: [
          {
            path: "dialect",
            code: "SQLITE_UNSUPPORTED_OPERATION",
            message,
          },
        ],
      },
      logContext: { reason: "sqlite-unsupported-operation", opType },
    });
    this.name = "SqliteUnsupportedOperationError";
  }
}

/**
 * What SQLite cannot change in place, and what it would take instead.
 *
 * One list rather than an arm each, so the set of refusals is readable as a
 * set: everything here needs the table recreated, which is a different
 * operation from the one that was asked for and one this pipeline does not
 * perform on the author's behalf.
 *
 * The foreign-key entry is the one with teeth. Automating that rebuild has
 * caused real data loss in three independent tools that tried it, because an
 * unrelated table's cascade can fire during the window where the constraint
 * is gone — so refusing is the answer here, not a limitation to be worked
 * around later.
 */
const RECREATE_TABLE_HINTS: Record<
  | "change_column_type"
  | "change_column_nullable"
  | "change_column_default"
  | "change_foreign_key_action",
  string
> = {
  change_column_type:
    "Use ALTER TABLE ... RENAME TO ... + CREATE TABLE ... + INSERT INTO ... SELECT + DROP TABLE ...",
  change_column_nullable:
    "Same recreate-table workaround as change_column_type.",
  change_column_default:
    "Same recreate-table workaround as change_column_type.",
  change_foreign_key_action:
    "A referential action can only be changed by recreating the table, which drops and rebuilds it along with every index, trigger and view on it.",
};

export function generateSqliteSQL(op: Operation): string {
  // The three dialect dispatchers are switches over the SAME `Operation`
  // union, so their arms line up one for one and their tails are identical
  // text. That parallelism is the safety property, not an accident: each
  // narrows the union to `never` in its own default arm, so adding a member
  // to `Operation` is a COMPILE error in every dialect that has not handled
  // it — which is how `change_foreign_key_action` located all seven of its
  // consumers instead of leaving one to fail at run time on whichever dialect
  // a user happened to be on. Sharing them means a handler table keyed by op
  // type, and a table is not exhaustiveness-checked per dialect: a missing
  // entry becomes an undefined lookup while writing DDL.
  // fallow-ignore-next-line code-duplication
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
    case "change_column_nullable":
    case "change_column_default":
    case "change_foreign_key_action":
      throw new SqliteUnsupportedOperationError(
        op.type,
        RECREATE_TABLE_HINTS[op.type]
      );
    case "add_index":
      return generateAddIndex(op);
    case "drop_index":
      return generateDropIndex(op);
    case "add_check":
    case "drop_check":
      // SQLite cannot add or drop a CHECK in place; a check change on this
      // dialect belongs to the table-rebuild path.
      return unsupportedOperation("generateSqliteSQL", op);
    case "add_foreign_key":
    case "drop_foreign_key":
      // Nor a FOREIGN KEY: PRAGMA foreign_keys cannot be toggled inside the
      // transaction an apply runs in, so a foreign-key change on this dialect
      // belongs to the table-rebuild path as well.
      return unsupportedOperation("generateSqliteSQL", op);
    default:
      return unsupportedOperation("generateSqliteSQL", op);
  }
}

function createIndexStatement(tableName: string, index: IndexSpec): string {
  // An expression index carries per-dialect SQL in place of column names.
  const cols = index.expression
    ? `(${index.expression})`
    : index.columns.map(q).join(", ");
  const where = index.where ? ` WHERE ${index.where}` : "";
  return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${q(index.name)} ON ${q(tableName)} (${cols})${where}`;
}

function generateAddIndex(op: AddIndexOp): string {
  return createIndexStatement(op.tableName, op.index);
}

function generateDropIndex(op: DropIndexOp): string {
  return `DROP INDEX IF EXISTS ${q(op.index.name)}`;
}

function generateAddTable(op: AddTableOp): string {
  const cols = createTableBody(op.table, q, "  ", "sqlite");
  const createTable = `CREATE TABLE ${q(op.table.name)} (\n${cols}\n)`;
  const indexStmts = (op.table.indexes ?? []).map(i =>
    createIndexStatement(op.table.name, i)
  );
  return [createTable, ...indexStmts].join(";\n");
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
