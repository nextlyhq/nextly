/**
 * Input sanitization utilities for plain-text fields.
 *
 * Strips HTML tags from text/textarea/email field values before database
 * storage. Rich text (Lexical JSON), code, and JSON fields are NOT processed
 * here — they are handled at output time or are intentionally raw.
 */

// The shared vocabulary readers keep the nested-document descent identical
// across both stored field-group spellings: which fields are field groups,
// what a definition references, and the wire key a zone row announces under.
import { typeHasNestedFields } from "../../collections/fields/guards";
import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "../../domains/field-groups/storage/field-group-field-type";
import { readFieldGroupType } from "../../domains/field-groups/storage/field-group-type-key";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import type { SanitizationConfigInput } from "../../schemas/security-config";

const TEXT_LIKE_FIELDS = new Set(["text", "string", "textarea", "email"]);

/** Whether this character would make the `<` before it open a tag. */
function opensTag(character: string | undefined): boolean {
  if (character === undefined) return false;
  return (
    character === "/" ||
    character === "!" ||
    character === "?" ||
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z")
  );
}

/**
 * Remove HTML tags from a string, collapse whitespace, and trim.
 *
 * A `<` opens a tag only when what follows it could name one: an ASCII letter,
 * `/` for a closing tag, or `!` and `?` for comments and doctypes. That is the
 * HTML tokenizer's own rule, so what survives is what a browser would have
 * shown as text anyway.
 *
 * Treating every `<` as the start of a tag deleted ordinary writing. This runs
 * on every text, string, textarea and email field of every collection, and on
 * media alt text, captions and tags, so `price < 100` was stored as `price` and
 * `2 < 3 and 5 > 4` as `2 4`. An author lost the rest of a sentence on save
 * with nothing to say why.
 *
 * One pass, holding one invariant: a `<` that has been kept is never followed
 * by a character that would open a tag. Removing a tag can put its neighbours
 * together into a new one, so `<<b>img src=x onerror=alert(1)>` would otherwise
 * come back as live markup the sanitizer assembled itself, and a kept `<` is
 * dropped the moment the next character would make it dangerous. Rescanning
 * until the text stopped changing holds the same invariant and is quadratic:
 * `"<".repeat(n) + "b>" + "x>".repeat(n)` exposes one tag per pass. Each
 * character here is examined once and dropped at most once.
 *
 * @example
 * stripHtmlTags('Hello <b>world</b>')          // 'Hello world'
 * stripHtmlTags('<script>alert(1)</script>')   // 'alert(1)'
 * stripHtmlTags('hello <script')               // 'hello'
 * stripHtmlTags('hello <br/> world')           // 'hello world'
 * stripHtmlTags('price < 100')                 // 'price < 100'
 * stripHtmlTags('&lt;script&gt;')              // '&lt;script&gt;' (already encoded)
 */
export function stripHtmlTags(input: string): string {
  const kept: string[] = [];
  for (let at = 0; at < input.length; at += 1) {
    const character = input[at];
    if (character === "<" && opensTag(input[at + 1])) {
      const close = input.indexOf(">", at + 1);
      at = close === -1 ? input.length : close;
      continue;
    }
    while (
      kept.length > 0 &&
      kept[kept.length - 1] === "<" &&
      opensTag(character)
    ) {
      kept.pop();
    }
    kept.push(character);
  }
  return kept.join("").replace(/\s+/g, " ").trim();
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
    if (isFieldGroupFieldType(field.type)) {
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

/**
 * Attach every field-group field's referenced child definitions, so
 * {@link sanitizeEntryData}'s descent can reach the group's nested values at
 * any depth.
 *
 * The lookup is injected because the caller owns the executor: the sanitization
 * hook runs inside entry-write transactions and must resolve on that same
 * connection, where a pooled read would wait for a connection the transaction
 * is holding. Resolved single references land on `componentFields` and zones
 * on `componentSchemas` — the same shapes the read path's enrichment produces,
 * so the descent reads one vocabulary.
 *
 * The result is a COPY: the fields given, and the definitions `resolveChildren`
 * returns, are never changed, since a resolver may hand back definitions other
 * readers share. Each field group's children are enriched once per call and
 * every reference to it attaches that one copy, so field groups nest to any
 * depth, and a definition that places a field group inside itself (one saved
 * before such a cycle was refused) yields a schema that refers back to itself
 * rather than a walk that never ends. The descent stays finite either way,
 * because it follows the VALUES, and a value holds only so many levels. Every
 * level a value holds is therefore reached, and its text sanitized. A container
 * is copied once too, so one that holds itself is copied as a loop.
 */
export async function attachFieldGroupChildren(
  fields: FieldDefinition[],
  resolveChildren: (slug: string) => Promise<FieldDefinition[] | undefined>
): Promise<FieldDefinition[]> {
  const fieldGroups = new Map<string, FieldDefinition[] | undefined>();
  const containers = new Map<object, FieldDefinition>();

  const childrenOf = async (
    slug: string
  ): Promise<FieldDefinition[] | undefined> => {
    if (fieldGroups.has(slug)) return fieldGroups.get(slug);
    const raw = await resolveChildren(slug);
    if (raw === undefined) {
      fieldGroups.set(slug, undefined);
      return undefined;
    }
    // Registered before it is filled, so a reference back to this field group
    // from inside its own children attaches this same list.
    const copy: FieldDefinition[] = [];
    fieldGroups.set(slug, copy);
    for (const child of await copyList(raw)) copy.push(child);
    return copy;
  };

  const copyField = async (
    field: FieldDefinition
  ): Promise<FieldDefinition> => {
    if (isFieldGroupFieldType(field.type)) {
      const copy: FieldDefinition = { ...field };
      const { single, many } = extractFieldGroupReferences(field);
      if (single !== undefined) {
        const children = await childrenOf(single);
        if (children !== undefined) {
          (copy as { componentFields?: FieldDefinition[] }).componentFields =
            children;
        }
        return copy;
      }
      if (many === undefined) return copy;
      const schemas: FieldGroupSchemaMap = {};
      for (const slug of many) {
        const children = await childrenOf(slug);
        if (children !== undefined) schemas[slug] = { fields: children };
      }
      if (Object.keys(schemas).length > 0) {
        (copy as { componentSchemas?: FieldGroupSchemaMap }).componentSchemas =
          schemas;
      }
      return copy;
    }
    if (
      typeHasNestedFields(field.type) &&
      Array.isArray(field.fields) &&
      field.fields.length > 0
    ) {
      const seen = containers.get(field);
      if (seen !== undefined) return seen;
      const copy: FieldDefinition = { ...field, fields: [] };
      containers.set(field, copy);
      for (const child of await copyList(field.fields)) {
        (copy.fields as FieldDefinition[]).push(child);
      }
      return copy;
    }
    return field;
  };

  const copyList = async (
    list: readonly FieldDefinition[]
  ): Promise<FieldDefinition[]> => {
    const out: FieldDefinition[] = [];
    for (const field of list) out.push(await copyField(field));
    return out;
  };

  return copyList(fields);
}
