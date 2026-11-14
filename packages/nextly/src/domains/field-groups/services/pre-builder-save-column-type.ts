/**
 * The column type a field group's own creator (`FieldGroupSchemaService`) gave a field before it
 * built its columns from the column descriptor: a record of tables that exist, not a way to build
 * one. No code creates a column from this.
 *
 * ## Why it is kept
 *
 * Until 0.0.2-alpha.77 the creator mapped field types with a table of its own, and every route that
 * reached it (a field group created where no Builder save writer is set up, and `nextly db:sync`'s
 * creation of a code-first field group's table) wrote that table's spelling. Some of it differs from
 * the descriptor's (`field-column-descriptor.ts`, where field-to-column mapping lives):
 * - PostgreSQL: `VARCHAR(255)` for an email, password, select or radio, where the descriptor says
 *   `text`; `UUID` for a single reference, where it says `text`; `JSONB` for a multi-select;
 * - MySQL: `DATETIME` for a date, where the descriptor says `timestamp`; `JSON` for a multi-select;
 * - every dialect: a scalar number column for a `hasMany` number, where the descriptor says JSON.
 *
 * Databases keep those columns, and nothing migrates them. So the field-group reconcile accepts this
 * spelling beside the descriptor's, and the column repair report names it as an earlier creator's
 * rather than as a difference nothing explains. It can be retired once no supported install can
 * hold a table built before that release.
 *
 * @module domains/field-groups/services/pre-builder-save-column-type
 */

import { isNumberField } from "../../../collections/fields/guards";
import type { DataFieldConfig } from "../../../collections/fields/types";
import {
  DEFAULT_DECIMAL_PRECISION,
  DEFAULT_DECIMAL_SCALE,
  componentRelationshipStoresJson,
  getComponentRowColumnDescriptor,
  type SupportedDialect,
} from "../../schema/services/field-column-descriptor";

import { asStorageMappedField } from "./field-group-schema-service";

/** The creator's type words, per dialect, as it spelled them in its CREATE TABLE. */
interface EarlierTypes {
  uuid: string;
  text: string;
  varchar255: string;
  boolean: string;
  integer: string;
  real: string;
  decimal: (precision: number, scale: number) => string;
  timestamp: string;
  json: string;
}

const EARLIER_TYPES: Record<SupportedDialect, EarlierTypes> = {
  postgresql: {
    uuid: "UUID",
    text: "TEXT",
    varchar255: "VARCHAR(255)",
    boolean: "BOOLEAN",
    integer: "INTEGER",
    real: "DOUBLE PRECISION",
    decimal: (precision, scale) => `NUMERIC(${precision}, ${scale})`,
    timestamp: "TIMESTAMP",
    json: "JSONB",
  },
  mysql: {
    uuid: "VARCHAR(36)",
    text: "TEXT",
    varchar255: "VARCHAR(255)",
    boolean: "BOOLEAN",
    integer: "INT",
    real: "DOUBLE",
    decimal: (precision, scale) => `DECIMAL(${precision}, ${scale})`,
    timestamp: "DATETIME",
    json: "JSON",
  },
  sqlite: {
    uuid: "TEXT",
    text: "TEXT",
    varchar255: "TEXT",
    boolean: "INTEGER",
    integer: "INTEGER",
    real: "REAL",
    decimal: () => "NUMERIC",
    timestamp: "INTEGER",
    json: "TEXT",
  },
};

/** The type word each field type got by its type alone. */
type PlainKind = Exclude<keyof EarlierTypes, "decimal">;

/**
 * The field types whose column the creator chose by type alone. A number, a select and a relation
 * read more of the field (`shapedKind`); a text field and an icon read the descriptor.
 */
const KIND_BY_TYPE: Readonly<Record<string, PlainKind>> = {
  textarea: "text",
  richText: "text",
  code: "text",
  email: "varchar255",
  password: "varchar255",
  radio: "varchar255",
  checkbox: "boolean",
  date: "timestamp",
  repeater: "json",
  group: "json",
  json: "json",
};

/** The column of a number, a select or a relation, which the creator read more of the field for. */
function shapedKind(
  field: DataFieldConfig,
  types: EarlierTypes
): string | null {
  if (isNumberField(field)) {
    // Decimal on `dbType: "decimal"`, a double on the float format, an integer otherwise; a
    // `hasMany` number was not told apart, so it got the same scalar column.
    if (field.dbType === "decimal") {
      return types.decimal(
        field.precision ?? DEFAULT_DECIMAL_PRECISION,
        field.scale ?? DEFAULT_DECIMAL_SCALE
      );
    }
    const format = (field as { options?: { format?: string } }).options?.format;
    return format === "float" ? types.real : types.integer;
  }
  const many = (field as { hasMany?: unknown }).hasMany === true;
  if (field.type === "select") return many ? types.json : types.varchar255;
  if (field.type === "upload" || field.type === "relationship") {
    return componentRelationshipStoresJson(field) ? types.json : types.uuid;
  }
  return null;
}

/**
 * The type the field group's creator gave `field` before 0.0.2-alpha.77, or null where it gave the
 * field no column.
 */
export function preBuilderSaveColumnType(
  field: DataFieldConfig,
  dialect: SupportedDialect
): string | null {
  // A plugin type was mapped as the built-in its storage primitive names, as the creator still
  // maps it for its runtime table.
  const mapped = asStorageMappedField(field);
  const types = EARLIER_TYPES[dialect];

  // An icon's and a text field's columns were already the descriptor's.
  if (mapped.type === "icon" || mapped.type === "text") {
    if (!mapped.name) return null;
    return (
      getComponentRowColumnDescriptor(mapped, dialect, "fieldGroup")
        ?.dialectType ?? null
    );
  }
  const kind = KIND_BY_TYPE[mapped.type];
  return kind === undefined ? shapedKind(mapped, types) : types[kind];
}
