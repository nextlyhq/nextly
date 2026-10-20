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
 * one; and a column left as `text` holding JSON lists is already read correctly.
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
 * Exported for the convertibility probe, which forces this same expression over every row before
 * anything changes, so the probe and the conversion cannot read a value differently.
 *
 * `::text` first, so one expression serves a `uuid` and a `text` column alike. A value starting
 * with `{` is an array literal; one starting with `[` is already a JSON list; anything else
 * non-empty is a single id. An empty string is no reference, so it becomes an empty list.
 */
export function postgresReferenceListExpression(columnName: string): string {
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
      // A JSON list stays as it is; any other value is one reference and becomes a one-item list.
      // Nested so JSON_TYPE only ever reads a value JSON_VALID has accepted.
      // A JSON scalar (a single id the serializer wrote as a JSON string) is wrapped as JSON, so its
      // quotes are not kept as part of the id.
      `UPDATE ${table} SET ${c} = CASE ` +
        `WHEN TRIM(${c}) = '' THEN JSON_ARRAY() ` +
        `WHEN JSON_VALID(${c}) THEN CASE WHEN JSON_TYPE(${c}) = 'ARRAY' THEN ${c} ELSE JSON_ARRAY(CAST(${c} AS JSON)) END ` +
        `ELSE JSON_ARRAY(${c}) END ` +
        `WHERE ${c} IS NOT NULL`,
      `ALTER TABLE ${table} MODIFY COLUMN ${c} ${op.toType} ${nullability}`,
    ];
  }
  // SQLite stores a JSON list as text, the type such a column already has, so the diff never plans
  // a type change for it; reaching here means a caller built the operation by hand.
  throw NextlyError.internal({
    logContext: {
      reason: "a reference-list conversion has no SQLite form",
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
  throw NextlyError.internal({
    logContext: {
      reason: "a reference-list conversion has no SQLite form",
      table: op.tableName,
      column: op.columnName,
    },
  });
}
