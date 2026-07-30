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

import type { DocumentKind } from "@nextlyhq/blocks-engine";

import { emptyBlockDocumentJson } from "../../../collections/fields/blocks-document";
import type { FieldConfig } from "../../../collections/fields/types";
import { validateBlocksValue } from "../../../collections/fields/validators/blocks-validator";
import { NextlyError } from "../../../errors";
import { convertTimestampsToCamelCase } from "../../../shared/lib/case-conversion";
import { toJsonColumnValue } from "../../../shared/lib/json-column-value";
import { storageTypeToken } from "../../../shared/lib/plugin-storage";
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
 * Mirrors the logic in RuntimeSchemaGenerator to ensure consistent handling.
 */
export function shouldTreatAsJson(field: FieldConfig): boolean {
  // Classified by what a plugin type stores rather than by its own token,
  // which names none of these: a json-backed field would otherwise reach its
  // JSON column as a live object. No storage primitive is `select`,
  // `relationship` or `upload`, so the branches below read the declared type.
  if (
    ["json", "repeater", "group", "richText", "chips", "blocks"].includes(
      storageTypeToken(field) ?? field.type
    )
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

/** The subset of a blocks field's policy the value validator reads. */
type BlocksPolicy = { allow?: string[]; kinds?: DocumentKind[] };

/**
 * Rejects a blocks default the field's own policy would not accept.
 *
 * A single is auto-created on first read by inserting its defaults directly,
 * so this value never passes through the write path that validates ordinary
 * writes. A static default is already caught when the config loads, but a
 * function default produces its value only when resolved against real data,
 * which first happens here. Left unchecked it would be persisted, and the
 * admin's blocks control is read-only, so the row could not then be repaired
 * from the UI.
 */
export function assertValidBlocksDefault(
  field: FieldConfig,
  value: unknown,
  singleSlug: string
): void {
  if (field.type !== "blocks") return;
  // `validateBlocksValue` treats an absent value as an empty field and leaves
  // requiredness to the shared rules, which this path never reaches: the row
  // is inserted straight from these defaults. A required column would take the
  // null and fail at the database, reporting a constraint rather than the
  // configuration that caused it.
  if (value === null || value === undefined) {
    if (!("required" in field && field.required)) return;
    throw NextlyError.validation({
      errors: [
        {
          path: field.name,
          code: "REQUIRED",
          message: `${field.name} is required, but its default produced no document.`,
        },
      ],
      logContext: { single: singleSlug, field: field.name, reason: "default" },
    });
  }
  const policy = (field as { blocks?: BlocksPolicy }).blocks ?? {};
  const issues = validateBlocksValue(value, field.name, field.name, policy);
  if (issues.length === 0) return;
  // The engine's own issue codes are carried through unchanged, so one defect
  // keeps one name wherever it surfaces.
  throw NextlyError.validation({
    errors: issues,
    logContext: { single: singleSlug, field: field.name, reason: "default" },
  });
}

/**
 * Reject a `defaultValue` declared on a password field.
 *
 * A single's defaults are inserted straight onto the auto-created row, bypassing
 * the write path that runs `hashPasswordFieldValues`. A resolved password
 * default would therefore be persisted in PLAINTEXT, so it is refused here
 * rather than silently stored. (A fixed/seeded default password is itself a
 * security anti-pattern; a password must be set explicitly through the write
 * path so it is hashed.) Checked on the same direct-insert path as
 * {@link assertValidBlocksDefault}.
 */
export function assertNoPasswordDefault(
  field: { name?: string; type?: string },
  singleSlug: string
): void {
  if (field.type !== "password") return;
  throw NextlyError.validation({
    errors: [
      {
        path: field.name ?? "",
        code: "PASSWORD_DEFAULT_UNSUPPORTED",
        message: `A password field cannot declare a defaultValue; set "${field.name ?? "password"}" explicitly so it is hashed.`,
      },
    ],
    logContext: {
      single: singleSlug,
      field: field.name,
      reason: "password-default",
    },
  });
}

/**
 * Get a type-appropriate default value for a field type.
 * Used when a required field has no explicit defaultValue.
 */
export function getDefaultValue(field: FieldConfig): unknown {
  if (field.type === "richText") {
    return EMPTY_LEXICAL_DOCUMENT;
  }

  if (field.type === "blocks") {
    // The kind is read from the field's own policy: seeding a page document
    // into a field that only accepts templates would violate its own rule.
    const kinds = (field as { blocks?: { kinds?: DocumentKind[] } }).blocks
      ?.kinds;
    return emptyBlockDocumentJson(kinds);
  }

  if (shouldTreatAsJson(field)) {
    if (field.type === "repeater" || ("hasMany" in field && field.hasMany)) {
      return "[]";
    }
    return "{}";
  }

  // Seeded by what the column holds, as the JSON predicate above already is: a
  // plugin type names none of the cases below, so it would fall through to the
  // text default and put `""` into a numeric or boolean column, or a value
  // `new Date()` cannot read.
  switch (storageTypeToken(field) ?? field.type) {
    case "text":
    case "textarea":
    case "email":
    case "password":
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
    case "chips":
      return "[]";
    case "group":
      return "{}";

    case "select":
    case "radio":
      return "";

    case "date":
      // A required field's column is NOT NULL — `getColumnDescriptor` derives
      // that from `required` — so seeding null there fails the insert and the
      // single is never auto-created on first read. The other required
      // primitives seed an empty value of their own kind; for a timestamp the
      // only bindable one is a real date.
      return "required" in field && field.required ? new Date() : null;

    case "relationship":
    case "upload":
    case "component":
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

/** Check if a field is a repeater field (repeating rows of nested fields). */
export function isRepeaterField(field: FieldConfig): boolean {
  return field.type === "repeater";
}

/** Check if a field is a group field (container with nested fields). */
export function isGroupField(field: FieldConfig): boolean {
  return field.type === "group";
}

/**
 * Gets nested fields from a repeater or group field.
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
 * Handles cases where repeater/group field data hasn't been deserialized yet.
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
 * Handles nested upload fields inside repeater and group fields.
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
    } else if (isRepeaterField(field)) {
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
 * Handles nested upload fields inside repeater and group fields.
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
    } else if (isRepeaterField(field)) {
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

  convertTimestampsToCamelCase(result, { normalize: normalizeTimestamp });

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
      result[field.name] = toJsonColumnValue(result[field.name]);
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
 * Recognises NextlyError (canonical throw type) — exposes `statusCode` and
 * `publicMessage`. Falls back to the generic shape for non-NextlyError errors
 * so unknown failures don't leak driver text onto the wire.
 *
 * Used only by the legacy result-shape callers (single-mutation-service,
 * single-query-service). Once those migrate to throw-based handlers,
 * buildSingleErrorResult and the SingleResult error branch can be deleted.
 */
export function buildSingleErrorResult(
  error: unknown,
  defaultMessage: string
): SingleResult {
  // NextlyError — the canonical error class. Use publicMessage so the wire
  // never sees logMessage / cause / stack.
  if (NextlyError.is(error)) {
    // Per-field validation issues ride the result so the wire envelope can
    // carry field paths (the SingleResult errors shape predates the
    // canonical one; map path → field for its consumers).
    const validationErrors =
      error.code === "VALIDATION_ERROR"
        ? (
            error.publicData as
              | { errors?: Array<{ path: string; message: string }> }
              | undefined
          )?.errors
        : undefined;
    return {
      success: false,
      statusCode: error.statusCode,
      message: error.publicMessage,
      ...(validationErrors
        ? {
            errors: validationErrors.map(e => ({
              field: e.path,
              message: e.message,
            })),
          }
        : {}),
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
