/**
 * Input sanitization utilities for plain-text fields.
 *
 * Strips HTML tags from text/textarea/email field values before database
 * storage. Rich text (Lexical JSON), code, and JSON fields are NOT processed
 * here — they are handled at output time or are intentionally raw.
 */

import { typeHasNestedFields } from "../../collections/fields/guards";
import {
  extractFieldGroupReferences,
  isFieldGroupType,
} from "../../domains/field-groups/storage/field-group-field-type";
import { readFieldGroupType } from "../../domains/field-groups/storage/field-group-type-key";
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
 * Sanitize all field values in an entry data object based on field definitions.
 *
 * Iterates over field definitions, looks up corresponding values in the data
 * object, and runs them through `sanitizeFieldValue()`. Handles nested fields
 * recursively:
 * - `group` fields: recurses into the group's sub-fields
 * - `repeater` fields: iterates each row and recurses into the field's sub-fields
 * - `component` fields: recurses into the component's field definitions (if available)
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
    if (!field.name) continue;

    if (SKIP_FIELD_TYPES.has(field.type)) continue;

    const value = data[field.name];
    if (value === undefined) continue;

    // group and repeater carry their child definitions inline on the field.
    if (field.type === "group" || field.type === "repeater") {
      sanitizeInstances(value, field.fields, config);
      continue;
    }

    // A field group's values are nested documents carrying the group's own
    // fields, so the descent must follow either type spelling — skipping the
    // migrated one would leave its text values unsanitized.
    if (isFieldGroupType(field.type)) {
      sanitizeFieldGroupValue(value, field, config);
      continue;
    }

    data[field.name] = sanitizeFieldValue(value, field.type, config);
  }
}

/**
 * Sanitize every object instance `value` holds against one child schema.
 *
 * A group holds a single object and a repeater a list of rows; both arrive
 * here as the same "walk the instances" question, so the two containers
 * cannot drift about what counts as an instance.
 */
function sanitizeInstances(
  value: unknown,
  childFields: FieldDefinition[] | undefined,
  config?: SanitizationConfigInput
): void {
  if (!Array.isArray(childFields) || childFields.length === 0) return;
  const rows = Array.isArray(value) ? value : [value];
  for (const row of rows) {
    if (row !== null && typeof row === "object" && !Array.isArray(row)) {
      sanitizeEntryData(row as Record<string, unknown>, childFields, config);
    }
  }
}

/** The per-slug schema map enrichment attaches to a zone field. */
type FieldGroupSchemaMap = Record<string, { fields?: FieldDefinition[] }>;

/** The schema one zone instance resolves to, by its own type discriminator. */
function zoneSchemaFields(
  schemas: FieldGroupSchemaMap | undefined,
  instance: Record<string, unknown>
): FieldDefinition[] {
  // Truthy check, not `!== undefined`: the map is read off a stored
  // definition, so a JSON round trip can deliver `null`, and `typeof null`
  // is "object" — indexing it would throw inside the entry-write path.
  if (!schemas || typeof schemas !== "object") return [];
  // Read through the reader that tries both spellings of the wire key: the
  // migration renames that key inside stored rows, and an unreadable type
  // would skip its children entirely.
  const type = readFieldGroupType(instance);
  if (type === undefined) return [];
  const schema = schemas[type];
  return schema && Array.isArray(schema.fields) ? schema.fields : [];
}

/**
 * The child definitions one field-group instance is judged against, from
 * whichever source carries them.
 *
 * Stored definitions hold no children of their own — a field group is a leaf
 * reference by slug — so the shapes that matter are the inline `fields` of a
 * hand-written nested definition, the `componentFields` enrichment attaches
 * for a single reference, and the `componentSchemas` map enrichment attaches
 * for a zone, resolved per instance.
 */
function fieldGroupChildFields(
  field: FieldDefinition,
  instance: Record<string, unknown>
): FieldDefinition[] {
  if (Array.isArray(field.fields) && field.fields.length > 0) {
    return field.fields;
  }
  const single = (field as { componentFields?: FieldDefinition[] })
    .componentFields;
  if (Array.isArray(single) && single.length > 0) {
    return single;
  }
  return zoneSchemaFields(
    (field as { componentSchemas?: FieldGroupSchemaMap }).componentSchemas,
    instance
  );
}

/**
 * Descend into one field-group value's instances with their resolved schemas.
 *
 * A repeatable field — and a zone read back from its own table — holds an
 * array of instances; a single one holds the instance object itself. Each
 * instance is sanitized against ITS schema, which is why the array is walked
 * before the lookup rather than after: a zone's instances differ in type.
 */
function sanitizeFieldGroupValue(
  value: unknown,
  field: FieldDefinition,
  config?: SanitizationConfigInput
): void {
  const rows = Array.isArray(value) ? value : [value];
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const record = row as Record<string, unknown>;
    const children = fieldGroupChildFields(field, record);
    if (children.length > 0) {
      sanitizeEntryData(record, children, config);
    }
  }
}

/** How deep the enrichment walk follows container fields. Matches the editor's nesting limit. */
const MAX_FIELD_GROUP_RESOLVE_DEPTH = 3;

/**
 * Attach one field-group field's referenced children, single reference or zone.
 *
 * Each resolved child schema recurses through the same attachment, so a field
 * group whose registered fields reference another field group is enriched at
 * every depth the editor allows — the descent reaches B's text only when B's
 * own children were attached.
 */
async function attachFieldGroupReferences(
  field: FieldDefinition,
  resolveChildren: (slug: string) => Promise<FieldDefinition[] | undefined>,
  depth: number
): Promise<void> {
  const { single, many } = extractFieldGroupReferences(field);
  if (single !== undefined) {
    const children = await resolveChildren(single);
    if (children !== undefined) {
      await attachFieldGroupChildren(children, resolveChildren, depth + 1);
      (field as { componentFields?: FieldDefinition[] }).componentFields =
        children;
    }
    return;
  }
  if (many === undefined) return;
  const schemas: FieldGroupSchemaMap = {};
  for (const slug of many) {
    const children = await resolveChildren(slug);
    if (children !== undefined) {
      await attachFieldGroupChildren(children, resolveChildren, depth + 1);
      schemas[slug] = { fields: children };
    }
  }
  if (Object.keys(schemas).length > 0) {
    (field as { componentSchemas?: FieldGroupSchemaMap }).componentSchemas =
      schemas;
  }
}

/**
 * Attach every field-group field's referenced child definitions, so
 * {@link sanitizeEntryData}'s descent can reach the group's nested values.
 *
 * The lookup is injected because the caller owns the executor: the sanitization
 * hook runs inside entry-write transactions and must resolve on that same
 * connection, where a pooled read would wait for a connection the transaction
 * is holding. Resolved single references land on `componentFields` and zones
 * on `componentSchemas` — the same shapes the read path's enrichment produces,
 * so the descent reads one vocabulary.
 *
 * Resolved children recurse through the same walk — containers (repeater/group)
 * so their nested field-group references resolve, and resolved field-group
 * schemas so a group nested inside a group enriches too — bounded by the depth
 * the editor allows, which also terminates a registry cycle.
 */
export async function attachFieldGroupChildren(
  fields: FieldDefinition[],
  resolveChildren: (slug: string) => Promise<FieldDefinition[] | undefined>,
  depth = 0
): Promise<FieldDefinition[]> {
  if (depth > MAX_FIELD_GROUP_RESOLVE_DEPTH) return fields;

  for (const field of fields) {
    if (isFieldGroupType(field.type)) {
      await attachFieldGroupReferences(field, resolveChildren, depth);
      continue;
    }
    if (
      typeHasNestedFields(field.type) &&
      Array.isArray(field.fields) &&
      field.fields.length > 0
    ) {
      await attachFieldGroupChildren(field.fields, resolveChildren, depth + 1);
    }
  }
  return fields;
}
