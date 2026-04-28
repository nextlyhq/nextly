/**
 * Single Utilities
 *
 * Pure helper functions extracted from the monolithic SingleEntryService.
 * These functions handle field type detection, default value generation,
 * JSON serialization, media ID normalization, and recursive media expansion
 * for nested fields (group, repeater, blocks).
 *
 * All functions in this module are pure — they accept their dependencies
 * as arguments and perform no direct side effects. This allows them to be
 * shared between SingleQueryService and SingleMutationService without
 * introducing coupling between the services.
 *
 * @module domains/singles/services/single-utils
 * @since 1.0.0
 */

import type { FieldConfig } from "../../../collections/fields/types";
// PR 4 migration: keep ServiceError import for now because the legacy result-shape
// callers (single-mutation-service / single-query-service — out of scope for PR 4)
// still throw ServiceError values. Once those migrate, this fallback path drops.
// The new path recognises NextlyError directly so callers that have migrated
// (e.g. component-mutation-service throwing NextlyError downstream) flow through
// cleanly with the right statusCode/code preserved.
import { NextlyError, ServiceError } from "../../../errors";
import type { Logger } from "../../../shared/types";
import type { SingleDocument, SingleResult } from "../types";

// ============================================================
// Field Type Helpers
// ============================================================

/**
 * Valid empty Lexical editor document.
 *
 * The Lexical editor crashes with `{}` or `""` — it requires a root node
 * with at least one paragraph child.
 */
export const EMPTY_LEXICAL_DOCUMENT: string = JSON.stringify({
  root: {
    type: "root",
    format: "",
    indent: 0,
    version: 1,
    children: [
      {
        type: "paragraph",
        format: "",
        indent: 0,
        version: 1,
        children: [],
        direction: null,
        textFormat: 0,
      },
    ],
    direction: null,
  },
});

/**
 * Check if a field should be treated as a JSON field.
 *
 * Mirrors the logic in SchemaGenerator to ensure consistent handling.
 */
export function shouldTreatAsJson(field: FieldConfig): boolean {
  if (
    [
      "json",
      "repeater",
      "blocks",
      "group",
      "tabs",
      "collapsible",
      "point",
      "richText",
      "chips",
    ].includes(field.type)
  ) {
    return true;
  }

  // Select, text, and number fields are JSON if they have multiple values
  if (
    (field.type === "select" ||
      field.type === "text" ||
      field.type === "number") &&
    "hasMany" in field &&
    field.hasMany
  ) {
    return true;
  }

  // Relationship fields are JSON if they have multiple values or are polymorphic
  if (field.type === "relationship") {
    const hasMany = "hasMany" in field && field.hasMany;
    const relationTo = "relationTo" in field ? field.relationTo : undefined;
    const isPolymorphic = Array.isArray(relationTo);
    return Boolean(hasMany) || isPolymorphic;
  }

  // Upload fields are JSON if they have multiple values or are polymorphic
  if (field.type === "upload") {
    const hasMany = "hasMany" in field && field.hasMany;
    const relationTo = "relationTo" in field ? field.relationTo : undefined;
    const isPolymorphic = Array.isArray(relationTo);
    return Boolean(hasMany) || isPolymorphic;
  }

  return false;
}

/**
 * Get a type-appropriate default value for a field type.
 * Used when a required field has no explicit defaultValue.
 */
export function getDefaultValue(field: FieldConfig): unknown {
  if (field.type === "richText") {
    return EMPTY_LEXICAL_DOCUMENT;
  }

  if (shouldTreatAsJson(field)) {
    if (field.type === "repeater" || ("hasMany" in field && field.hasMany)) {
      return "[]";
    }
    return "{}";
  }

  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "code":
      return "";

    case "number":
      return 0;

    case "checkbox":
      return false;

    case "json":
      return "{}";
    case "repeater":
      return "[]";
    case "group":
      return "{}";

    case "select":
      return "";

    case "date":
      return null;

    case "relationship":
      return null;

    default:
      return "";
  }
}

// ============================================================
// Nested Field Structure Helpers
// ============================================================

/** Check if a field is an upload field. */
export function isUploadField(field: FieldConfig): boolean {
  return field.type === "upload";
}

/** Check if a field is a repeater field (array of nested rows). */
export function isArrayField(field: FieldConfig): boolean {
  return field.type === "repeater";
}

/** Check if a field is a group field (container with nested fields). */
export function isGroupField(field: FieldConfig): boolean {
  return field.type === "group";
}

/**
 * Gets nested fields from an array or group field.
 */
export function getNestedFields(field: FieldConfig): FieldConfig[] {
  const candidate = field as { fields?: unknown };
  if (Array.isArray(candidate.fields)) {
    return candidate.fields as FieldConfig[];
  }
  return [];
}

/**
 * Safely parses JSON data if it's a string, otherwise returns as-is.
 * Handles cases where array/group field data hasn't been deserialized yet.
 */
export function parseJsonIfString(data: unknown): unknown {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

// ============================================================
// Upload/Media ID Normalization
// ============================================================

/**
 * Extract an ID string from an unknown value that may be a string,
 * an object with `value` or `id`, or something else.
 */
function extractIdFromItem(item: unknown): string {
  if (typeof item === "string") return item;
  if (typeof item === "object" && item !== null) {
    const obj = item as { value?: unknown; id?: unknown };
    if (typeof obj.value === "string") return obj.value;
    if (typeof obj.id === "string") return obj.id;
    // Object branch: avoid `[object Object]` from default toString. JSON.stringify
    // gives a deterministic representation and satisfies no-base-to-string.
    try {
      return JSON.stringify(item);
    } catch {
      return "[unstringifiable]";
    }
  }
  return String(item);
}

/**
 * Normalizes a field value to an array of IDs.
 * Handles various formats: single ID, array, PostgreSQL array string, JSON array string.
 */
export function normalizeToIdArray(value: unknown): string[] {
  if (value == null) return [];

  // Already an array
  if (Array.isArray(value)) {
    return value.map(extractIdFromItem);
  }

  // PostgreSQL array string format: {uuid1,uuid2}
  if (
    typeof value === "string" &&
    value.startsWith("{") &&
    value.endsWith("}")
  ) {
    const inner = value.slice(1, -1);
    if (inner === "") return [];
    const items: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < inner.length; i++) {
      const char = inner[i];
      if (char === '"' && (i === 0 || inner[i - 1] !== "\\")) {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        items.push(current.replace(/^"|"$/g, ""));
        current = "";
      } else {
        current += char;
      }
    }
    if (current) {
      items.push(current.replace(/^"|"$/g, ""));
    }
    return items;
  }

  // JSON array string
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const jsonParsed: unknown = JSON.parse(value);
      if (Array.isArray(jsonParsed)) {
        return jsonParsed.map(extractIdFromItem);
      }
    } catch {
      // Not valid JSON, fall through to single string handling
    }
  }

  // Single string ID
  if (typeof value === "string") {
    return [value];
  }

  // Object with id or value
  if (typeof value === "object" && value !== null) {
    const obj = value as { value?: unknown; id?: unknown };
    const id = typeof obj.value === "string" ? obj.value : obj.id;
    if (typeof id === "string" && id) return [id];
  }

  return [];
}

/**
 * Recursively collects all media IDs from a data object based on field definitions.
 * Handles nested upload fields inside array (repeater) and group fields.
 */
export function collectAllMediaIds(
  data: unknown,
  fields: FieldConfig[]
): string[] {
  if (!data || typeof data !== "object") return [];

  const record = data as Record<string, unknown>;
  const mediaIds: string[] = [];

  for (const field of fields) {
    if (!("name" in field) || !field.name) continue;

    const fieldName = field.name;
    if (record[fieldName] === undefined || record[fieldName] === null) continue;

    if (isUploadField(field)) {
      const ids = normalizeToIdArray(record[fieldName]);
      mediaIds.push(...ids);
    } else if (isArrayField(field)) {
      const nestedFields = getNestedFields(field);
      const arrayData = parseJsonIfString(record[fieldName]);
      if (Array.isArray(arrayData)) {
        for (const row of arrayData) {
          if (row && typeof row === "object") {
            const nestedIds = collectAllMediaIds(row, nestedFields);
            mediaIds.push(...nestedIds);
          }
        }
      }
    } else if (isGroupField(field)) {
      const nestedFields = getNestedFields(field);
      const groupData = parseJsonIfString(record[fieldName]);
      if (
        groupData &&
        typeof groupData === "object" &&
        !Array.isArray(groupData)
      ) {
        const nestedIds = collectAllMediaIds(groupData, nestedFields);
        mediaIds.push(...nestedIds);
      }
    }
  }

  return mediaIds;
}

/**
 * Recursively expands media IDs in a data object using the provided media lookup map.
 * Handles nested upload fields inside array (repeater) and group fields.
 */
export function expandMediaInData(
  data: unknown,
  fields: FieldConfig[],
  mediaMap: Map<string, Record<string, unknown>>
): unknown {
  if (!data || typeof data !== "object") return data;

  const source = data as Record<string, unknown>;
  const result: Record<string, unknown> = Array.isArray(data)
    ? ([...(data as unknown[])] as unknown as Record<string, unknown>)
    : { ...source };

  for (const field of fields) {
    if (!("name" in field) || !field.name) continue;

    const fieldName = field.name;
    if (result[fieldName] === undefined) continue;

    if (isUploadField(field)) {
      const value = result[fieldName];
      if (value === null || value === undefined) continue;

      const hasMany = "hasMany" in field && field.hasMany === true;
      const ids = normalizeToIdArray(value);

      if (ids.length === 0) {
        result[fieldName] = hasMany ? [] : null;
      } else if (hasMany) {
        result[fieldName] = ids
          .map(id => mediaMap.get(String(id)))
          .filter((m): m is Record<string, unknown> => Boolean(m));
      } else {
        result[fieldName] = mediaMap.get(String(ids[0])) ?? null;
      }
    } else if (isArrayField(field)) {
      const nestedFields = getNestedFields(field);
      const arrayData = parseJsonIfString(result[fieldName]);
      if (Array.isArray(arrayData)) {
        result[fieldName] = arrayData.map(row => {
          if (row && typeof row === "object") {
            return expandMediaInData(row, nestedFields, mediaMap);
          }
          return row;
        });
      }
    } else if (isGroupField(field)) {
      const nestedFields = getNestedFields(field);
      const groupData = parseJsonIfString(result[fieldName]);
      if (
        groupData &&
        typeof groupData === "object" &&
        !Array.isArray(groupData)
      ) {
        result[fieldName] = expandMediaInData(
          groupData,
          nestedFields,
          mediaMap
        );
      }
    }
  }

  return result;
}

// ============================================================
// JSON Serialization
// ============================================================

/**
 * Deserialize JSON fields from database format to in-memory objects.
 *
 * Also normalizes snake_case timestamp columns (`created_at`, `updated_at`)
 * into their camelCase equivalents using the provided normalizer.
 */
export function deserializeJsonFields(
  doc: SingleDocument,
  fields: FieldConfig[],
  logger: Logger,
  normalizeTimestamp: (value: unknown) => string | null
): SingleDocument {
  const result = { ...doc } as Record<string, unknown>;

  for (const field of fields) {
    if (!("name" in field) || !field.name) continue;

    if (shouldTreatAsJson(field) && result[field.name] != null) {
      const value = result[field.name];
      if (typeof value === "string") {
        try {
          result[field.name] = JSON.parse(value);
        } catch {
          logger.warn("Failed to parse JSON field", {
            field: field.name,
          });
        }
      }
    }
  }

  // Handle timestamp fields (snake_case from DB to camelCase)
  if (result.created_at !== undefined) {
    result.createdAt = normalizeTimestamp(result.created_at);
    delete result.created_at;
  }
  if (result.updated_at !== undefined) {
    result.updatedAt = normalizeTimestamp(result.updated_at);
    delete result.updated_at;
  }

  return result as SingleDocument;
}

/**
 * Serialize JSON fields for database storage (stringify objects).
 */
export function serializeJsonFields(
  data: Record<string, unknown>,
  fields: FieldConfig[]
): Record<string, unknown> {
  const result = { ...data };

  for (const field of fields) {
    if (!("name" in field) || !field.name) continue;

    if (shouldTreatAsJson(field) && result[field.name] != null) {
      const value = result[field.name];
      if (typeof value === "object") {
        result[field.name] = JSON.stringify(value);
      }
    }
  }

  return result;
}

/**
 * Normalize upload field values on update input. The admin form receives
 * expanded media objects like `{ id, url, filename, mimeType, ... }` from
 * the read API (depth > 0) and sends them back on update. Without this
 * normalization the object reaches the DB layer and causes errors.
 *
 * Mutates `data` in place, replacing expanded objects with their id strings.
 */
export function normalizeUploadFields(
  data: Record<string, unknown>,
  fields: FieldConfig[]
): void {
  for (const field of fields) {
    if (field.type !== "upload") continue;
    if (!("name" in field) || !field.name) continue;

    const val = data[field.name];
    if (val == null) continue;

    if (typeof val === "object" && !Array.isArray(val)) {
      const obj = val as { id?: unknown };
      data[field.name] = typeof obj.id === "string" ? obj.id : null;
    } else if (Array.isArray(val)) {
      data[field.name] = val.map((item: unknown) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          const obj = item as { id?: unknown };
          return typeof obj.id === "string" ? obj.id : item;
        }
        return item;
      });
    }
  }
}

// ============================================================
// Error Handling
// ============================================================

/**
 * Build a failure SingleResult from an arbitrary error.
 *
 * Recognises both NextlyError (current throw type) and ServiceError (legacy
 * shim type) — both expose `statusCode` and `publicMessage`. Falls back to
 * the generic shape for non-Nextly errors so unknown failures don't leak
 * driver text onto the wire.
 *
 * Used only by the legacy result-shape callers (single-mutation-service,
 * single-query-service). Once those migrate to throw-based handlers,
 * buildSingleErrorResult and the SingleResult error branch can be deleted.
 */
export function buildSingleErrorResult(
  error: unknown,
  defaultMessage: string
): SingleResult {
  // NextlyError — the new canonical error class. Use publicMessage so the
  // wire never sees logMessage / cause / stack.
  if (NextlyError.is(error)) {
    return {
      success: false,
      statusCode: error.statusCode,
      message: error.publicMessage,
    };
  }

  // ServiceError — legacy shim. Drops any free-form `details` payload onto
  // `errors` for backward compatibility with existing assertions.
  if (error instanceof ServiceError) {
    return {
      success: false,
      statusCode: error.httpStatus,
      message: error.message,
      // `error.details` is `unknown` (free-form payload). Strings pass through;
      // objects get JSON-stringified to avoid `[object Object]` (no-base-to-string).
      errors: error.details
        ? [
            {
              message:
                typeof error.details === "string"
                  ? error.details
                  : JSON.stringify(error.details),
            },
          ]
        : undefined,
    };
  }

  if (error instanceof Error) {
    return {
      success: false,
      statusCode: 500,
      message: error.message || defaultMessage,
    };
  }

  return {
    success: false,
    statusCode: 500,
    message: defaultMessage,
  };
}
