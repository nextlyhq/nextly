/**
 * An enum column's permitted values, as a constraint the database enforces.
 *
 * ## Why a CHECK and not a native type
 *
 * PostgreSQL's `CREATE TYPE ... AS ENUM` is a schema object of its own, with
 * its own lifecycle: it is created before the table, altered by
 * `ALTER TYPE ... ADD VALUE` (which cannot run inside a transaction on older
 * servers), and dropped after the last column using it. MySQL spells the same
 * idea inline in the column type, and SQLite has no enum at all. Three
 * mechanisms, three introspection paths, three failure modes.
 *
 * A CHECK is ONE mechanism that exists on all three, and this pipeline already
 * diffs, emits, introspects and replays checks on every dialect. An enum
 * declared here is therefore carried by machinery that is already proven,
 * rather than by a fourth kind of schema object that would need its own.
 *
 * ## What that buys, and what it costs
 *
 * Buys: creating the column constrains it; adding a value is an ordinary check
 * change the diff already produces; and REMOVING a value is refused by the
 * database itself, because a CHECK cannot be added while an existing row
 * violates it. The refusal is the correct one and needs no pre-flight count.
 *
 * Costs: the column's storage type is text, so `\d` does not show an enum and
 * a native-enum-typed client library sees text. That is the honest trade, and
 * it is why `col.enum()` has always rendered as text here.
 *
 * @module domains/schema/extension/enum-check
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";

import type { ExtensionColumn } from "./types";

/**
 * The constraint's name.
 *
 * Derived from the table and column rather than invented, for the reason
 * every other derived name here exists: live introspection reads the name off
 * the server, and a name the desired side generated differently would read as
 * a constraint that must be dropped and a different one added, on every
 * single comparison.
 *
 * An explicit `enumName` wins, so an author who has already named the
 * constraint in a hand-written migration can keep that name.
 */
export function enumCheckName(
  tableName: string,
  column: Pick<ExtensionColumn, "name" | "enumName">
): string {
  return column.enumName ?? `ck_${tableName}_${column.name}_enum`;
}

/**
 * Single-quote a value for SQL.
 *
 * Doubling is the escape every one of the three dialects uses, and the values
 * come from a plugin author's config rather than from a request — but a
 * config is still text somebody typed, and this string becomes DDL.
 */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The CHECK expression for one enum column.
 *
 * Values are emitted in DECLARATION order, not sorted. The declared order is
 * what the author wrote and what the next build will produce; sorting here
 * would make a reordering invisible, which sounds desirable until an author
 * reorders and the pipeline reports no change while the stored constraint
 * says something else.
 *
 * A nullable column's constraint permits NULL: `col IN (...)` is already NULL
 * for a NULL input, and a CHECK passes on NULL — stated here because it is
 * the kind of SQL three-valued-logic detail a reader should not have to
 * rediscover.
 */
export function enumCheckSql(
  column: Pick<ExtensionColumn, "name" | "enumValues">,
  _dialect: SupportedDialect
): string | undefined {
  const values = column.enumValues;
  if (values === undefined || values.length === 0) return undefined;
  return `${column.name} IN (${values.map(quote).join(", ")})`;
}

/**
 * The checks an enum column contributes to its table's spec.
 *
 * Returned as a list so a caller can concatenate it with the table's declared
 * checks without caring whether this column produced one.
 */
export function enumChecks(
  tableName: string,
  columns: readonly ExtensionColumn[],
  dialect: SupportedDialect
): Array<{ name: string; sql: string }> {
  const out: Array<{ name: string; sql: string }> = [];
  for (const column of columns) {
    const sql = enumCheckSql(column, dialect);
    if (sql === undefined) continue;
    out.push({ name: enumCheckName(tableName, column), sql });
  }
  return out;
}

/**
 * The values a check expression permits, or null when it is not one of ours.
 *
 * Reads back what {@link enumCheckSql} wrote, so a comparison between the
 * declared set and the live one can name the values that changed rather than
 * reporting that an opaque expression differs.
 */
export function enumValuesIn(sql: string): string[] | null {
  const match = /^\s*(\w+)\s+IN\s*\(([\s\S]*)\)\s*$/i.exec(sql);
  if (match === null) return null;
  const body = match[2] ?? "";
  const values: string[] = [];
  const literal = /'((?:[^']|'')*)'/g;
  let found: RegExpExecArray | null;
  while ((found = literal.exec(body)) !== null) {
    values.push((found[1] ?? "").replace(/''/g, "'"));
  }
  return values.length > 0 ? values : null;
}

/**
 * The values this change would take away.
 *
 * Empty when the change only adds. A non-empty answer is the case the database
 * will refuse — a CHECK cannot be added while a row violates it — and naming
 * the values is the difference between a usable error and
 * `check constraint "ck_..." is violated by some row`.
 */
export function removedEnumValues(before: string, after: string): string[] {
  const from = enumValuesIn(before);
  const to = enumValuesIn(after);
  if (from === null || to === null) return [];
  const kept = new Set(to);
  return from.filter(value => !kept.has(value));
}
