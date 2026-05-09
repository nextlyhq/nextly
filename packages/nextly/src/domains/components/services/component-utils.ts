import type { FieldConfig } from "../../../collections/fields/types";

/**
 * Default relationship expansion depth for component data.
 */
export const DEFAULT_COMPONENT_DEPTH = 2;

/**
 * Internal/system columns that are stripped during deserialization.
 */
export const POPULATE_INTERNAL_COLUMNS: ReadonlySet<string> = new Set([
  "_parent_id",
  "_parent_table",
  "_parent_field",
  "_order",
  "_component_type",
]);

/**
 * Meta properties on incoming component data that are not serialized as table columns.
 */
export const COMPONENT_META_KEYS: ReadonlySet<string> = new Set([
  "id",
  "_componentType",
  "_order",
  "_parent_id",
  "_parent_table",
  "_parent_field",
  "_component_type",
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
  _componentType?: string;
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
  "blocks",
  "group",
  "tabs",
  "collapsible",
  "point",
  "richText",
  "component",
]);

export function shouldTreatAsJson(field: FieldConfig): boolean {
  if (ALWAYS_JSON_TYPES.has(field.type)) {
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
