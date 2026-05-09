/**
 * Input sanitization utilities for plain-text fields.
 *
 * Strips HTML tags from text/textarea/email field values before database
 * storage. Rich text (Lexical JSON), code, and JSON fields are NOT processed
 * here — they are handled at output time or are intentionally raw.
 */

import type { FieldDefinition } from "../../schemas/dynamic-collections";
import type { SanitizationConfigInput } from "../../schemas/security-config";

const TEXT_LIKE_FIELDS = new Set(["text", "string", "textarea", "email"]);

/**
 * Remove all HTML tags from a string, collapse whitespace, and trim.
 *
 * Uses a regex that matches both complete tags (`<b>`) and unclosed tags
 * at end-of-string (`<script`) to prevent browsers from interpreting
 * incomplete markup.
 *
 * @example
 * stripHtmlTags('Hello <b>world</b>')          // 'Hello world'
 * stripHtmlTags('<script>alert(1)</script>')    // ''
 * stripHtmlTags('hello <script')               // 'hello'
 * stripHtmlTags('hello <br/> world')           // 'hello world'
 * stripHtmlTags('&lt;script&gt;')              // '&lt;script&gt;' (already encoded — safe)
 */
export function stripHtmlTags(input: string): string {
  return input
    .replace(/<[^>]*(?:>|$)/g, "") // Remove HTML tags (including unclosed at end-of-string)
    .replace(/\s+/g, " ") // Collapse multiple whitespace into single space
    .trim();
}

/**
 * Sanitize a single field value based on its field type.
 *
 * Dispatches to the correct sanitization strategy:
 * - `text`, `string`, `textarea`, `email` → strip HTML tags
 * - `slug` → strip invalid characters, collapse hyphens, trim hyphens
 * - All other types → return unchanged
 *
 * Null-safe: `null` and `undefined` pass through unchanged.
 * Non-string values pass through unchanged (numbers, booleans, objects).
 *
 * @example
 * sanitizeFieldValue('<b>Hello</b>', 'text')       // 'Hello'
 * sanitizeFieldValue('my--SLUG!!', 'slug')          // 'my-slug'
 * sanitizeFieldValue(42, 'number')                  // 42
 * sanitizeFieldValue(null, 'text')                  // null
 */
export function sanitizeFieldValue(
  value: unknown,
  fieldType: string,
  config?: SanitizationConfigInput
): unknown {
  if (value == null || typeof value !== "string") return value;

  if (TEXT_LIKE_FIELDS.has(fieldType)) {
    if (config?.stripHtmlFromText === false) return value;
    return stripHtmlTags(value);
  }

  if (fieldType === "slug") {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  return value;
}

/**
 * Field types that are intentionally raw and should NOT be sanitized.
 * - `richText` / `richtext`: Lexical JSON — sanitized at HTML output time
 * - `json`: Arbitrary JSON — intentionally raw
 * - `code`: Source code — intentionally raw
 * - `password`: Hashed before storage — never displayed as HTML
 */
const SKIP_FIELD_TYPES = new Set([
  "richText",
  "richtext",
  "json",
  "code",
  "password",
]);

/**
 * Layout field types that are structural wrappers with no data key.
 * Their nested `fields` / `tabs` contain data fields that DO need processing.
 */
const LAYOUT_FIELD_TYPES = new Set(["tabs", "collapsible", "row"]);

/**
 * Sanitize all field values in an entry data object based on field definitions.
 *
 * Iterates over field definitions, looks up corresponding values in the data
 * object, and runs them through `sanitizeFieldValue()`. Handles nested fields
 * recursively:
 * - `group` fields: recurses into the group's sub-fields
 * - `array` fields: iterates each array item and recurses into the field's sub-fields
 * - `component` fields: recurses into the component's field definitions (if available)
 * - Layout types (`tabs`, `collapsible`, `row`): traverses into nested fields
 *
 * Skips `richText`, `json`, `code`, and `password` fields — they are handled
 * at output time or are intentionally raw.
 *
 * Mutates the data object in place for efficiency (same pattern as
 * `normalizeUploadFields()` in collection-entry-service).
 *
 * @param data - Entry data object to sanitize (mutated in place)
 * @param fields - Collection/single field definitions
 * @param config - Sanitization configuration (optional)
 *
 * @example
 * const data = { title: '<b>Hello</b>', body: 'Safe text', meta: { desc: '<script>xss</script>' } };
 * const fields = [
 *   { name: 'title', type: 'text' },
 *   { name: 'body', type: 'textarea' },
 *   { name: 'meta', type: 'group', fields: [{ name: 'desc', type: 'text' }] },
 * ];
 * sanitizeEntryData(data, fields);
 * // data.title === 'Hello'
 * // data.body === 'Safe text'
 * // data.meta.desc === ''
 */
export function sanitizeEntryData(
  data: Record<string, unknown>,
  fields: FieldDefinition[],
  config?: SanitizationConfigInput
): void {
  for (const field of fields) {
    if (LAYOUT_FIELD_TYPES.has(field.type)) {
      if (
        field.type === "tabs" &&
        "tabs" in field &&
        Array.isArray((field as { tabs?: unknown[] }).tabs)
      ) {
        for (const tab of (
          field as { tabs?: Array<{ fields?: FieldDefinition[] }> }
        ).tabs!) {
          if (Array.isArray(tab.fields)) {
            sanitizeEntryData(data, tab.fields, config);
          }
        }
      }
      if (field.fields && Array.isArray(field.fields)) {
        sanitizeEntryData(data, field.fields, config);
      }
      continue;
    }

    if (!field.name) continue;

    if (SKIP_FIELD_TYPES.has(field.type)) continue;

    const value = data[field.name];
    if (value === undefined) continue;

    if (field.type === "group" && field.fields && Array.isArray(field.fields)) {
      if (value != null && typeof value === "object" && !Array.isArray(value)) {
        sanitizeEntryData(
          value as Record<string, unknown>,
          field.fields,
          config
        );
      }
      continue;
    }

    if (
      field.type === "repeater" &&
      field.fields &&
      Array.isArray(field.fields)
    ) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (
            item != null &&
            typeof item === "object" &&
            !Array.isArray(item)
          ) {
            sanitizeEntryData(
              item as Record<string, unknown>,
              field.fields,
              config
            );
          }
        }
      }
      continue;
    }

    if (field.type === "component") {
      if (field.fields && Array.isArray(field.fields)) {
        const repeatable = (field as { repeatable?: boolean }).repeatable;
        if (repeatable && Array.isArray(value)) {
          for (const item of value) {
            if (
              item != null &&
              typeof item === "object" &&
              !Array.isArray(item)
            ) {
              sanitizeEntryData(
                item as Record<string, unknown>,
                field.fields,
                config
              );
            }
          }
        } else if (
          value != null &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          sanitizeEntryData(
            value as Record<string, unknown>,
            field.fields,
            config
          );
        }
      }
      continue;
    }

    data[field.name] = sanitizeFieldValue(value, field.type, config);
  }
}
