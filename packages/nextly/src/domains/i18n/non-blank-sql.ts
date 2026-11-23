/**
 * Whether a translation row's column holds a value, in SQL, by the rule every read of a
 * translation keeps: blank (null, or an empty string) is "not translated" and falls back to
 * another language (`isBlank` in `companion-join`). One spelling, for the translation-status
 * filters and for the provenance judgement of a field no origin was recorded for, so the two
 * cannot disagree about whether a language holds a value.
 *
 * @module domains/i18n/non-blank-sql
 */
import { sql, type SQL } from "drizzle-orm";

/** The row a column is read on: a table or alias identifier, or the enclosing query's own row. */
type RowRef = SQL | ReturnType<typeof sql.identifier>;

/**
 * Whether `ref`'s `column` holds a value. A column that does not store text (a number, a boolean,
 * a date, a decimal or JSON) is never an empty string, and comparing it with one fails the query
 * on PostgreSQL and is coerced on MySQL (where `0` or `false` would read as blank), so it holds a
 * value when it is not null.
 */
export function nonBlankColumnSql(
  ref: RowRef,
  column: string,
  nonText: boolean
): SQL {
  const col = sql.identifier(column);
  return nonText
    ? sql`(${ref}.${col} IS NOT NULL)`
    : sql`(${ref}.${col} IS NOT NULL AND ${ref}.${col} <> '')`;
}
