/**
 * Deterministic serializer for `ui-schema.json` (spec §4.12.1).
 *
 * Guarantees UI-written and hand-written content with the same data are
 * byte-identical: fixed key ordering, 2-space indent, trailing newline,
 * defaults omitted. The output is stable across runs so git diffs stay minimal.
 *
 * @module cli/utils/ui-schema-writer
 * @since v0.0.3-alpha (Plan D1)
 */
import type { UiSchemaManifest } from "../../schemas/_zod/ui-schema";

const SCHEMA_URL = "https://nextlyhq.com/schemas/ui-schema.v1.json";

/** Field key order: name/type first, then a human reading order. */
const FIELD_KEY_ORDER = [
  "name",
  "type",
  "relationTo",
  "hasMany",
  "options",
  "required",
  "defaultValue",
  "validation",
] as const;

const ENTITY_KEY_ORDER = [
  "slug",
  "labels",
  "admin",
  "status",
  "fields",
] as const;
const ADMIN_KEY_ORDER = ["useAsTitle", "defaultColumns", "group"] as const;

/** Build a new object with keys in `order`, dropping undefined values. */
function ordered(
  obj: Record<string, unknown>,
  order: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of order) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  // Any keys not in the explicit order are appended (defensive; schema is closed).
  for (const key of Object.keys(obj)) {
    if (!order.includes(key) && obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

function normalizeField(f: Record<string, unknown>): Record<string, unknown> {
  return ordered(f, FIELD_KEY_ORDER);
}

function normalizeEntity(e: Record<string, unknown>): Record<string, unknown> {
  const out = ordered(e, ENTITY_KEY_ORDER);
  if (out.admin !== undefined) {
    out.admin = ordered(out.admin as Record<string, unknown>, ADMIN_KEY_ORDER);
  }
  if (Array.isArray(out.fields)) {
    out.fields = (out.fields as Record<string, unknown>[]).map(normalizeField);
  }
  return out;
}

/** Serialize a validated manifest to canonical JSON text (trailing newline). */
export function serializeUiSchema(manifest: UiSchemaManifest): string {
  const canonical = {
    $schema: manifest.$schema ?? SCHEMA_URL,
    version: manifest.version ?? 1,
    collections: (manifest.collections ?? []).map(e =>
      normalizeEntity(e as unknown as Record<string, unknown>)
    ),
    singles: (manifest.singles ?? []).map(e =>
      normalizeEntity(e as unknown as Record<string, unknown>)
    ),
    components: (manifest.components ?? []).map(e =>
      normalizeEntity(e as unknown as Record<string, unknown>)
    ),
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}
