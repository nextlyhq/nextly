import type { FieldConfig } from "../../../collections/fields/types";
import { isVirtualField } from "../../../collections/fields/virtual";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { storageTypeToken } from "../../../shared/lib/plugin-storage";
import {
  componentRelationshipStoresList,
  usesJunctionTable,
} from "../../schema/services/field-column-descriptor";
import { isFieldGroupFieldType } from "../storage/field-group-field-type";
import { fieldGroupTypeKeys } from "../storage/field-group-type-key";

/**
 * Default relationship expansion depth for component data.
 */
export const DEFAULT_COMPONENT_DEPTH = 2;

/**
 * Internal/system columns that are stripped during deserialization.
 */
export const POPULATE_INTERNAL_COLUMNS: ReadonlySet<string> = new Set([
  STORAGE_FORMAT.columns.parentId,
  STORAGE_FORMAT.columns.parentTable,
  STORAGE_FORMAT.columns.parentField,
  STORAGE_FORMAT.columns.order,
  STORAGE_FORMAT.columns.type,
]);

/**
 * Meta properties on incoming component data that are not serialized as table columns.
 */
export const COMPONENT_META_KEYS: ReadonlySet<string> = new Set([
  "id",
  // Every spelling of the discriminator, not just the one written today. This set decides what
  // counts as metadata rather than authored data, so a spelling missing from it is treated as a
  // field the caller meant to store — which is the opposite of the intent for a key that only
  // ever announced the instance's type.
  ...fieldGroupTypeKeys,
  STORAGE_FORMAT.columns.order,
  STORAGE_FORMAT.columns.parentId,
  STORAGE_FORMAT.columns.parentTable,
  STORAGE_FORMAT.columns.parentField,
  STORAGE_FORMAT.columns.type,
  "createdAt",
  "updatedAt",
  "created_at",
  "updated_at",
]);

/**
 * A single component instance row as stored in the component data table.
 */
export interface ComponentRow {
  id: string;
  _parent_id: string;
  _parent_table: string;
  _parent_field: string;
  _order: number;
  /**
   * The discriminator column is admitted by the index signature, not declared.
   *
   * Declaring it would fix one spelling into the type while the storage migration renames the
   * column, so the declaration would describe a migrated table incorrectly — and it bought no
   * narrowing that the index signature does not already give, since every reader addresses the
   * column through `STORAGE_FORMAT.columns.type` rather than by writing the name.
   *
   * The sibling columns stay declared because the migration does not rename them.
   */
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

/**
 * Input data for a single component instance.
 */
export interface ComponentInstanceData {
  id?: string;
  /**
   * The type discriminator is reached through `readFieldGroupType`, not declared here.
   *
   * Naming the key in this shape would fix ONE spelling into the type, and the storage migration
   * renames it — so the declaration would go stale exactly when a document could carry either
   * one. The index signature below already admits it; the accessor is what knows which.
   */
  [key: string]: unknown;
}

/**
 * Whether a component field is stored in a column of the component's own row.
 *
 * Not the descriptor's `fieldProducesColumn`, deliberately: that rule also
 * gives a many-to-many relationship no column, because a collection keeps its
 * links in a junction table. A component has no junction, so such a field is
 * stored on the instance row like any other relationship value. Only a virtual
 * field (which stores nothing) and a nested field group (which has its own
 * table) have no column here. The DDL, the runtime tables, the ALTER plan and
 * the row serializer all ask this one question.
 */
export function componentFieldHasColumn(field: {
  type?: unknown;
  options?: unknown;
  virtual?: unknown;
}): boolean {
  return !isVirtualField(field) && !isFieldGroupFieldType(field.type);
}

export function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

export function toCamelCase(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

const ALWAYS_JSON_TYPES: ReadonlySet<string> = new Set([
  "json",
  "repeater",
  "group",
  "richText",
  "component",
  // A blocks field stores one page document as JSON.
  "blocks",
]);

export function shouldTreatAsJson(field: FieldConfig): boolean {
  // A plugin type is decided on what it stores, not on its own token, or a
  // `json`-backed field would get a JSON column and a raw object written into
  // it. None of the primitives is `select`, `relationship` or `upload`, so the
  // branches below still read the declared type.
  const storageToken = storageTypeToken(field);
  if (storageToken !== undefined && ALWAYS_JSON_TYPES.has(storageToken)) {
    return true;
  }

  if (field.type === "select" && "hasMany" in field && field.hasMany) {
    return true;
  }

  // A relation holding a list on the component row — hasMany, several targets, or a many-to-many,
  // which a component keeps on its row — is a JSON column. The creating SQL, the runtime table and
  // the desired schema ask the same rule.
  return componentRelationshipStoresList(field);
}

/**
 * A component many-to-many's decoded value, read as the list it always is.
 *
 * The column holds a JSON list, but a row can still carry a single id: one saved as a bare value
 * rather than a list, or a row written before the column held lists, which on SQLite is never
 * converted because its column type does not change. Either is one reference, so it reads as a
 * one-item list rather than handing the caller a string where every other row gives an array.
 *
 * A string starting with `{` is left as it is: that is a PostgreSQL array literal in a `text` column
 * its owner has not converted yet, and reading it as one id would misread it.
 */
export function asComponentReferenceList(
  field: FieldConfig,
  value: unknown
): unknown {
  if (!usesJunctionTable(field)) return value;
  if (typeof value === "string" && !value.trimStart().startsWith("{")) {
    return [value];
  }
  return value;
}
