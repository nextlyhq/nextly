/**
 * The column list inside a generated `CREATE TABLE`.
 *
 * Shared by all three dialects because it was the same code in all three, and
 * the one thing it had to say was missing from every copy: a column marked as
 * the primary key was rendered as an ordinary `NOT NULL` column, so every table
 * a migration created had no primary key at all. The desired snapshot has
 * carried `primaryKey` since it was added for the diff's nullability exemption
 * (`diff.ts`); only the renderer dropped it.
 *
 * `ALTER TABLE ... ADD COLUMN` deliberately does NOT come through here. No
 * dialect accepts an inline `PRIMARY KEY` on an added column, and a table that
 * already exists either has its key or needs a constraint statement rather than
 * a column clause.
 *
 * @module domains/schema/pipeline/sql-templates/create-table-body
 */
import type { ColumnSpec, TableSpec } from "../diff/types";

/**
 * The column's type as it must be WRITTEN, with any declared size restored.
 *
 * 🔴 A snapshot does not always spell the modifier inside `type`. PostgreSQL introspection reads
 * `udt_name`, which reports a bare `varchar` however the column was declared, and records the
 * length separately. Rendering `type` alone therefore recreates `varchar(20)` as an UNBOUNDED
 * `varchar` — a real widening of the column, silent because both the source and the rebuilt table
 * then describe themselves the same way.
 *
 * MySQL and SQLite report the declaration itself, so their `type` already carries the modifier and
 * must not have a second one appended.
 */
function renderedType(c: ColumnSpec): string {
  if (c.typeModifier === undefined) return c.type;
  // Already spelled inside the type — the MySQL and SQLite case.
  if (c.type.includes("(")) return c.type;
  return `${c.type}(${c.typeModifier})`;
}

/** Quotes an identifier the way one dialect spells it. */
export type QuoteIdentifier = (name: string) => string;

/**
 * One column, as it appears in a statement that is not creating the table.
 *
 * The primary key is not rendered here: this is what `ADD COLUMN` and the
 * column-altering paths use, and none of them may declare a key.
 */
export function columnDefinition(c: ColumnSpec, q: QuoteIdentifier): string {
  const nullable = c.nullable ? "" : " NOT NULL";
  const def = c.default !== undefined ? ` DEFAULT ${c.default}` : "";
  return `${q(c.name)} ${renderedType(c)}${nullable}${def}`;
}

/**
 * One column, as it appears inside `CREATE TABLE`.
 *
 * `PRIMARY KEY` precedes `NOT NULL` to match the form drizzle-kit emits and
 * the one `renderSystemColumnSql` already produces on the Builder path, so a
 * table created by a migration and the same table created by the Builder read
 * identically.
 */
function createTableColumn(c: ColumnSpec, q: QuoteIdentifier): string {
  if (c.primaryKey !== true) return columnDefinition(c, q);
  const nullable = c.nullable ? "" : " NOT NULL";
  const def = c.default !== undefined ? ` DEFAULT ${c.default}` : "";
  return `${q(c.name)} ${renderedType(c)} PRIMARY KEY${nullable}${def}`;
}

/**
 * The full body of a `CREATE TABLE`: every column, and a table-level key when
 * more than one column carries the marker.
 *
 * Every table Nextly generates today has a single-column key on `id`, which is
 * why the inline form is the one that matches everything else. A composite key
 * cannot be spelled inline at all — repeating `PRIMARY KEY` on two columns is
 * a syntax error rather than a composite key — so it becomes a constraint. The
 * two spellings are equivalent to the database; they are not equivalent to
 * someone reading the file, which is why the common case keeps the short one.
 */
export function createTableBody(
  table: TableSpec,
  q: QuoteIdentifier,
  indent = "  "
): string {
  const keyColumns = table.columns.filter(c => c.primaryKey === true);
  const composite = keyColumns.length > 1;

  const lines = table.columns.map(c =>
    composite
      ? `${indent}${columnDefinition(c, q)}`
      : `${indent}${createTableColumn(c, q)}`
  );

  if (composite) {
    const cols = keyColumns.map(c => q(c.name)).join(", ");
    lines.push(`${indent}PRIMARY KEY (${cols})`);
  }

  return lines.join(",\n");
}
