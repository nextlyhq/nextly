/**
 * A field's type as the type-change judgement reads it on one database: its family, and what its
 * column holds there. The family decides which rule applies; what the column holds decides whether
 * a value fits it. Both are read from the field's own definition and from the column descriptor
 * that creates its column (`getColumnDescriptor`), never restated, so the judgement and the column
 * a change creates agree on every database.
 *
 * @module domains/schema/value-conversion/type-change/field-type
 */
import type {
  DynamicFieldType,
  FieldDefinition,
} from "../../../../schemas/dynamic-collections";
import { selectOptionValues } from "../../../../shared/lib/entry-validation";
import { getFieldType } from "../../field-types/field-type-registry";
import {
  type ColumnOrigin,
  DEFAULT_DECIMAL_PRECISION,
  DEFAULT_DECIMAL_SCALE,
  getColumnDescriptor,
  numberFieldStoresFractions,
  relationStorageShape,
  type SupportedDialect,
} from "../../services/field-column-descriptor";
import { parseColumnType } from "../column-type";

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
  | "unloaded"
  /** A built-in type no rule names a family for (an icon's id): no rule converts it. */
  | "unlisted";

/** How a number column stores a value. */
export type NumberFormat =
  | { kind: "integer"; bits: 32 | 64 }
  | { kind: "double" }
  | { kind: "decimal"; precision: number; scale: number }
  /**
   * An item of a list of numbers, kept as a JSON number: read back as a JavaScript number, never
   * non-finite, and a whole number where the field allows no fraction.
   */
  | { kind: "json"; whole: boolean };

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
  /**
   * As the column keeps the links (`relationStorageShape`): one id, a list of ids, one
   * `{ relationTo, value }` reference to one of several collections, a list of such references, or
   * a join table.
   */
  kept: "one" | "list" | "targets" | "targetList" | "join";
}

/** A field's type on one database, as the rules read it. */
export interface FieldTypeOnDialect {
  family: Family;
  dialect: SupportedDialect;
  /** The field's type name, which a refusal names. */
  type: string;
  /** Text, Email, Choice, Rich text, and a list kept in a text column: what the column holds. */
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
  // A built-in type is read by its own entry; any other is a plugin's.
  const read = Object.hasOwn(BY_TYPE, field.type)
    ? BY_TYPE[field.type]
    : pluginType;
  return read(field, dialect, builtBy);
}

/** How one field type reads on a database. */
type TypeReader = (
  field: FieldDefinition,
  dialect: SupportedDialect,
  builtBy: ColumnOrigin
) => FieldTypeOnDialect;

/** The base every reading starts from: the database, and the field's type name. */
const baseOf = (field: FieldDefinition, dialect: SupportedDialect) => ({
  dialect,
  type: field.type,
});

/** A family whose column bounds its text: Text, Email, Rich text. */
const bounded =
  (family: "text" | "email" | "richText"): TypeReader =>
  (field, dialect, builtBy) => ({
    ...baseOf(field, dialect),
    family,
    ...textColumn(field, dialect, builtBy),
  });

/** A family the rules read with nothing more than the family. */
const plain =
  (family: Family): TypeReader =>
  (field, dialect) => ({ ...baseOf(field, dialect), family });

/**
 * The built-in field types, each read as its family and what its column holds. Every built-in type
 * has an entry, so a type added to the union is read deliberately, never as a plugin's.
 */
const BY_TYPE: Record<DynamicFieldType, TypeReader> = {
  // A text field holding several values keeps them as a JSON list of texts.
  text: (field, dialect, builtBy) =>
    field.hasMany === true
      ? {
          ...baseOf(field, dialect),
          family: "list",
          // The list is written to the field's own text column, which bounds its writing.
          ...textColumn(field, dialect, builtBy),
          item: { ...baseOf(field, dialect), family: "text" },
        }
      : bounded("text")(field, dialect, builtBy),
  textarea: bounded("text"),
  code: bounded("text"),
  email: bounded("email"),
  richText: bounded("richText"),
  radio: (field, dialect, builtBy) => ({
    ...baseOf(field, dialect),
    family: "choice",
    ...choiceColumn(field, dialect, builtBy),
  }),
  select: (field, dialect, builtBy) =>
    field.hasMany === true
      ? {
          ...baseOf(field, dialect),
          family: "list",
          // A select holding several values writes the list to its text column, which bounds it.
          ...textColumn(field, dialect, builtBy),
          item: {
            ...baseOf(field, dialect),
            family: "choice",
            options: selectOptionValues(field),
          },
        }
      : {
          ...baseOf(field, dialect),
          family: "choice",
          ...choiceColumn(field, dialect, builtBy),
        },
  number: (field, dialect, builtBy) =>
    field.hasMany === true
      ? {
          ...baseOf(field, dialect),
          family: "list",
          // A list keeps its numbers as JSON numbers, each a whole number unless the field allows
          // fractions, as its validator reads each item (`numberFieldStoresFractions`).
          item: {
            ...baseOf(field, dialect),
            family: "number",
            number: {
              kind: "json",
              whole: !numberFieldStoresFractions(field),
            },
          },
        }
      : {
          ...baseOf(field, dialect),
          family: "number",
          number: numberFormat(field, dialect, builtBy),
        },
  checkbox: plain("checkbox"),
  date: (field, dialect) => ({
    ...baseOf(field, dialect),
    family: "date",
    date: DATE_COLUMNS[dialect],
  }),
  json: plain("json"),
  // A chip is a text item of a JSON list, which bounds none.
  chips: (field, dialect) => ({
    ...baseOf(field, dialect),
    family: "list",
    item: { ...baseOf(field, dialect), family: "text" },
  }),
  relationship: (field, dialect) => ({
    ...baseOf(field, dialect),
    family: "relationship",
    relation: relationOf(field),
  }),
  upload: (field, dialect) => ({
    ...baseOf(field, dialect),
    family: "relationship",
    relation: relationOf(field),
  }),
  password: plain("password"),
  group: plain("container"),
  repeater: plain("container"),
  component: plain("container"),
  fieldGroup: plain("container"),
  icon: plain("unlisted"),
};

/**
 * What a date field reads back on each database. The field reads a JavaScript `Date`, which keeps
 * milliseconds, so PostgreSQL's `timestamp`, which stores microseconds, is read to milliseconds;
 * MySQL's `timestamp`, declared with no fractional digits, keeps whole seconds from
 * 1970-01-01 00:00:01 to 2038-01-19 03:14:07 UTC; SQLite's epoch integer keeps whole seconds.
 */
const DATE_COLUMNS: Record<SupportedDialect, DateColumn> = {
  postgresql: { fractionDigits: 3 },
  mysql: { fractionDigits: 0, range: { first: 1, last: 2_147_483_647 } },
  sqlite: { fractionDigits: 0 },
};

/**
 * A text-like field's bound, read from the column its creator makes for it, as the column judgement
 * reads a column type (`parseColumnType`): a `varchar(n)` holds n characters on every database,
 * and MySQL's `text`, the only text type the creator makes there, holds 65,535 bytes. PostgreSQL's
 * and SQLite's `text` bound nothing.
 */
function textColumn(
  field: FieldDefinition,
  dialect: SupportedDialect,
  builtBy: ColumnOrigin
): { textBound?: TextBound } {
  const type = getColumnDescriptor(field, dialect, builtBy)?.dialectType;
  if (type === undefined) return {};
  const parsed = parseColumnType({ type, nullable: true });
  if (parsed.family === "varchar" && parsed.length !== undefined) {
    return { textBound: { unit: "characters", most: parsed.length } };
  }
  if (parsed.family === "text" && dialect === "mysql") {
    return { textBound: { unit: "bytes", most: 65_535 } };
  }
  return {};
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
      : (relationStorageShape(field) ?? "one");
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
      return {
        ...base,
        family: "text",
        ...textColumn(field, dialect, builtBy),
      };
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
