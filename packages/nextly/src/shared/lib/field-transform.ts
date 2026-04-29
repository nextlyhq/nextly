/**
 * Field Transform Utilities
 *
 * Utilities for serializing/deserializing complex field data for database storage.
 * Handles transformation of array, group, blocks, json, relationship, date, and point fields.
 *
 * @module lib/field-transform
 * @since 1.0.0
 */

import type {
  FieldConfig,
  DataFieldConfig,
} from "../../collections/fields/types";
import { NextlyError } from "../../errors";

import {
  formatRichTextOutput,
  isRichTextValue,
  type RichTextOutputFormat,
} from "./rich-text-html";

// ============================================================
// Types
// ============================================================

/**
 * Field types that require JSON serialization for storage.
 * These types store complex nested data structures.
 */
const JSON_SERIALIZABLE_TYPES = ["repeater", "group", "json"] as const;

/**
 * Field types that are layout-only and don't store data.
 * Currently empty as layout field types have been removed.
 */
const LAYOUT_FIELD_TYPES: readonly string[] = [] as const;

/**
 * Options for transform operations.
 */
export interface TransformOptions {
  /**
   * Whether to recursively transform nested fields.
   * When true, processes relationships and dates within complex structures.
   * @default true
   */
  recursive?: boolean;

  /**
   * Output format for rich text fields.
   * - `json` - Return only the Lexical JSON structure (default)
   * - `html` - Return only the HTML string
   * - `both` - Return an object with both `json` and `html` properties
   * @default "json"
   */
  richTextFormat?: RichTextOutputFormat;
}

// ============================================================
// Type Guards
// ============================================================

/**
 * Check if a field type is a layout-only field (no data storage).
 */
function isLayoutField(field: FieldConfig): boolean {
  return LAYOUT_FIELD_TYPES.includes(
    field.type as (typeof LAYOUT_FIELD_TYPES)[number]
  );
}

/**
 * Check if a field type requires JSON serialization.
 */
function isJSONSerializableType(type: string): boolean {
  return JSON_SERIALIZABLE_TYPES.includes(
    type as (typeof JSON_SERIALIZABLE_TYPES)[number]
  );
}

/**
 * Check if a value looks like it's already been JSON serialized (is a string).
 */
function isAlreadySerialized(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  );
}

/**
 * Check if a field is a data field with a name property.
 */
function isNamedDataField(
  field: FieldConfig
): field is DataFieldConfig & { name: string } {
  return (
    !isLayoutField(field) && "name" in field && typeof field.name === "string"
  );
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Flatten fields array, returning only data fields.
 */
function flattenFields(fields: FieldConfig[]): FieldConfig[] {
  return fields.filter(field => !isLayoutField(field));
}

/**
 * Build a field lookup map for efficient field access by name.
 */
function buildFieldMap(fields: FieldConfig[]): Map<string, FieldConfig> {
  const flatFields = flattenFields(fields);
  const map = new Map<string, FieldConfig>();

  for (const field of flatFields) {
    if (isNamedDataField(field)) {
      map.set(field.name, field);
    }
  }

  return map;
}

/**
 * Extract ID from a relationship value.
 * Handles both simple IDs and polymorphic {relationTo, value} objects.
 */
function extractRelationshipId(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // Already an ID string
  if (typeof value === "string") {
    return value;
  }

  // Populated object with id property
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;

    // Polymorphic relationship: { relationTo: string, value: string | object }
    if ("relationTo" in obj && "value" in obj) {
      const innerValue = obj.value;
      // Extract ID from inner value if it's a populated object
      if (
        typeof innerValue === "object" &&
        innerValue !== null &&
        "id" in innerValue
      ) {
        return {
          relationTo: obj.relationTo,
          value: (innerValue as Record<string, unknown>).id,
        };
      }
      return value; // Already in correct format
    }

    // Simple populated object: { id: string, ...otherFields }
    if ("id" in obj) {
      return obj.id;
    }
  }

  // Return as-is if we can't extract an ID
  return value;
}

/**
 * Process a value recursively to handle nested relationships and dates.
 */
function processNestedValue(
  value: unknown,
  nestedFields: FieldConfig[] | undefined
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // If we have field definitions, use them for precise transformation
  if (nestedFields && Array.isArray(nestedFields)) {
    const fieldMap = buildFieldMap(nestedFields);

    if (Array.isArray(value)) {
      // Array of objects (array field rows or blocks)
      return value.map(item => {
        if (typeof item === "object" && item !== null) {
          return processObjectWithFields(
            item as Record<string, unknown>,
            fieldMap
          );
        }
        return item;
      });
    }

    if (typeof value === "object") {
      return processObjectWithFields(
        value as Record<string, unknown>,
        fieldMap
      );
    }
  }

  return value;
}

/**
 * Process an object using a field map for transformation.
 */
function processObjectWithFields(
  obj: Record<string, unknown>,
  fieldMap: Map<string, FieldConfig>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    const field = fieldMap.get(key);

    if (!field) {
      // No field definition - pass through as-is
      result[key] = val;
      continue;
    }

    // Transform based on field type
    result[key] = transformValueForStorage(val, field);
  }

  return result;
}

/**
 * Transform a single value based on its field type for storage.
 */
function transformValueForStorage(value: unknown, field: FieldConfig): unknown {
  if (value === undefined) {
    return undefined;
  }

  switch (field.type) {
    case "relationship":
    case "upload": {
      // Extract IDs from populated objects
      const relField = field as { hasMany?: boolean };
      if (relField.hasMany && Array.isArray(value)) {
        return value.map(v => extractRelationshipId(v));
      }
      return extractRelationshipId(value);
    }

    case "date": {
      // Ensure ISO string format
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    }

    case "repeater": {
      // Process nested fields within array rows
      const arrayField = field as { fields?: FieldConfig[] };
      if (Array.isArray(value) && arrayField.fields) {
        return processNestedValue(value, arrayField.fields);
      }
      return value;
    }

    case "group": {
      // Process nested fields within group
      const groupField = field as { fields?: FieldConfig[] };
      if (typeof value === "object" && value !== null && groupField.fields) {
        return processNestedValue(value, groupField.fields);
      }
      return value;
    }

    default:
      return value;
  }
}

// ============================================================
// Main Transform Functions
// ============================================================

/**
 * Transform entry data before storing in database.
 *
 * Performs the following transformations:
 * - Serializes arrays/groups/blocks/json to JSON strings
 * - Extracts IDs from populated relationship/upload objects
 * - Ensures dates are in ISO string format
 * - Recursively processes nested fields
 *
 * @param data - Entry data to transform
 * @param fields - Field configurations for the collection
 * @param options - Transform options
 * @returns Transformed data ready for database storage
 * @throws NextlyError (VALIDATION_ERROR with code "TRANSFORM_FAILED") if serialization fails
 *
 * @example
 * ```typescript
 * const storedData = transformForStorage(
 *   { title: 'Hello', tags: [{ name: 'news' }], author: { id: '123', name: 'John' } },
 *   collectionFields
 * );
 * // Result: { title: 'Hello', tags: '[{"name":"news"}]', author: '123' }
 * ```
 */
export function transformForStorage(
  data: Record<string, unknown>,
  fields: FieldConfig[],
  options: TransformOptions = {}
): Record<string, unknown> {
  const { recursive = true } = options;
  const result: Record<string, unknown> = {};
  const fieldMap = buildFieldMap(fields);

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      continue;
    }

    const field = fieldMap.get(key);

    // Pass through unknown fields (system fields like id, createdAt, updatedAt)
    if (!field) {
      result[key] = value;
      continue;
    }

    try {
      // First, recursively transform nested relationships/dates if needed
      let processedValue: unknown = value;
      if (recursive) {
        processedValue = transformValueForStorage(value, field);
      }

      // Then serialize complex types to JSON strings
      if (isJSONSerializableType(field.type)) {
        // Skip if null or already serialized
        if (processedValue === null) {
          result[key] = null;
        } else if (isAlreadySerialized(processedValue)) {
          result[key] = processedValue;
        } else {
          result[key] = JSON.stringify(processedValue);
        }
      } else if (field.type === "relationship" || field.type === "upload") {
        // Handle relationship/upload - extract IDs
        const relField = field as { hasMany?: boolean };
        if (relField.hasMany && Array.isArray(processedValue)) {
          result[key] = processedValue.map(v => extractRelationshipId(v));
        } else {
          result[key] = extractRelationshipId(processedValue);
        }
      } else if (field.type === "date") {
        // Ensure ISO string format
        if (processedValue instanceof Date) {
          result[key] = processedValue.toISOString();
        } else {
          result[key] = processedValue;
        }
      } else {
        result[key] = processedValue;
      }
    } catch (error) {
      throw NextlyError.validation({
        errors: [
          {
            path: key,
            code: "TRANSFORM_FAILED",
            message: "Field transformation failed.",
          },
        ],
        logContext: {
          fieldName: key,
          fieldType: field.type,
          operation: "serialize",
          cause: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return result;
}

/**
 * Transform entry data after reading from database.
 *
 * Performs the following transformations:
 * - Parses JSON strings back to objects for array/group/blocks/json fields
 * - Handles already-parsed data gracefully
 *
 * Note: Relationship expansion is handled by CollectionRelationshipService,
 * and date parsing is handled by the database adapter.
 *
 * @param data - Entry data from database
 * @param fields - Field configurations for the collection
 * @returns Transformed data ready for application use
 * @throws NextlyError (VALIDATION_ERROR with code "TRANSFORM_FAILED") if deserialization fails
 *
 * @example
 * ```typescript
 * const appData = transformFromStorage(
 *   { title: 'Hello', tags: '[{"name":"news"}]', author: '123' },
 *   collectionFields
 * );
 * // Result: { title: 'Hello', tags: [{ name: 'news' }], author: '123' }
 * ```
 */
export function transformFromStorage(
  data: Record<string, unknown>,
  fields: FieldConfig[]
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data };
  const fieldMap = buildFieldMap(fields);

  for (const [key, value] of Object.entries(result)) {
    if (value === undefined || value === null) {
      continue;
    }

    const field = fieldMap.get(key);

    // Pass through unknown fields
    if (!field) {
      continue;
    }

    // Only parse JSON serializable types
    if (!isJSONSerializableType(field.type)) {
      continue;
    }

    try {
      // Parse JSON strings back to objects
      if (typeof value === "string") {
        try {
          result[key] = JSON.parse(value);
        } catch {
          // If parsing fails, keep original value
          // This handles cases where the string is not valid JSON
          result[key] = value;
        }
      }
      // If already an object/array, keep as-is (database might have returned parsed data)
    } catch (error) {
      throw NextlyError.validation({
        errors: [
          {
            path: key,
            code: "TRANSFORM_FAILED",
            message: "Field transformation failed.",
          },
        ],
        logContext: {
          fieldName: key,
          fieldType: field.type,
          operation: "deserialize",
          cause: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return result;
}

/**
 * Get a list of field names that will be JSON serialized.
 * Useful for debugging and understanding what fields are transformed.
 *
 * @param fields - Field configurations
 * @returns Array of field names that will be JSON serialized
 */
export function getSerializedFieldNames(fields: FieldConfig[]): string[] {
  const fieldMap = buildFieldMap(fields);
  const serializedFields: string[] = [];

  for (const [name, field] of fieldMap) {
    if (isJSONSerializableType(field.type)) {
      serializedFields.push(name);
    }
  }

  return serializedFields;
}

/**
 * Check if a field type requires transformation.
 * Returns true for fields that need special handling (relationships, dates, complex types).
 *
 * @param fieldType - The field type to check
 * @returns Whether the field type requires transformation
 */
export function requiresTransformation(fieldType: string): boolean {
  return (
    isJSONSerializableType(fieldType) ||
    fieldType === "relationship" ||
    fieldType === "upload" ||
    fieldType === "date"
  );
}

// ============================================================
// Rich Text Transformation
// ============================================================

/**
 * Transform rich text fields in entry data to the requested output format.
 *
 * This function processes all rich text fields in the data and converts them
 * to the specified format (JSON, HTML, or both). It handles nested rich text
 * fields within arrays, groups, and blocks.
 *
 * @param data - Entry data containing rich text fields
 * @param fields - Field configurations for the collection/single
 * @param format - The desired output format for rich text fields
 * @returns Data with rich text fields transformed to the requested format
 *
 * @example
 * ```typescript
 * // Get rich text as HTML only
 * const result = transformRichTextFields(data, fields, "html");
 *
 * // Get rich text as both JSON and HTML
 * const result = transformRichTextFields(data, fields, "both");
 * // => { content: { json: {...}, html: "<p>...</p>" } }
 * ```
 */
export function transformRichTextFields(
  data: Record<string, unknown>,
  fields: FieldConfig[],
  format: RichTextOutputFormat = "json"
): Record<string, unknown> {
  // If format is JSON, no transformation needed (default behavior)
  if (format === "json") {
    return data;
  }

  const result: Record<string, unknown> = { ...data };
  const fieldMap = buildFieldMap(fields);

  for (const [key, value] of Object.entries(result)) {
    if (value === undefined || value === null) {
      continue;
    }

    const field = fieldMap.get(key);

    // Pass through unknown fields
    if (!field) {
      continue;
    }

    // Handle rich text fields
    if (field.type === "richText") {
      if (isRichTextValue(value)) {
        result[key] = formatRichTextOutput(value, format);
      }
      continue;
    }

    // Handle nested rich text in repeater fields
    if (field.type === "repeater") {
      const arrayField = field as { fields?: FieldConfig[] };
      if (Array.isArray(value) && arrayField.fields) {
        result[key] = value.map(item => {
          if (typeof item === "object" && item !== null) {
            return transformRichTextFields(
              item as Record<string, unknown>,
              arrayField.fields!,
              format
            );
          }
          return item;
        });
      }
      continue;
    }

    // Handle nested rich text in groups
    if (field.type === "group") {
      const groupField = field as { fields?: FieldConfig[] };
      if (typeof value === "object" && value !== null && groupField.fields) {
        result[key] = transformRichTextFields(
          value as Record<string, unknown>,
          groupField.fields,
          format
        );
      }
      continue;
    }
  }

  return result;
}
