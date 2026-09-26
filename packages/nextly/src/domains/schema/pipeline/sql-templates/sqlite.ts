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
import type { DropIndexOp, DropTableOp, Operation } from "../diff/types";

import { commonStatementSql } from "./common-statements";
import { createIndexSql } from "./create-index";
import { unsupportedOperation } from "./foreign-key-action";
import { quoteIdent } from "./identifier-quoting";

const q = (n: string) => quoteIdent(n, "sqlite");

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
 * The foreign-key entry is refused only when the operation is rendered on
 * its own. `generateStatements` folds a referential-action change, like every
 * other check or foreign-key change, into a rebuild of the whole table under
 * the runner's foreign-keys-off contract (`sqlite-rebuild.ts`), where no
 * other table's cascade can fire.
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
    case "rename_table":
    case "add_column":
    case "drop_column":
    case "rename_column":
      // Rendered alike on every dialect but for the quote function.
      return commonStatementSql(op, "sqlite", q);
    case "drop_table":
      return generateDropTable(op);
    case "change_column_type":
    case "change_column_nullable":
    case "change_column_default":
    case "change_foreign_key_action":
      throw new SqliteUnsupportedOperationError(
        op.type,
        RECREATE_TABLE_HINTS[op.type]
      );
    case "add_index":
      return createIndexSql(op.tableName, op.index, "sqlite", q);
    case "drop_index":
      return generateDropIndex(op);
    case "add_check":
    case "drop_check":
    case "add_foreign_key":
    case "drop_foreign_key":
      // SQLite cannot add or drop a CHECK or a FOREIGN KEY in place, and the
      // operation alone does not carry the table it would take to rebuild.
      // `generateStatements` folds these into a rebuild of the whole table
      // from its target spec; reaching this arm means a caller rendered the
      // operation on its own.
      return unsupportedOperation("generateSqliteSQL", op);
    default:
      return unsupportedOperation("generateSqliteSQL", op);
  }
}

function generateDropIndex(op: DropIndexOp): string {
  return `DROP INDEX IF EXISTS ${q(op.index.name)}`;
}

function generateDropTable(op: DropTableOp): string {
  return `DROP TABLE ${q(op.tableName)}`;
}
