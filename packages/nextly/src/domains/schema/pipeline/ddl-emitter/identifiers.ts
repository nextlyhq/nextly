// Identifier quoting for the fast DDL emitters.
//
// Standard SQL: wrap in double quotes, double any embedded double quote.
// Reject NUL bytes outright (identifiers cannot contain them and they are
// a classic injection primitive). Table/column names in the pipeline
// originate from collection slugs / field names that the schema builder
// already constrains to [a-z0-9_], but the emitter must not assume that —
// defense in depth, mirroring renderDefaultValue's stance in
// @nextlyhq/adapter-drizzle.

import { NextlyError } from "../../../../errors";

function rejectNulByte(identifier: string): void {
  if (identifier.includes("\0")) {
    // Typed like every other package error; the offending identifier is
    // log-only so a hostile value never echoes back on the wire.
    throw NextlyError.validation({
      errors: [
        {
          path: "identifier",
          code: "INVALID_IDENTIFIER",
          message: "Identifier contains a NUL byte.",
        },
      ],
      logContext: { identifier: JSON.stringify(identifier) },
    });
  }
}

// Double-quoted form — valid for PostgreSQL AND SQLite (both treat `"` as
// the standard identifier quote; SQLite's PRAGMA/DDL round-trips it too).
export function quoteIdent(identifier: string): string {
  rejectNulByte(identifier);
  return `"${identifier.replace(/"/g, '""')}"`;
}

// Backtick form for MySQL, which does not accept double-quoted identifiers
// under the default sql_mode (ANSI_QUOTES off). Embedded backticks are
// doubled, mirroring the escaping rule of the double-quote form above.
export function quoteIdentMysql(identifier: string): string {
  rejectNulByte(identifier);
  return `\`${identifier.replace(/`/g, "``")}\``;
}
