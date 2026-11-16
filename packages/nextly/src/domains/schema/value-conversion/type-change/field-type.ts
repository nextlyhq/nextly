/**
 * A field's type as the type-change judgement reads it on one database: its family, and what its
 * column holds there. The family decides which rule applies; what the column holds decides whether
 * a value fits it. Both are read from the field's own definition and from the column descriptor
 * that creates its column (`getColumnDescriptor`), never restated, so the judgement and the column
 * a change creates agree on every database.
 *
 * @module domains/schema/value-conversion/type-change/field-type
 */
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { selectOptionValues } from "../../../../shared/lib/entry-validation";
import { getFieldType } from "../../field-types/field-type-registry";
import {
  type ColumnOrigin,
  DEFAULT_DECIMAL_PRECISION,
  DEFAULT_DECIMAL_SCALE,
  getColumnDescriptor,
  type SupportedDialect,
} from "../../services/field-column-descriptor";

/** The families the rules are stated for. */
export type Family =
  | "text"
  | "email"
  | "choice"
  | "richText"
  | "number"
  | "checkbox"
  | "date"
  | "json"
  | "list"
  | "relationship"
  | "container"
  | "password"
  /** A plugin's type that is not loaded: no rule can read its values. */
  | "unloaded";

/** How a number column stores a value. */
export type NumberFormat =
  | { kind: "integer"; bits: 32 | 64 }
  | { kind: "double" }
  | { kind: "decimal"; precision: number; scale: number };

/** How a date column stores a value: to which part of a second, and over which years. */
export interface DateColumn {
  /** Digits of a second the column keeps: 0 for whole seconds, 6 for microseconds. */
  fractionDigits: number;
  /** The first and last instants the column holds, in seconds since 1970 UTC; absent: no bound. */
  range?: { first: number; last: number };
}

/** What a text column holds: a number of characters, or of bytes; absent where it is unbounded. */
export type TextBound =
  | { unit: "characters"; most: number }
  | { unit: "bytes"; most: number };

/** A relationship's targets and where its links are kept. */
export interface RelationTarget {
  /** The target collections, sorted, so two relationships to the same targets compare equal. */
  targets: string[];
  upload: boolean;
  /** One target id on the row, several as a JSON list on the row, or a join table. */
  kept: "one" | "several" | "join";
}

/** A field's type on one database, as the rules read it. */
export interface FieldTypeOnDialect {
  family: Family;
  dialect: SupportedDialect;
  /** The field's type name, which a refusal names. */
  type: string;
  /** Text, Email, Choice, Rich text: what the column holds. */
  textBound?: TextBound;
  /** Choice: the option values. A list of options: its items' values. */
  options?: string[];
  /** Number: how its column stores a value. */
  number?: NumberFormat;
  /** Date: what its column keeps. */
  date?: DateColumn;
  /** List: its items' type, judged item by item as one value of that type. */
  item?: FieldTypeOnDialect;
  /** Relationship: its targets and where its links are kept. */
  relation?: RelationTarget;
}

/**
 * The type `field` has on `dialect`: its family, and what its column holds there.
 *
 * @param builtBy the creator of the field's table, whose rules size its columns
 */
export function fieldTypeOnDialect(
  field: FieldDefinition,
  dialect: SupportedDialect,
  builtBy: ColumnOrigin
): FieldTypeOnDialect {
  const base = { dialect, type: field.type };
  switch (field.type) {
    case "text":
    case "textarea":
    case "code":
      return { ...base, family: "text", ...textColumn(field, dialect, builtBy) };
    case "email":
      return {
        ...base,
        family: "email",
        ...textColumn(field, dialect, builtBy),
      };
    case "radio":
      return { ...base, family: "choice", ...choiceColumn(field, dialect, builtBy) };
    case "select":
      return field.hasMany === true
        ? {
            ...base,
            family: "list",
            item: {
              ...base,
              family: "choice",
              options: selectOptionValues(field),
            },
          }
        : { ...base, family: "choice", ...choiceColumn(field, dialect, builtBy) };
    case "richText":
      return {
        ...base,
        family: "richText",
        ...textColumn(field, dialect, builtBy),
      };
    case "number":
      return field.hasMany === true
        ? {
            ...base,
            family: "list",
            // A list keeps its numbers as JSON, which holds any finite double.
            item: { ...base, family: "number", number: { kind: "double" } },
          }
        : { ...base, family: "number", number: numberFormat(field, dialect, builtBy) };
    case "checkbox":
      return { ...base, family: "checkbox" };
    case "date":
      return { ...base, family: "date", date: DATE_COLUMNS[dialect] };
    case "json":
      return { ...base, family: "json" };
    case "chips":
      // A chip is a text item of a JSON list, which bounds none.
      return { ...base, family: "list", item: { ...base, family: "text" } };
    case "relationship":
    case "upload":
      return { ...base, family: "relationship", relation: relationOf(field) };
    case "password":
      return { ...base, family: "password" };
    case "group":
    case "repeater":
    case "component":
    case "blocks":
      return { ...base, family: "container" };
    default:
      return pluginType(field, dialect, builtBy);
  }
}

/**
 * What each database's date column keeps. PostgreSQL's `timestamp` keeps microseconds over a span
 * no date reaches; MySQL's `timestamp`, declared with no fractional digits, keeps whole seconds from
 * 1970-01-01 00:00:01 to 2038-01-19 03:14:07 UTC; SQLite's epoch integer keeps whole seconds over a
 * 64-bit span.
 */
const DATE_COLUMNS: Record<SupportedDialect, DateColumn> = {
  postgresql: { fractionDigits: 6 },
  mysql: { fractionDigits: 0, range: { first: 1, last: 2_147_483_647 } },
  sqlite: { fractionDigits: 0 },
};

/** A text-like field's bound, read from the column its creator makes for it. */
function textColumn(
  field: FieldDefinition,
  dialect: SupportedDialect,
  builtBy: ColumnOrigin
): { textBound?: TextBound } {
  const type = getColumnDescriptor(field, dialect, builtBy)?.dialectType;
  const bound = type === undefined ? undefined : textBoundOf(type, dialect);
  return bound === undefined ? {} : { textBound: bound };
}

/**
 * How much a text column of `type` holds: `varchar(n)` holds n characters on every database, and
 * MySQL's `text` holds 65,535 bytes. PostgreSQL's and SQLite's `text` bound nothing.
 */
export function textBoundOf(
  type: string,
  dialect: SupportedDialect
): TextBound | undefined {
  const varchar = /^varchar\((\d+)\)$/i.exec(type.trim());
  if (varchar) return { unit: "characters", most: Number(varchar[1]) };
  if (dialect === "mysql" && type.trim().toLowerCase() === "text") {
    return { unit: "bytes", most: 65_535 };
  }
  return undefined;
}

function choiceColumn(
  field: FieldDefinition,
  dialect: SupportedDialect,
  builtBy: ColumnOrigin
): { textBound?: TextBound; options: string[] } {
  return {
    ...textColumn(field, dialect, builtBy),
    options: selectOptionValues(field),
  };
}

/** How a number field's column stores a value, as its creator makes the column. */
function numberFormat(
  field: FieldDefinition,
  dialect: SupportedDialect,
  builtBy: ColumnOrigin
): NumberFormat {
  const column = getColumnDescriptor(field, dialect, builtBy);
  if (column?.kind === "decimal") {
    return {
      kind: "decimal",
      precision: column.precision ?? DEFAULT_DECIMAL_PRECISION,
      scale: column.scale ?? DEFAULT_DECIMAL_SCALE,
    };
  }
  if (column?.kind === "double") return { kind: "double" };
  // PostgreSQL's and MySQL's integer is 32 bits; SQLite's is 64.
  return { kind: "integer", bits: dialect === "sqlite" ? 64 : 32 };
}

/** A relationship's targets and where its links are kept, as its definition says. */
function relationOf(field: FieldDefinition): RelationTarget {
  const options = (field.options ?? {}) as {
    target?: unknown;
    relationType?: unknown;
  };
  const named = field.relationTo ?? options.target;
  const targets = (Array.isArray(named) ? named : [named])
    .filter((target): target is string => typeof target === "string")
    .sort();
  const kept =
    options.relationType === "manyToMany" && field.type === "relationship"
      ? "join"
      : field.hasMany === true || Array.isArray(field.relationTo)
        ? "several"
        : "one";
  return { targets, upload: field.type === "upload", kept };
}

/**
 * A plugin's type, judged as the built-in family its declared storage is: text as Text, a number as
 * a whole Number, a boolean as a Checkbox, a timestamp as a Date, JSON as JSON. A type no plugin has
 * loaded has no rule that can read its values.
 */
function pluginType(
  field: FieldDefinition,
  dialect: SupportedDialect,
  builtBy: ColumnOrigin
): FieldTypeOnDialect {
  const base = { dialect, type: field.type };
  const declared = getFieldType(field.type);
  if (declared === undefined) return { ...base, family: "unloaded" };
  switch (declared.storage) {
    case "text":
    case "longText":
      return { ...base, family: "text", ...textColumn(field, dialect, builtBy) };
    case "number":
      return {
        ...base,
        family: "number",
        number: { kind: "integer", bits: dialect === "sqlite" ? 64 : 32 },
      };
    case "boolean":
      return { ...base, family: "checkbox" };
    case "timestamp":
      return { ...base, family: "date", date: DATE_COLUMNS[dialect] };
    case "json":
      return { ...base, family: "json" };
    default:
      return { ...base, family: "unloaded" };
  }
}
