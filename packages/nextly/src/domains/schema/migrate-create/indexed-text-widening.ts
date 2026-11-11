/**
 * The refusal of a MySQL migration that would widen a keyed column into TEXT or BLOB.
 *
 * MySQL keys a TEXT or BLOB column only by a prefix length, so `MODIFY COLUMN … TEXT` over a column
 * a whole-column index or key still covers fails with ERROR 1170, and the migration stops there on
 * every site that runs it. A column an earlier migration made `varchar(255)` and indexed whole is
 * such a column once the field's rule reads it as unbounded. Lifting the index around the change,
 * and recreating it by prefix as the Schema Builder keys a TEXT column, is not written yet, so the
 * run is refused before any file is written, naming each column and what keeps it bounded.
 *
 * @module domains/schema/migrate-create/indexed-text-widening
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import type { NextlySchemaSnapshot, Operation } from "../pipeline/diff/types";
import { isMysqlTextOrBlobType } from "../pipeline/sql-templates/create-index";

/** Refuses `operations` when one widens a column a recorded index keys into TEXT or BLOB. */
export function refuseIndexedTextWidening(args: {
  operations: readonly Operation[];
  /** The tables as the newest snapshot recorded them, with their indexes. */
  previous: NextlySchemaSnapshot | undefined;
  dialect: SupportedDialect;
}): void {
  if (args.dialect !== "mysql" || args.previous === undefined) return;
  const errors: { path: string; code: string; message: string }[] = [];
  for (const op of args.operations) {
    if (op.type !== "change_column_type") continue;
    if (
      !isMysqlTextOrBlobType(op.toType) ||
      isMysqlTextOrBlobType(op.fromType)
    ) {
      continue;
    }
    const index = args.previous.tables
      .find(table => table.name === op.tableName)
      ?.indexes?.find(spec => spec.columns.includes(op.columnName));
    if (index === undefined) continue;
    errors.push({
      path: `${op.tableName}.${op.columnName}`,
      code: "INDEXED_COLUMN_WIDENING",
      message:
        `${op.tableName}.${op.columnName} would change from ${op.fromType} to ${op.toType}, ` +
        `which MySQL cannot do while the index ${index.name} keys the whole column. Give the ` +
        "field a maxLength, which keeps the column bounded and its index, or remove the " +
        "field's index, then run migrate:create again.",
    });
  }
  if (errors.length === 0) return;
  // Each refusal in the message itself, as the run's other refusals are, so the command prints
  // the columns and the way out rather than a bare "validation failed".
  throw new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage: errors.map(e => e.message).join(" "),
    publicData: { errors },
    logContext: {
      reason: "indexed column widened to text",
      columns: errors.map(e => e.path),
    },
  });
}
