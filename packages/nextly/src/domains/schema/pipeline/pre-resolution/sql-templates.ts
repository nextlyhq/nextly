// Per-dialect SQL templates for pre-resolution operations.
//
// These produce the SQL we run BEFORE drizzle-kit's pushSchema in the
// Option E pipeline. Operations included here are the ones we own:
// renames (avoid drizzle-kit's TTY prompt) and destructive drops (so F5's
// destructive-confirm UX runs through our PromptDispatcher first). All
// purely additive ops are deferred to pushSchema's final pass.
//
// Identifier quoting per dialect:
//   PG / SQLite: double-quoted ("name")
//   MySQL: backtick (`name`)
//
// Identifier names come from our managed-table prefix space (dc_/single_/
// comp_) and FieldConfig column names. Both are validated upstream. As a
// defense-in-depth check we still throw if an identifier contains the
// dialect's quote character - that would otherwise be either an injection
// vector or malformed SQL.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

function quote(name: string, dialect: SupportedDialect): string {
  const q = dialect === "mysql" ? "`" : '"';
  if (name.includes(q)) {
    throw new Error(
      `Invalid identifier ${JSON.stringify(name)}: contains the dialect quote character (${q}). ` +
        "Managed tables and FieldConfig column names must not contain quote characters."
    );
  }
  return `${q}${name}${q}`;
}

export function buildRenameColumnSql(
  tableName: string,
  fromColumn: string,
  toColumn: string,
  dialect: SupportedDialect
): string {
  const t = quote(tableName, dialect);
  const f = quote(fromColumn, dialect);
  const to = quote(toColumn, dialect);
  return `ALTER TABLE ${t} RENAME COLUMN ${f} TO ${to}`;
}

export function buildDropColumnSql(
  tableName: string,
  columnName: string,
  dialect: SupportedDialect
): string {
  const t = quote(tableName, dialect);
  const c = quote(columnName, dialect);
  return `ALTER TABLE ${t} DROP COLUMN ${c}`;
}

// PG: CASCADE drops FK references from other tables atomically. Safer
// for our managed-tables-only scope where the diff doesn't track FKs.
//
// MySQL: CASCADE keyword on DROP TABLE is a no-op (different syntax for
// FK drops); leave it off to avoid syntax errors on stricter MySQL
// versions.
//
// SQLite: no CASCADE keyword. FK behavior is governed by the
// foreign_keys = ON pragma the F3 pipeline already toggles.
export function buildDropTableSql(
  tableName: string,
  dialect: SupportedDialect
): string {
  const t = quote(tableName, dialect);
  if (dialect === "postgresql") {
    return `DROP TABLE ${t} CASCADE`;
  }
  return `DROP TABLE ${t}`;
}

export function buildRenameTableSql(
  fromName: string,
  toName: string,
  dialect: SupportedDialect
): string {
  const f = quote(fromName, dialect);
  const t = quote(toName, dialect);
  return `ALTER TABLE ${f} RENAME TO ${t}`;
}
