// Per-dialect SQL builders for F5 pre-cleanup.
//
// UPDATE for provide_default; DELETE for delete_nonconforming. Identifiers
// strict-validated up front (fail-loud on adversarial table/column names);
// values always parameterized via dialect-appropriate placeholders so
// arbitrary types (string, number, boolean, date) bind safely.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdent(name: string, dialect: SupportedDialect): string {
  if (!SAFE_IDENT.test(name)) {
    throw new Error(
      `unsafe identifier: ${name} (only [A-Za-z_][A-Za-z0-9_]* allowed)`
    );
  }
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

// PG uses $N placeholders; MySQL/SQLite use ? placeholders.
function placeholder(dialect: SupportedDialect, oneBasedIndex: number): string {
  return dialect === "postgresql" ? `$${oneBasedIndex}` : "?";
}

export interface BuiltSql {
  sql: string;
  params: unknown[];
}

export function buildProvideDefaultSql(args: {
  dialect: SupportedDialect;
  table: string;
  column: string;
  value: unknown;
}): BuiltSql {
  const tbl = quoteIdent(args.table, args.dialect);
  const col = quoteIdent(args.column, args.dialect);
  const ph = placeholder(args.dialect, 1);
  const sql = `UPDATE ${tbl} SET ${col} = ${ph} WHERE ${col} IS NULL`;
  return { sql, params: [args.value] };
}

export function buildDeleteNonconformingSql(args: {
  dialect: SupportedDialect;
  table: string;
  column: string;
}): BuiltSql {
  const tbl = quoteIdent(args.table, args.dialect);
  const col = quoteIdent(args.column, args.dialect);
  return {
    sql: `DELETE FROM ${tbl} WHERE ${col} IS NULL`,
    params: [],
  };
}
