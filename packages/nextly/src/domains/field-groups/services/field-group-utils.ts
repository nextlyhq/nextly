import type { FieldConfig } from "../../../collections/fields/types";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { storageTypeToken } from "../../../shared/lib/plugin-storage";

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
  STORAGE_FORMAT.wireTypeKey,
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
  _component_type: string | null;
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

  if (field.type === "relationship" || field.type === "upload") {
    const hasMany = "hasMany" in field && field.hasMany;
    const relationTo = "relationTo" in field ? field.relationTo : undefined;
    const isPolymorphic = Array.isArray(relationTo);
    return Boolean(hasMany) || isPolymorphic;
  }

  return false;
}
