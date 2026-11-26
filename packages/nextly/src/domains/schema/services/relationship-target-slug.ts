/**
 * The collection a relationship points at, as reads take it.
 *
 * Kept apart from `relationship-key-target`, which reaches the database helpers, so the
 * configuration check (`shared/lib/config-problems`), which client-safe entries load, can read a
 * relationship's target without reaching Node built-ins.
 *
 * @module domains/schema/services/relationship-target-slug
 */

/** A field as far as its key is concerned: the shapes the Builder, REST and code-first configs write. */
export interface RelationshipKeyField {
  type?: unknown;
  hasMany?: unknown;
  relationTo?: unknown;
  options?: unknown;
  virtual?: unknown;
}

/** A relationship's `options`, or none: both keys are optional and read as `unknown`. */
export function relationshipOptionsOf(field: RelationshipKeyField): {
  target?: unknown;
  relationType?: unknown;
} {
  return typeof field.options === "object" && field.options !== null
    ? field.options
    : {};
}

/**
 * The one collection a relationship points at: `relationTo` when it names one,
 * as reads take it, else `options.target`. Null for a field naming none, or
 * several (a `relationTo` list).
 */
export function relationshipTargetSlug(
  field: RelationshipKeyField
): string | null {
  if (typeof field.relationTo === "string" && field.relationTo !== "") {
    return field.relationTo;
  }
  if (Array.isArray(field.relationTo)) return null;
  const target = relationshipOptionsOf(field).target;
  return typeof target === "string" && target !== "" ? target : null;
}
