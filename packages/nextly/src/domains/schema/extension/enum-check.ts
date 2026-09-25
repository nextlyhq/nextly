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
import { normalizeCheckExpression } from "../pipeline/diff/normalize-check";

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
 * A value as a SQL string literal.
 *
 * Doubling the quote is the escape every one of the three dialects uses, and
 * the values come from a plugin author's config rather than from a request —
 * but a config is still text somebody typed, and this string becomes DDL.
 *
 * A backslash is the one character that cannot be written the same way
 * everywhere. PostgreSQL and SQLite read it as itself; MySQL reads it as an
 * escape under its default sql_mode and as itself under NO_BACKSLASH_ESCAPES,
 * so `'back\slash'` would constrain the column to `backslash` under the
 * default mode — refusing every row that holds the declared value. On MySQL
 * such a value is therefore written as UTF-8 hex with a charset introducer,
 * which states the declared value whatever the mode of the session running
 * the DDL.
 *
 * That fixes what the DDL says, not everything MySQL then does with it: the
 * server re-prints the clause with backslash escapes and re-reads it under the
 * mode of whichever session opens the table, so under NO_BACKSLASH_ESCAPES it
 * enforces a doubled backslash (measured on MySQL 8.0.46). No spelling of the
 * DDL prevents that, and the diff compares such a check as exact text rather
 * than claim a match — see `readLiteral` in normalize-check.ts.
 */
function quote(value: string, dialect: SupportedDialect): string {
  if (dialect === "mysql" && value.includes("\\")) {
    const hex = Array.from(new TextEncoder().encode(value), byte =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    return `_utf8mb4 X'${hex}'`;
  }
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
 *
 * The same spelling on every dialect apart from the backslash case in
 * `quote`, although neither server reads it back this way. PostgreSQL keeps a
 * parse tree rather than the text and deparses this as
 * `status = ANY (ARRAY[...])` with casts added; MySQL reports
 * `` (`status` in (_utf8mb4'a',...)) ``. The diff compares checks through
 * `normalizeCheckExpression`, which reduces every spelling to one, so nothing
 * here has to track what either server prints.
 */
export function enumCheckSql(
  column: Pick<ExtensionColumn, "name" | "enumValues">,
  dialect: SupportedDialect
): string | undefined {
  const values = column.enumValues;
  if (values === undefined || values.length === 0) return undefined;
  return `${column.name} IN (${values.map(value => quote(value, dialect)).join(", ")})`;
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
 *
 * Read through `normalizeCheckExpression`, so the expression PostgreSQL
 * reports for a live constraint reads the same as the one declared. That form
 * spells a one-value set as an equality — PostgreSQL stores `x IN ('a')` as
 * `x = 'a'` — so both shapes are accepted.
 */
export function enumValuesIn(sql: string): string[] | null {
  const canonical = normalizeCheckExpression(sql);
  // Only a column compared with string literals is a value set; the literal
  // list is matched whole, so `a IN (...) AND b IN (...)` is not read as one.
  const column = `(?:\\w+|"(?:[^"]|"")*")`;
  const literal = `'(?:[^']|'')*'`;
  const match =
    new RegExp(`^\\s*${column}\\s*=\\s*(${literal})\\s*$`).exec(canonical) ??
    new RegExp(
      `^\\s*${column}\\s+IN\\s*\\((${literal}(?:\\s*,\\s*${literal})*)\\)\\s*$`,
      "i"
    ).exec(canonical);
  if (match === null) return null;
  const body = match[1] ?? "";
  const values: string[] = [];
  const each = /'((?:[^']|'')*)'/g;
  let found: RegExpExecArray | null;
  while ((found = each.exec(body)) !== null) {
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
