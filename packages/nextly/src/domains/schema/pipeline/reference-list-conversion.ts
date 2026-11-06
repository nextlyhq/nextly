/**
 * Converting a scalar column into the JSON list of references a relation keeps on its row.
 *
 * A component's many-to-many was created as a scalar column before it was stored as a list: `uuid`
 * or `text` on PostgreSQL, `varchar(36)` on MySQL. What those rows hold depends on the route that
 * wrote them:
 *
 * - a bare id (a `uuid` column, a single value, or MySQL, where the driver spreads a one-item list
 *   into one value);
 * - a PostgreSQL array literal, `{"a","b"}`, which the driver writes for a list bound to `text`;
 * - a JSON list, `["a","b"]`, where something serialized the list first;
 * - NULL, or an empty string.
 *
 * A plain cast reads none of the first three as a list. PostgreSQL has no cast from `uuid` to
 * `jsonb` at all, and refuses a bare id or an array literal as JSON text; MySQL refuses a bare id as
 * a JSON document. So this reads each shape on its own terms, and the statements are stated once
 * here for every consumer: the pre-resolution executor runs them in a live apply, and a generated
 * migration file carries the same statements.
 *
 * On PostgreSQL it is one statement, so the column converts whole or not at all. On MySQL it is
 * three (widen, wrap each bare value in a list, retype), and MySQL commits each DDL statement as it
 * runs. Each step can run again over its own result, so a run stopped part-way finishes on the next
 * one; and a column left as `text` holding JSON lists is already read correctly. On SQLite the
 * column is text either way, so a relation switched between one entry and many has only its values
 * rewritten, by one statement that can also run again over its own result.
 *
 * @module domains/schema/pipeline/reference-list-conversion
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";

import type { ChangeColumnTypeOp } from "./diff/types";
import { quoteIdent } from "./sql-templates/identifier-quoting";

export { isReferenceListConversion } from "./diff/types";

/**
 * The PostgreSQL expression reading one stored value as a `jsonb` list.
 *
 * The value-conversion judgement reads each stored value branch by branch as this expression does
 * (`value-conversion/judge-value.ts`), and where the two could disagree it is the stricter: a value
 * it judges readable that this expression refuses fails the single statement, so the column is left
 * as it was.
 *
 * `::text` first, so one expression serves a `uuid` and a `text` column alike. A value starting
 * with `{` is an array literal; one starting with `[` is already a JSON list; anything else
 * non-empty is a single id. An empty string is no reference, so it becomes an empty list.
 */
function postgresReferenceListExpression(columnName: string): string {
  const c = quoteIdent(columnName, "postgresql");
  const value = `btrim(${c}::text)`;
  return (
    `CASE WHEN ${c} IS NULL THEN NULL ` +
    `WHEN ${value} = '' THEN '[]'::jsonb ` +
    `WHEN left(${value}, 1) = '{' THEN to_jsonb(${c}::text::text[]) ` +
    `WHEN left(${value}, 1) = '[' THEN ${c}::text::jsonb ` +
    // A JSON string: one id the JSON serializer wrote into a column not converted yet. Read as JSON,
    // so the id is wrapped without its quotes.
    `WHEN left(${value}, 1) = '"' THEN jsonb_build_array(${c}::text::jsonb) ` +
    `ELSE jsonb_build_array(${c}::text) END`
  );
}

/**
 * The PostgreSQL expression reading a `jsonb` list back as the scalar `toType` held it, for the
 * generated DOWN.
 *
 * A one-item list becomes its id and an empty list NULL. A longer list cannot be one id on any
 * target type, a `text` one included, so it is refused: a message naming the list is cast to
 * `integer`, which raises with that message and fails the single statement before the column
 * changes. Cast on through `text` so the expression has a type PostgreSQL can carry to every target
 * type; the cast is never reached.
 */
function postgresReferenceScalarExpression(
  columnName: string,
  toType: string
): string {
  const c = quoteIdent(columnName, "postgresql");
  return (
    `CASE WHEN ${c} IS NULL THEN NULL ` +
    `WHEN jsonb_typeof(${c}) <> 'array' THEN (${c} #>> '{}')::${toType} ` +
    `WHEN jsonb_array_length(${c}) = 0 THEN NULL ` +
    `WHEN jsonb_array_length(${c}) = 1 THEN (${c} ->> 0)::${toType} ` +
    `ELSE (('a reference list holding more than one id cannot be rolled back: ' || ${c}::text)::integer)::text::${toType} END`
  );
}

/**
 * MySQL's middle step of the list conversion: the column, already widened to `text`, has each
 * stored value rewritten as a JSON list, so the retype that follows reads every row as JSON.
 *
 * Its own export so a caller that widens and retypes the column its own way (the repair's
 * conversion, which restates the column's whole definition around each retype) runs this same
 * rewrite rather than a copy of it.
 */
export function mysqlReferenceListRewrite(
  tableName: string,
  columnName: string
): string {
  const table = quoteIdent(tableName, "mysql");
  const c = quoteIdent(columnName, "mysql");
  // A JSON list stays as it is; any other value is one reference and becomes a one-item list.
  // Nested so JSON_TYPE only ever reads a value JSON_VALID has accepted.
  // A JSON scalar (a single id the serializer wrote as a JSON string) is wrapped as JSON, so its
  // quotes are not kept as part of the id.
  return (
    `UPDATE ${table} SET ${c} = CASE ` +
    `WHEN TRIM(${c}) = '' THEN JSON_ARRAY() ` +
    `WHEN JSON_VALID(${c}) THEN CASE WHEN JSON_TYPE(${c}) = 'ARRAY' THEN ${c} ELSE JSON_ARRAY(CAST(${c} AS JSON)) END ` +
    `ELSE JSON_ARRAY(${c}) END ` +
    `WHERE ${c} IS NOT NULL`
  );
}

/**
 * The statements that convert `op`'s column, in order: forward into the list column for a
 * `referenceList` conversion, back to the scalar type for its `referenceScalar` DOWN.
 *
 * A list rather than one string because MySQL needs several and its driver runs one statement per
 * call (`multipleStatements` is off). A migration file joins them; the executor runs them one by
 * one.
 */
export function referenceConversionStatements(
  op: ChangeColumnTypeOp,
  dialect: SupportedDialect
): string[] {
  if (op.conversion === "requireEmpty") {
    return requireEmptyStatements(op.tableName, op.columnName, dialect);
  }
  if (op.conversion === "referenceScalar") {
    return referenceScalarStatements(op, dialect);
  }
  if (dialect === "postgresql") {
    return [
      `ALTER TABLE ${quoteIdent(op.tableName, dialect)} ` +
        `ALTER COLUMN ${quoteIdent(op.columnName, dialect)} ` +
        `SET DATA TYPE ${op.toType} ` +
        `USING ${postgresReferenceListExpression(op.columnName)}`,
    ];
  }
  if (dialect === "mysql") {
    const table = quoteIdent(op.tableName, dialect);
    const c = quoteIdent(op.columnName, dialect);
    // MODIFY restates the whole definition, so the column's nullability travels with each retype.
    // The column carries no default: a relationship column is never given one.
    const nullability = op.nullable === false ? "NOT NULL" : "NULL";
    return [
      // Wide enough for a list: a JSON list of one uuid is already longer than varchar(36).
      `ALTER TABLE ${table} MODIFY COLUMN ${c} text ${nullability}`,
      mysqlReferenceListRewrite(op.tableName, op.columnName),
      `ALTER TABLE ${table} MODIFY COLUMN ${c} ${op.toType} ${nullability}`,
    ];
  }
  if (dialect === "sqlite") {
    return [sqliteReferenceListRewrite(op.tableName, op.columnName)];
  }
  throw unsupportedDialect(op);
}

/**
 * SQLite's list conversion: the column is text before and after, so only the values change. A JSON
 * list stays as it is and anything else becomes a one-item list, which makes the statement safe to
 * run again over its own result. Nested so `json_type` only reads a value `json_valid` accepted. A
 * JSON string (an id the serializer quoted) is wrapped without its quotes; any other value is
 * wrapped as the text it is, so an id that reads as a number stays a string, as PostgreSQL keeps it.
 */
function sqliteReferenceListRewrite(
  tableName: string,
  columnName: string
): string {
  const table = quoteIdent(tableName, "sqlite");
  const c = quoteIdent(columnName, "sqlite");
  return (
    `UPDATE ${table} SET ${c} = CASE ` +
    `WHEN trim(${c}) = '' THEN json_array() ` +
    `WHEN json_valid(${c}) THEN CASE WHEN json_type(${c}) = 'array' THEN ${c} ` +
    `WHEN json_type(${c}) = 'text' THEN json_array(json(${c})) ELSE json_array(${c}) END ` +
    `ELSE json_array(${c}) END ` +
    `WHERE ${c} IS NOT NULL`
  );
}

/**
 * SQLite's way back to one reference: a one-item list becomes its id, an empty list no reference,
 * and a JSON string (an id the serializer quoted) the id without its quotes, as PostgreSQL and MySQL
 * unquote it. Only lists of at most one id are rewritten, so a longer list is never cut down to its
 * first id; an apply refuses before anything runs while a row holds one. What the statement leaves
 * is neither a JSON list nor a JSON string, so it is safe to run again.
 */
function sqliteReferenceScalarRewrite(
  tableName: string,
  columnName: string
): string {
  const table = quoteIdent(tableName, "sqlite");
  const c = quoteIdent(columnName, "sqlite");
  return (
    `UPDATE ${table} SET ${c} = CASE ` +
    `WHEN json_type(${c}) = 'text' THEN json_extract(${c}, '$') ` +
    `WHEN json_array_length(${c}) = 0 THEN NULL ` +
    `ELSE json_extract(${c}, '$[0]') END ` +
    // A CASE rather than AND: SQLite does not promise to skip `json_type` when `json_valid` is
    // false, and `json_type` raises on text that is not JSON, such as a bare id.
    `WHERE ${c} IS NOT NULL AND CASE WHEN json_valid(${c}) ` +
    `THEN json_type(${c}) = 'text' OR (json_type(${c}) = 'array' AND json_array_length(${c}) <= 1) ` +
    `ELSE 0 END`
  );
}

/**
 * The guard a relation's switch to or from naming several collections runs before any DDL: it
 * fails, naming the column, while a row holds a value, and changes nothing either way. A value is
 * anything but NULL, an empty string, an empty list or JSON null.
 *
 * Each dialect raises in the one way it has outside a stored routine: PostgreSQL from a `DO` block;
 * MySQL by adding a CHECK no row holding a value satisfies, then dropping it; SQLite from a
 * temporary trigger on a temporary table, fired by one insert. Each statement can run again.
 */
function requireEmptyStatements(
  tableName: string,
  columnName: string,
  dialect: SupportedDialect
): string[] {
  const table = quoteIdent(tableName, dialect);
  const c = quoteIdent(columnName, dialect);
  const message =
    `Column ${tableName}.${columnName} cannot change between one target collection and several ` +
    `while a row holds a value. Clear it on every row first, or keep its targets as they are.`;
  const literal = `'${message.replace(/'/g, "''")}'`;
  if (dialect === "postgresql") {
    return [
      `DO $nextly$ BEGIN IF EXISTS (SELECT 1 FROM ${table} WHERE ${c} IS NOT NULL ` +
        `AND btrim(${c}::text) NOT IN ('', '[]', 'null')) THEN RAISE EXCEPTION ${literal}; ` +
        `END IF; END $nextly$`,
    ];
  }
  if (dialect === "mysql") {
    const guard = quoteIdent(
      `chk_no_value_${tableName}_${columnName}`.slice(0, 64),
      dialect
    );
    return [
      `ALTER TABLE ${table} ADD CONSTRAINT ${guard} CHECK (${c} IS NULL OR TRIM(CAST(${c} AS CHAR)) IN ('', '[]', 'null'))`,
      `ALTER TABLE ${table} DROP CHECK ${guard}`,
    ];
  }
  if (dialect === "sqlite") {
    const probe = '"nextly_require_empty"';
    const trigger = '"nextly_require_empty_guard"';
    return [
      `CREATE TEMP TABLE IF NOT EXISTS ${probe} ("x" integer)`,
      `DROP TRIGGER IF EXISTS temp.${trigger}`,
      `CREATE TEMP TRIGGER ${trigger} BEFORE INSERT ON ${probe} ` +
        `WHEN EXISTS (SELECT 1 FROM main.${table} WHERE ${c} IS NOT NULL ` +
        `AND trim(${c}) NOT IN ('', '[]', 'null')) ` +
        `BEGIN SELECT RAISE(ABORT, ${literal}); END`,
      `INSERT INTO ${probe} VALUES (1)`,
      `DROP TRIGGER temp.${trigger}`,
      `DROP TABLE temp.${probe}`,
    ];
  }
  throw unsupportedDialect({
    type: "change_column_type",
    tableName,
    columnName,
    fromType: "",
    toType: "",
    conversion: "requireEmpty",
  });
}

/** A conversion asked of a dialect this module has no statements for. */
function unsupportedDialect(op: ChangeColumnTypeOp): NextlyError {
  return NextlyError.internal({
    logContext: {
      reason: "a reference-list conversion has no form on this dialect",
      table: op.tableName,
      column: op.columnName,
    },
  });
}

/**
 * The generated DOWN: the list column back to the scalar type it was converted from.
 *
 * Lossless or refused, never lossy. Every row holding at most one id goes back as that id; a row
 * holding more cannot fit in one, so the DOWN refuses before it changes anything. PostgreSQL does
 * that in its single statement, whose cast fails on the longer list. MySQL commits each statement
 * as it runs, and a server not in strict mode would truncate a value too long for the column rather
 * than refuse it, so a CHECK the existing rows must satisfy is added, and dropped, before anything
 * else runs: adding it fails when one row holds more than one id.
 */
function referenceScalarStatements(
  op: ChangeColumnTypeOp,
  dialect: SupportedDialect
): string[] {
  if (dialect === "postgresql") {
    return [
      `ALTER TABLE ${quoteIdent(op.tableName, dialect)} ` +
        `ALTER COLUMN ${quoteIdent(op.columnName, dialect)} ` +
        `SET DATA TYPE ${op.toType} ` +
        `USING ${postgresReferenceScalarExpression(op.columnName, op.toType)}`,
    ];
  }
  if (dialect === "mysql") {
    const table = quoteIdent(op.tableName, dialect);
    const c = quoteIdent(op.columnName, dialect);
    const guard = quoteIdent(
      `chk_one_ref_${op.tableName}_${op.columnName}`.slice(0, 64),
      dialect
    );
    const nullability = op.nullable === false ? "NOT NULL" : "NULL";
    return [
      `ALTER TABLE ${table} ADD CONSTRAINT ${guard} CHECK (${c} IS NULL OR JSON_LENGTH(${c}) <= 1)`,
      `ALTER TABLE ${table} DROP CHECK ${guard}`,
      `ALTER TABLE ${table} MODIFY COLUMN ${c} text ${nullability}`,
      `UPDATE ${table} SET ${c} = CASE ` +
        `WHEN JSON_TYPE(${c}) <> 'ARRAY' THEN JSON_UNQUOTE(${c}) ` +
        `WHEN JSON_LENGTH(${c}) = 0 THEN NULL ` +
        `ELSE JSON_UNQUOTE(JSON_EXTRACT(${c}, '$[0]')) END ` +
        `WHERE ${c} IS NOT NULL`,
      `ALTER TABLE ${table} MODIFY COLUMN ${c} ${op.toType} ${nullability}`,
    ];
  }
  if (dialect === "sqlite") {
    return [sqliteReferenceScalarRewrite(op.tableName, op.columnName)];
  }
  throw unsupportedDialect(op);
}
