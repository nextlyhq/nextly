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
import type { CheckSpec, TableSpec } from "../pipeline/diff/types";
import { quoteIdent } from "../pipeline/sql-templates/identifier-quoting";
import { checkConstraintName } from "../services/index-name";

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
 * An explicit `enumName` replaces the column's part of the name, never the
 * table's: it is scoped as `ck_<table>_<enumName>`, exactly as a declared
 * check's name is. MySQL requires a check name to be unique across the whole
 * schema, so one enum name reused on two tables — natural for a set of values
 * shared between them — would otherwise make the second CREATE TABLE fail.
 *
 * Both forms go through the bounded namer, so a long table or column name
 * yields a name every dialect stores whole.
 */
export function enumCheckName(
  tableName: string,
  column: Pick<ExtensionColumn, "name" | "enumName">
): string {
  return checkConstraintName(
    tableName,
    column.enumName ?? `${column.name}_enum`
  );
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
 * The same spelling on every dialect apart from the identifier's quote
 * character and the backslash case in `quote`, although neither server reads
 * it back this way. PostgreSQL keeps a
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
  // The column is QUOTED, in the dialect's own quote character. Bare, a name
  // that is also a keyword stops naming the column: PostgreSQL reads `user`
  // as CURRENT_USER — a valid check comparing the role name, which then
  // refuses every row — and MySQL refuses `key`, `order` or `group` as a
  // syntax error.
  return `${quoteIdent(column.name, dialect)} IN (${values.map(value => quote(value, dialect)).join(", ")})`;
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
 * An ENTITY table's desired spec, with the enum checks of the columns
 * contributed to it.
 *
 * An extension table's checks come from `toTableSpec`. A column contributed to
 * a collection, Single or component reaches its table's spec by another route
 * — as a bare `ColumnSpec` — so the check its `col.enum()` implies has to be
 * added here, from the same `enumChecks`, or the column is created as plain
 * text and any value is stored.
 *
 * An entity table's spec leaves `checks` undefined — "not tracked" — because
 * nothing in its field-derived description declares one. Tracking them now
 * makes the diff drop every live check the desired side does not name, so the
 * checks this pipeline does not own are carried over from `previous` (the
 * live table, or the last snapshot) unchanged. What is dropped is only what
 * these contributions own: a check named for a contributed column that no
 * longer declares an enum, or for a column the table no longer has — which
 * could not outlive the column's drop anyway, and on MySQL and SQLite blocks
 * it while it stands. A table that owns no enum check, now or before, keeps
 * `checks` untracked, exactly as it was.
 */
export function withContributedEnumChecks(
  spec: TableSpec,
  contributed: readonly ExtensionColumn[],
  previous: TableSpec | undefined,
  dialect: SupportedDialect
): TableSpec {
  const own = enumChecks(spec.name, contributed, dialect);
  const ownNames = new Set(own.map(check => check.name));
  const desiredColumns = new Set(spec.columns.map(column => column.name));
  // The columns whose enum check these contributions answer for: every
  // contributed column, and every column the table no longer has — a check on
  // a dropped column has nothing left to constrain, and on MySQL and SQLite it
  // blocks the drop while it stands.
  const answeredFor = new Set([
    ...contributed.map(column => column.name),
    ...(previous?.columns ?? [])
      .map(column => column.name)
      .filter(name => !desiredColumns.has(name)),
  ]);
  // A previous check is stale when it is an enum check on one of those
  // columns that the contributions no longer declare. It is matched by what
  // it constrains, not by its name, because `col.enum(values, { name })`
  // names it freely — and the name it had is not recoverable from the column
  // once the column stops declaring it.
  // Only checks in the namespace `checkConstraintName` writes (`ck_…`) are
  // candidates: one managed elsewhere — the Schema Builder's `chk_…`, or a
  // hand-written constraint — is never taken for a contribution's.
  const isStale = (check: CheckSpec): boolean => {
    if (ownNames.has(check.name) || !check.name.startsWith("ck_")) return false;
    const read = readEnumCheck(check.sql);
    return read !== null && answeredFor.has(read.column);
  };
  const previousChecks = previous?.checks ?? [];
  const stale = previousChecks.filter(isStale);
  if (own.length === 0 && stale.length === 0) return spec;
  return {
    ...spec,
    checks: [
      ...previousChecks.filter(
        check => !ownNames.has(check.name) && !isStale(check)
      ),
      ...own,
    ],
  };
}

/**
 * The column an enum check constrains and the values it permits, or null when
 * the expression is not one of ours.
 *
 * Reads back what {@link enumCheckSql} wrote, so a comparison between the
 * declared set and the live one can name the values that changed rather than
 * reporting that an opaque expression differs, and a check can be matched to
 * its column whatever it is named.
 *
 * Read through `normalizeCheckExpression`, so the expression PostgreSQL
 * reports for a live constraint reads the same as the one declared. That form
 * spells a one-value set as an equality — PostgreSQL stores `x IN ('a')` as
 * `x = 'a'` — so both shapes are accepted.
 */
function readEnumCheck(
  sql: string
): { column: string; values: string[] } | null {
  const canonical = normalizeCheckExpression(sql);
  // Only a column compared with string literals is a value set; the literal
  // list is matched whole, so `a IN (...) AND b IN (...)` is not read as one.
  const column = `(\\w+|"(?:[^"]|"")*")`;
  const literal = `'(?:[^']|'')*'`;
  const match =
    new RegExp(`^\\s*${column}\\s*=\\s*(${literal})\\s*$`).exec(canonical) ??
    new RegExp(
      `^\\s*${column}\\s+IN\\s*\\((${literal}(?:\\s*,\\s*${literal})*)\\)\\s*$`,
      "i"
    ).exec(canonical);
  if (match === null) return null;
  const name = match[1] ?? "";
  const body = match[2] ?? "";
  const values: string[] = [];
  const each = /'((?:[^']|'')*)'/g;
  let found: RegExpExecArray | null;
  while ((found = each.exec(body)) !== null) {
    values.push((found[1] ?? "").replace(/''/g, "'"));
  }
  if (values.length === 0) return null;
  return {
    column: name.startsWith('"') ? name.slice(1, -1).replace(/""/g, '"') : name,
    values,
  };
}

/** The values an enum check permits, or null when it is not one of ours. */
export function enumValuesIn(sql: string): string[] | null {
  return readEnumCheck(sql)?.values ?? null;
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
