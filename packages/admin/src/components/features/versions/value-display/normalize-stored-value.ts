/**
 * One canonical reading of a stored field value.
 *
 * The same value can reach the client in several shapes. JSON-backed types
 * (repeater, group, json, chips, rich text, and any `hasMany` field) are stored
 * as real JSON on Postgres and MySQL but as text on SQLite, so they arrive
 * parsed or as strings depending on the dialect. Booleans come back as `true`,
 * `"true"`, `1`, or `"1"`. A version snapshot makes this sharper still: it is
 * captured from the persisted row rather than the deserialized read model, so
 * it carries the raw storage shape.
 *
 * This coercion already exists in three places that disagree with each other on
 * the fallback — the entry form returns `[]` for an unparseable chips value, the
 * list cell returns `[value]`, and the read path keeps the raw string. Display
 * code should read values through here rather than adding a fourth.
 *
 * @module components/features/versions/value-display/normalize-stored-value
 */

import type { FieldConfig } from "nextly/config";

/** Field types whose value is persisted as JSON. */
const JSON_BACKED_TYPES = new Set([
  "repeater",
  "group",
  "json",
  "chips",
  "richText",
]);

function hasMany(field: FieldConfig): boolean {
  return (field as { hasMany?: boolean }).hasMany === true;
}

/**
 * Whether a relation or upload field is polymorphic, meaning it names several
 * possible targets and stores `{ relationTo, value }` rather than a bare id.
 * Such a value is JSON even when the field holds only one.
 */
function isPolymorphicRelation(field: FieldConfig): boolean {
  if (field.type !== "relationship" && field.type !== "upload") return false;
  return Array.isArray((field as { relationTo?: unknown }).relationTo);
}

/**
 * Whether this field's value is stored as JSON, and so may arrive as a string.
 * A `hasMany` field of any type stores an array, which is JSON too.
 */
function isJsonBacked(field: FieldConfig): boolean {
  return (
    JSON_BACKED_TYPES.has(field.type) ||
    hasMany(field) ||
    isPolymorphicRelation(field)
  );
}

/** Parse a JSON string, or return the original value when it is not one. */
function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * Read a stored value into the shape display code expects.
 *
 * Returns `null` for an absent value so callers have a single empty case to
 * handle rather than distinguishing `undefined`, `null`, and `""`.
 */
export function normalizeStoredValue(
  field: FieldConfig,
  raw: unknown
): unknown {
  if (raw === undefined || raw === null) return null;

  // An empty string means "absent" for every type except `json`, where it is a
  // legitimate stored primitive and must survive to be displayed as one.
  if (raw === "" && field.type !== "json") return null;

  const value =
    isJsonBacked(field) && typeof raw === "string" ? parseJson(raw) : raw;

  // `boolean` is not in the config field-type union but reaches display code as
  // a runtime alias for `checkbox`, the same way the cell registry accepts it.
  // It is matched here because the switch below is typed to the union.
  if (field.type === "checkbox" || (field.type as string) === "boolean") {
    // Every encoding the three supported dialects produce for a boolean.
    return value === true || value === "true" || value === 1 || value === "1";
  }

  switch (field.type) {
    case "chips": {
      // A chips value is always a list. A single stored string is a legacy
      // single-entry value, not a list of its characters.
      if (Array.isArray(value)) return value;
      return typeof value === "string" ? [value] : [];
    }

    case "component": {
      // Components arrive as an array even when the field holds one instance,
      // because they are populated from their own table.
      const repeatable = (field as { repeatable?: boolean }).repeatable;
      if (!repeatable && Array.isArray(value)) return value[0] ?? null;
      return value;
    }

    case "repeater":
      return Array.isArray(value) ? value : [];

    case "number": {
      if (hasMany(field)) return Array.isArray(value) ? value : [];
      const num = typeof value === "string" ? Number(value) : value;
      return typeof num === "number" && !Number.isNaN(num) ? num : null;
    }

    default:
      return value;
  }
}
