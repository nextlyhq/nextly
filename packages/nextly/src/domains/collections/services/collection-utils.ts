/**
 * Collection utility functions — Pure helpers for collection entry operations.
 *
 * Extracted from CollectionEntryService (6,490-line god file).
 * All functions are pure (no service dependencies) and can be used
 * by any split service.
 */

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

/**
 * Field types that are always stored as JSON in the database.
 */
export const ALWAYS_JSON_TYPES = new Set([
  "richText",
  "blocks",
  "repeater",
  "group",
  "json",
  "chips", // Chips fields store string[] as JSON
]);

/**
 * Field types that are searchable by default.
 * These types contain text content that can be searched with LIKE/ILIKE.
 */
export const SEARCHABLE_FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "richText",
] as const;

/**
 * Convert a snake_case name back to camelCase.
 * Used for mapping database column names back to field names in API responses.
 */
export function toCamelCase(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Add camelCase aliases for timestamp fields from database.
 * The database stores timestamps as `created_at` and `updated_at` (snake_case),
 * but the API response should provide them as `createdAt` and `updatedAt` (camelCase).
 */
export function withTimestampAliases<T extends Record<string, unknown>>(
  entry: T
): T {
  const record = entry as Record<string, unknown>;
  if (record.createdAt === undefined && record.created_at !== undefined) {
    record.createdAt = record.created_at;
  }
  if (record.updatedAt === undefined && record.updated_at !== undefined) {
    record.updatedAt = record.updated_at;
  }
  return entry;
}

/**
 * Checks if a field requires JSON serialization/deserialization.
 * Also checks hasMany for select/text/number/upload/relationship
 * fields which are stored as jsonb when they hold arrays.
 *
 * Bug 7 (post-Phase-4 testing-pass): `relationship` fields with
 * `hasMany: true` were missing from this check. The schema generator
 * creates a JSON-style text column for them (single-column array of
 * IDs, Payload pattern), but the mutation service's JSON-serialization
 * step skipped them — leaving raw JS arrays to reach Drizzle's bind
 * site, which crashed better-sqlite3 with "Too few parameter values
 * were provided." Adding `relationship` to the hasMany conditional
 * mirrors the schema generator's behavior: when hasMany, the column
 * holds a JSON-stringified array of IDs.
 */
export function isJsonFieldType(
  fieldType: string,
  field?: { hasMany?: boolean; relationTo?: unknown }
): boolean {
  if (ALWAYS_JSON_TYPES.has(fieldType)) return true;

  if (
    (fieldType === "select" ||
      fieldType === "text" ||
      fieldType === "number" ||
      fieldType === "relationship") &&
    field?.hasMany
  ) {
    return true;
  }

  if (fieldType === "upload") {
    return !!(field?.hasMany || Array.isArray(field?.relationTo));
  }

  return false;
}

/**
 * Checks if a field is a relationship field.
 */
export function isRelationshipField(fieldType: string): boolean {
  return fieldType === "relationship";
}

/**
 * Normalizes relationship field values to extract only IDs.
 *
 * The frontend may send full objects with display properties like:
 * - { id: "uuid", title: "test", name: "foo" }
 * - { relationTo: "collection", value: "uuid", title: "test" }
 *
 * This function normalizes them to:
 * - Non-polymorphic: just the ID string
 * - Polymorphic: { relationTo: string, value: string }
 */
export function normalizeRelationshipValue(
  value: unknown,
  isPolymorphic: boolean
): unknown {
  if (value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeRelationshipItem(item, isPolymorphic));
  }

  return normalizeRelationshipItem(value, isPolymorphic);
}

/**
 * Normalizes a single relationship item.
 */
export function normalizeRelationshipItem(
  item: unknown,
  isPolymorphic: boolean
): unknown {
  if (item == null) {
    return item;
  }

  if (typeof item === "string") {
    return item;
  }

  if (typeof item === "object") {
    const obj = item as Record<string, unknown>;

    if (isPolymorphic && "relationTo" in obj && "value" in obj) {
      return {
        relationTo: obj.relationTo,
        value: obj.value,
      };
    }

    if ("id" in obj && typeof obj.id === "string") {
      return obj.id;
    }

    // Fallback for polymorphic with relationTo/value
    if ("relationTo" in obj && "value" in obj) {
      return {
        relationTo: obj.relationTo,
        value: obj.value,
      };
    }
  }

  // Empty objects or unrecognizable values should be treated as null
  if (typeof item === "object" && Object.keys(item as object).length === 0) {
    return null;
  }

  return item;
}

/**
 * Recursively normalizes relationship data inside repeater/group field values.
 * Strips full relationship objects down to just IDs before saving to the database.
 */
export function normalizeNestedRelationships(
  data: Record<string, unknown>,
  fields: FieldDefinition[]
): Record<string, unknown> {
  const normalized = { ...data };

  for (const field of fields) {
    const fieldName = field.name;
    if (
      !fieldName ||
      normalized[fieldName] === undefined ||
      normalized[fieldName] === null
    )
      continue;

    if (field.type === "repeater" || field.type === "group") {
      const nestedFields = ((field as Record<string, unknown>).fields ||
        []) as FieldDefinition[];
      if (nestedFields.length === 0) continue;

      const value = normalized[fieldName];
      if (field.type === "repeater" && Array.isArray(value)) {
        normalized[fieldName] = value.map((row: unknown) => {
          if (row && typeof row === "object" && !Array.isArray(row)) {
            return normalizeNestedRelationships(
              row as Record<string, unknown>,
              nestedFields
            );
          }
          return row;
        });
      } else if (
        field.type === "group" &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        normalized[fieldName] = normalizeNestedRelationships(
          value as Record<string, unknown>,
          nestedFields
        );
      }
    } else if (isRelationshipField(field.type)) {
      const isPolymorphic = Array.isArray(
        (field as Record<string, unknown>).relationTo
      );
      normalized[fieldName] = normalizeRelationshipValue(
        normalized[fieldName],
        isPolymorphic
      );
    }
  }

  return normalized;
}

/**
 * Get the table name for a collection (convention: dc_collectionName).
 * Converts hyphens to underscores for database compatibility.
 */
export function getTableName(collectionName: string): string {
  return `dc_${collectionName.replace(/-/g, "_")}`;
}

/**
 * Generate a URL-friendly slug from a string.
 * Converts to lowercase, replaces spaces and special characters with hyphens,
 * and removes consecutive hyphens.
 */
export function generateSlug(value: string): string {
  return value
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/**
 * Normalize upload field values by extracting IDs from populated media objects.
 *
 * When editing an entry without changing an upload field, the form sends the full
 * populated object from the API (with properties like id, filename, url, etc.).
 * This helper extracts just the ID for database storage.
 */
export function normalizeUploadFields(
  data: Record<string, unknown>,
  fields: FieldDefinition[]
): void {
  fields.forEach(field => {
    if (field.type === "upload") {
      if (data[field.name] != null) {
        const uploadField = field as { hasMany?: boolean };
        if (uploadField.hasMany && Array.isArray(data[field.name])) {
          data[field.name] = (data[field.name] as unknown[]).map(
            (item: unknown) => {
              if (typeof item === "string") return item;
              if (typeof item === "object" && item !== null && "id" in item) {
                return (item as Record<string, unknown>).id;
              }
              return item;
            }
          );
        } else {
          const value = data[field.name];
          if (typeof value === "object" && value !== null && "id" in value) {
            data[field.name] = (value as Record<string, unknown>).id;
          }
        }
      }
    }
  });
}

/**
 * Get searchable fields for a collection.
 *
 * Returns explicitly configured searchable fields if defined,
 * otherwise returns system identifiers plus text-like fields.
 */
export function getSearchableFields(
  collection: Record<string, unknown>
): string[] {
  const searchConfig =
    (collection.search as Record<string, unknown>) ||
    ((collection.schemaDefinition as Record<string, unknown> | undefined)
      ?.search as Record<string, unknown> | undefined);
  const searchableFields = searchConfig?.searchableFields as
    | string[]
    | undefined;
  if (searchableFields?.length) {
    return searchableFields;
  }

  const schemaDef = collection.schemaDefinition as
    | Record<string, unknown>
    | undefined;
  const fields: FieldDefinition[] = (schemaDef?.fields ||
    collection.fields ||
    []) as FieldDefinition[];

  const defaultSearchableFields = ["slug", "title"];

  const autoDetectedTextFields = fields
    .filter((field: FieldDefinition) => {
      if (!field?.name || typeof field.name !== "string") return false;

      // Honor explicit per-field searchable flags when present.
      if ((field as Record<string, unknown>).searchable === true) return true;

      return (SEARCHABLE_FIELD_TYPES as readonly string[]).includes(field.type);
    })
    .map((field: FieldDefinition) => field.name);

  return Array.from(
    new Set([...defaultSearchableFields, ...autoDetectedTextFields])
  );
}

/**
 * Get minimum search query length for a collection.
 */
export function getMinSearchLength(
  collection: Record<string, unknown>
): number {
  const searchConfig =
    (collection.search as Record<string, unknown>) ||
    ((collection.schemaDefinition as Record<string, unknown> | undefined)
      ?.search as Record<string, unknown> | undefined);
  return (searchConfig?.minSearchLength as number) ?? 2;
}
