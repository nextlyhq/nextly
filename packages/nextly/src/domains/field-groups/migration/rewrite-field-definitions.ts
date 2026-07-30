/**
 * Rewrites the field-group vocabulary inside a stored field definition list.
 *
 * These definitions are not history: the runtime builds its schema from them, so
 * a spelling left behind here is a live definition the code can no longer read.
 * They are also the place where a careless rewrite does the most damage, because
 * the same word means two different things depending on where it sits:
 *
 * - `component` is the **value** of `type` on a field-group field, and
 * - `component` is also a **property name** on that same node, naming which
 *   field group it points at.
 *
 * So a rewrite keyed on strings, or on property names without checking the node
 * they belong to, corrupts author schema: a user may legitimately have named
 * their own field `components`, or stored the string `component` inside a
 * default value. Every rule below is therefore anchored to a node this module
 * has already identified as a field-group field.
 *
 * @module domains/field-groups/migration/rewrite-field-definitions
 */

/**
 * The field types whose definitions nest further field definitions.
 *
 * Only these two containers hold a field list. A plugin field type is
 * open-ended and may carry its own `fields` option as private configuration, so
 * descending into `fields` on any other type would run these rules over data
 * that is not a field list at all. This mirrors the same rule the payload
 * validator applies when it walks declarations.
 */
const CONTAINER_FIELD_TYPES: ReadonlySet<string> = new Set([
  "repeater",
  "group",
]);

/** One side of the rename: how a vocabulary spells a field-group field. */
export interface FieldGroupVocabulary {
  /** The value a field-group field's `type` carries. */
  readonly fieldType: string;
  readonly refKeys: {
    /** Property naming the one field group an embedded field points at. */
    readonly single: string;
    /** Property listing the field groups a dynamic zone accepts. */
    readonly many: string;
    /**
     * A read-only compatibility spelling of `single`, if this vocabulary has
     * one. Rows carrying it are normalised onto `single` rather than translated,
     * which retires the concept instead of giving it a new name.
     */
    readonly legacy?: string;
  };
}

/**
 * Rewrite every field-group field in a stored definition list.
 *
 * Returns a new structure; the input is not mutated, because the caller writes
 * the result back only if the whole document rewrote cleanly.
 *
 * Direction is expressed by which vocabulary is passed as which argument, so a
 * rollback is this function with the arguments swapped rather than a second
 * implementation. The one asymmetry is deliberate: `legacy` is normalised away
 * going forward and never reintroduced going back, because nothing wrote it in
 * the first place and a rollback that minted it would be inventing history.
 */
export function rewriteFieldDefinitions(
  fields: unknown,
  from: FieldGroupVocabulary,
  to: FieldGroupVocabulary
): unknown {
  if (!Array.isArray(fields)) return fields;
  return fields.map(field => rewriteField(field, from, to));
}

function rewriteField(
  field: unknown,
  from: FieldGroupVocabulary,
  to: FieldGroupVocabulary
): unknown {
  if (!isRecord(field)) return field;

  const isFieldGroup = field.type === from.fieldType;
  const rewritten: Record<string, unknown> = {};

  // Rebuilt key by key rather than deleted-and-reassigned, so a renamed
  // property keeps its position. Stored JSON is read by humans in the Schema
  // Builder and diffed in review; reordering every field-group definition would
  // be a large, meaningless change on top of a small meaningful one.
  for (const [key, value] of Object.entries(field)) {
    if (isFieldGroup && key === "type") {
      rewritten[key] = to.fieldType;
      continue;
    }
    if (isFieldGroup && key === from.refKeys.single) {
      rewritten[to.refKeys.single] = value;
      continue;
    }
    if (isFieldGroup && key === from.refKeys.many) {
      rewritten[to.refKeys.many] = value;
      continue;
    }
    if (
      isFieldGroup &&
      from.refKeys.legacy !== undefined &&
      key === from.refKeys.legacy
    ) {
      // Normalised onto the canonical key, not renamed. A node carrying both
      // keeps the canonical value: the legacy one predates it, so the newer
      // spelling is the one that was written deliberately.
      if (!(from.refKeys.single in field)) {
        rewritten[to.refKeys.single] = value;
      }
      continue;
    }
    if (key === "fields" && isContainer(field.type)) {
      rewritten[key] = rewriteFieldDefinitions(value, from, to);
      continue;
    }
    rewritten[key] = value;
  }

  return rewritten;
}

function isContainer(type: unknown): boolean {
  return typeof type === "string" && CONTAINER_FIELD_TYPES.has(type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
