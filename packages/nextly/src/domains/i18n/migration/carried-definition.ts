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
  const wider =
    copiesEveryValue(own, sourceType, dialect) &&
    !copiesEveryValue(sourceType, own, dialect);
  const carried: CarriedDefinition = {
    ...(wider ? { type: sourceType } : {}),
    ...(source.default === undefined ? {} : { default: source.default }),
  };
  return carried.type === undefined && carried.default === undefined
    ? undefined
    : carried;
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
