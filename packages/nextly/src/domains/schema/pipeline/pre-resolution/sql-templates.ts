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
// Identifier names come from our managed-table prefix space and our own
// FieldConfig column names, so they're already validated. We don't escape
// embedded quotes - if a name contained one, it would have failed earlier
// in the pipeline. (F4 PR 1's filter strips unmanaged tables; managed
// tables follow the dc_/single_/comp_ prefix and ascii-snake-case naming.)

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

function quote(name: string, dialect: SupportedDialect): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
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
