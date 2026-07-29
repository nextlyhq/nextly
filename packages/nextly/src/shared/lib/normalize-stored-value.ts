/**
 * One canonical reading of a stored field value.
 *
 * The same logical value reaches core in several shapes. JSON-backed types
 * (repeater, group, json, chips, rich text, blocks, and any `hasMany` or
 * polymorphic field) are stored as real JSON on Postgres and MySQL but as text
 * on SQLite, so they arrive parsed or as strings depending on the dialect.
 * Booleans come back as `true`, `"true"`, `1`, or `"1"`. A version snapshot
 * makes this sharper: it is captured from the persisted row rather than the
 * deserialized read model, so it carries the raw storage shape.
 *
 * This coercion historically existed in several display-side copies that
 * disagreed on the fallback. It lives here now as the single source of truth so
 * the diff engine and admin display read values the same way and two equal
 * values never look different.
 *
 * @module shared/lib/normalize-stored-value
 */

/**
 * The minimal field shape normalization reads. Declared structurally (rather
 * than as the full `FieldConfig`) so the function states exactly what it
 * depends on; a `FieldConfig` is assignable to it.
 */
export interface NormalizableField {
  type: string;
  hasMany?: boolean;
  repeatable?: boolean;
  relationTo?: unknown;
}

/** Field types whose value is persisted as JSON. */
const JSON_BACKED_TYPES = new Set([
  "repeater",
  "group",
  "json",
  "chips",
  "richText",
  // A page document is stored as one JSON value, so it must be parsed back
  // before diffing or rendering, exactly like the other structured types.
  "blocks",
]);

function hasMany(field: NormalizableField): boolean {
  return field.hasMany === true;
}

/**
 * Whether a relation or upload field is polymorphic, meaning it names several
 * possible targets and stores `{ relationTo, value }` rather than a bare id.
 * Such a value is JSON even when the field holds only one.
 */
function isPolymorphicRelation(field: NormalizableField): boolean {
  if (field.type !== "relationship" && field.type !== "upload") return false;
  return Array.isArray(field.relationTo);
}

/**
 * Whether this field's value is stored as JSON, and so may arrive as a string.
 * A `hasMany` field of any type stores an array, which is JSON too.
 */
function isJsonBacked(field: NormalizableField): boolean {
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
 * Read a stored value into a canonical shape.
 *
 * Returns `null` for an absent value so callers have a single empty case to
 * handle rather than distinguishing `undefined`, `null`, and `""`.
 */
/** Many-valued fields hold an array; their empty state is `[]`, not `null`. */
function isManyValued(field: NormalizableField): boolean {
  return field.hasMany === true || field.type === "chips";
}

export function normalizeStoredValue(
  field: NormalizableField,
  raw: unknown
): unknown {
  // A many-valued field that is absent in one version and stored as `[]` in
  // another must compare equal, so absence normalizes to an empty array.
  if (raw === undefined || raw === null) {
    return isManyValued(field) ? [] : null;
  }

  // An empty string means "absent" for every type except `json`, where it is a
  // legitimate stored primitive and must survive.
  if (raw === "" && field.type !== "json") return null;

  const value =
    isJsonBacked(field) && typeof raw === "string" ? parseJson(raw) : raw;

  // `boolean` is not in the config field-type union but can reach here as a
  // runtime alias for `checkbox`; both are matched.
  if (field.type === "checkbox" || field.type === "boolean") {
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
      if (!field.repeatable && Array.isArray(value)) return value[0] ?? null;
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
