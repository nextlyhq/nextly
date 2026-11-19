/**
 * What a column carries into the column that receives its values when translation is turned on
 * or off: its type, where that type holds every value the field's own type holds and more, and its
 * default. Everything else a receiving column is created with is the field's own (`ddlType`).
 *
 * The type is carried only where it is strictly wider. A column the field describes narrower than
 * the field's own type (a unique text bounded to be keyed whole, `VARCHAR(255)` on MySQL, under a
 * field whose translated column is `TEXT`) keeps the field's type, which already holds every value;
 * one described the same way under another spelling (`int4` and `INTEGER`) keeps the field's
 * spelling, so a companion created here is spelled as every other one is.
 *
 * @module domains/i18n/migration/carried-definition
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { copiesEveryValue } from "../../schema/pipeline/classifier/type-widening";
import type { ColumnSpec } from "../../schema/pipeline/diff/types";
import { renderedType } from "../../schema/pipeline/sql-templates/create-table-body";

import { ddlType } from "./ddl-types";
import type { CarriedDefinition, LocalizedColumnSpec } from "./types";

/**
 * What `source`, the column the values sit in now, carries into the receiving column of `column`:
 * undefined when it carries nothing the field's own definition does not already say.
 */
export function carriedDefinition(
  source: ColumnSpec | undefined,
  column: LocalizedColumnSpec,
  dialect: SupportedDialect
): CarriedDefinition | undefined {
  if (source === undefined) return undefined;
  const own = ddlType(column, dialect);
  const sourceType = renderedType(source);
  const type = receivingType(source, column, dialect);
  const carried: CarriedDefinition = {
    ...(type !== own ? { type: sourceType } : {}),
    ...(carriableDefault(source.default, dialect) &&
    defaultFitsType(source.default, type, dialect)
      ? { default: source.default }
      : {}),
  };
  return carried.type === undefined && carried.default === undefined
    ? undefined
    : carried;
}

/**
 * Whether a column of `sourceType` keeps its type over a receiving column whose own type is `own`:
 * where it is strictly wider, or a MySQL integer the type rules cannot read whose range `own` does
 * not contain (`mysqlIntegerOutOfRange`). Two types that hold each other's values, or that the
 * rules cannot compare (the same type under two spellings), keep the receiving column's own.
 */
export function typeCarried(
  sourceType: string,
  own: string,
  dialect: SupportedDialect
): boolean {
  return (
    (copiesEveryValue(own, sourceType, dialect) &&
      !copiesEveryValue(sourceType, own, dialect)) ||
    mysqlIntegerOutOfRange(sourceType, own, dialect)
  );
}

/**
 * Whether a default as live introspection reports it can be written into a new column's
 * definition. MySQL reports an expression default holding a string literal with its quotes
 * backslash-escaped (`lower(_utf8mb4\\'X\\')`), which no statement accepts back; such a default
 * cannot be carried, and a move that would need it is refused instead (`lossesOnMove`).
 */
export function carriableDefault(
  value: string | undefined,
  dialect: SupportedDialect
): value is string {
  if (value === undefined) return false;
  return dialect !== "mysql" || !value.includes("\\'");
}

/** The type a column receiving `source`'s values is created with: the source's where carried, else the field's own. */
export function receivingType(
  source: ColumnSpec,
  column: LocalizedColumnSpec,
  dialect: SupportedDialect
): string {
  const own = ddlType(column, dialect);
  const sourceType = renderedType(source);
  return typeCarried(sourceType, own, dialect) ? sourceType : own;
}

/**
 * Whether a column of `type` can be given `value` as its default. MySQL gives a text, BLOB or
 * JSON column a default only as an expression, never a literal; a literal default moving onto
 * such a column would refuse the column's creation, so a move that would need it is refused
 * instead (`lossesOnMove`).
 */
export function defaultFitsType(
  value: string,
  type: string,
  dialect: SupportedDialect
): boolean {
  if (dialect !== "mysql") return true;
  const textLike = /\b(?:tiny|medium|long)?(?:text|blob)\b|\bjson\b/i.test(
    type
  );
  return !textLike || value.trim().startsWith("(");
}

/** MySQL's integer types by size, smallest first. */
const MYSQL_INTEGER_RANK: Record<string, number> = {
  tinyint: 1,
  smallint: 2,
  mediumint: 3,
  int: 4,
  integer: 4,
  bigint: 5,
};

/**
 * A MySQL integer the type rules cannot read, `UNSIGNED` (or `ZEROFILL`, which implies it), whose
 * range a receiving column of type `own` would not hold: `own` is not an integer, or is a signed
 * one no larger, or an unsigned one smaller. A signed integer of a larger size, or an unsigned one
 * at least as large, holds every value.
 */
function mysqlIntegerOutOfRange(
  sourceType: string,
  own: string,
  dialect: SupportedDialect
): boolean {
  if (dialect !== "mysql") return false;
  const unsigned = (type: string) => /\b(?:unsigned|zerofill)\b/i.test(type);
  const rank = (type: string) =>
    MYSQL_INTEGER_RANK[
      type
        .toLowerCase()
        .match(/\b(tinyint|smallint|mediumint|bigint|integer|int)\b/)?.[1] ?? ""
    ];
  const sourceRank = rank(sourceType);
  if (!unsigned(sourceType) || sourceRank === undefined) return false;
  const ownRank = rank(own);
  if (ownRank === undefined) return true;
  return unsigned(own) ? ownRank < sourceRank : ownRank <= sourceRank;
}

/** The type and default a receiving column is created with: what it carries, else the field's own. */
export function receivingColumnDefinition(
  column: LocalizedColumnSpec,
  dialect: SupportedDialect
): string {
  const type = column.carried?.type ?? ddlType(column, dialect);
  return column.carried?.default === undefined
    ? type
    : `${type} DEFAULT ${column.carried.default}`;
}
