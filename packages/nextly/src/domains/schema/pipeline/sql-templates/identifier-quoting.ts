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

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

/**
 * The character `dialect` wraps an identifier in. Exported so a declaration
 * holding one is refused when it is written (`assertQuotableIdentifier`,
 * which also refuses an empty name and NUL) rather than here, when the DDL
 * is rendered.
 */
export function identifierQuote(dialect: SupportedDialect): string {
  return dialect === "mysql" ? "`" : '"';
}

/**
 * Whether `quoteIdent` can quote `name` on `dialect`: not where it holds the dialect's quote. A
 * caller rendering a name it read from a database, which may hold one, asks first and says the
 * name is one to handle by hand rather than be refused part-way through.
 */
export function canQuoteIdent(
  name: string,
  dialect: SupportedDialect
): boolean {
  return !name.includes(identifierQuote(dialect));
}

export function quoteIdent(name: string, dialect: SupportedDialect): string {
  const q = identifierQuote(dialect);
  if (!canQuoteIdent(name, dialect)) {
    throw new Error(
      `Invalid identifier ${JSON.stringify(name)}: contains the dialect quote character (${q}). ` +
        "Managed tables and FieldConfig column names must not contain quote characters."
    );
  }
  return `${q}${name}${q}`;
}
