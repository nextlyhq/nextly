// F11 PR 3: per-dialect identifier quoting helper.
//
// PG / SQLite use double-quoted identifiers ("name").
// MySQL uses backtick-quoted identifiers (`name`).
//
// Identifier names come from our managed-table prefix space (dc_/single_/
// comp_) and FieldConfig column names. Both are validated upstream. As a
// defense-in-depth check we throw if an identifier contains the dialect's
// quote character — that would otherwise be either an injection vector
// or malformed SQL.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

export function quoteIdent(name: string, dialect: SupportedDialect): string {
  const q = dialect === "mysql" ? "`" : '"';
  if (name.includes(q)) {
    throw new Error(
      `Invalid identifier ${JSON.stringify(name)}: contains the dialect quote character (${q}). ` +
        "Managed tables and FieldConfig column names must not contain quote characters."
    );
  }
  return `${q}${name}${q}`;
}
