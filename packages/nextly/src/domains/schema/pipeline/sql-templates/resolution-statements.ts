/**
 * The statements a migration file carries for the person's answer to rows
 * that do not fit a column made required: fill them with a value, or delete
 * them. They run after the column exists and before it is made NOT NULL, so a
 * deploy's database is settled the same way as the one the answer was given
 * on.
 *
 * @module domains/schema/pipeline/sql-templates/resolution-statements
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../../errors/nextly-error";

import { quoteIdent } from "./identifier-quoting";

/** A column's rows that do not fit, and what is done with them. */
export type ColumnResolution =
  | { tableName: string; columnName: string; kind: "fill"; value: unknown }
  | { tableName: string; columnName: string; kind: "delete_nonconforming" };

/**
 * `value` written as a SQL literal for `dialect`. A string's quotes are
 * doubled, and on MySQL, which reads a backslash as an escape, its
 * backslashes too; a number must be finite; a boolean is spelled as each
 * dialect stores it. Anything else is refused: the value has been checked
 * against the column's type before it reaches here.
 */
function sqlValueLiteral(value: unknown, dialect: SupportedDialect): string {
  if (typeof value === "string") {
    const quoted = value.replace(/'/g, "''");
    return `'${dialect === "mysql" ? quoted.replace(/\\/g, "\\\\") : quoted}'`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    if (dialect === "postgresql") return value ? "TRUE" : "FALSE";
    return value ? "1" : "0";
  }
  throw new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      "A fill value must be a string, a finite number or a boolean.",
    logContext: { valueType: typeof value },
  });
}

/** The statement settling `resolution`'s rows. */
export function resolutionStatement(
  resolution: ColumnResolution,
  dialect: SupportedDialect
): string {
  const table = quoteIdent(resolution.tableName, dialect);
  const column = quoteIdent(resolution.columnName, dialect);
  return resolution.kind === "fill"
    ? `UPDATE ${table} SET ${column} = ${sqlValueLiteral(resolution.value, dialect)} WHERE ${column} IS NULL;`
    : `DELETE FROM ${table} WHERE ${column} IS NULL;`;
}
