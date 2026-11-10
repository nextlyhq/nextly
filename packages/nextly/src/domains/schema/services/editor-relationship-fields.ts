/**
 * Relationship fields as the Schema Builder's editor reads them.
 *
 * The earlier Builder stored a relationship's target in `options.target` and its cardinality in
 * `options.relationType`. Today's editor reads the target from `relationTo` and a one-to-one from
 * the field's Unique mark, so a relationship stored the earlier way opened with no target and
 * Unique off: a save was refused until a target was picked again, and then left it many-to-one,
 * dropping the uniqueness its column had.
 *
 * Each such field is given what the editor reads, from what it already stores: its target as
 * `relationTo`, and Unique for a one-to-one. Nothing is taken away, and nothing the field already
 * states is overwritten, so every other reader of the definition reads what it read before. The
 * shape stays what the field already is: a relationship to one entry of one collection, whose
 * column keeps one id. A many-to-many keeps its links in a junction table, where a relationship
 * holding many keeps a list on the row, and a relationship to several collections holds
 * references rather than ids; read as either, an unchanged save would plan moving every value.
 * Both are left as they are stored.
 *
 * @module domains/schema/services/editor-relationship-fields
 */

import { typeHasNestedFields } from "../../../collections/fields/guards";

/** The cardinalities a relationship to one entry was stored with. */
const ONE_ENTRY_RELATION_TYPES: ReadonlySet<unknown> = new Set([
  undefined,
  "oneToOne",
  "manyToOne",
  "oneToMany",
]);

/** A stored field, read without trusting its shape. */
type StoredField = Record<string, unknown>;

/** The field as the editor reads it; the same object when nothing is added. */
function forEditor(field: StoredField): StoredField {
  const nested = field.fields;
  const withNested =
    typeof field.type === "string" &&
    typeHasNestedFields(field.type) &&
    Array.isArray(nested)
      ? { ...field, fields: withEditorRelationshipFields(nested) }
      : field;
  if (withNested.type !== "relationship" || withNested.relationTo !== undefined)
    return withNested;
  const options = withNested.options;
  if (typeof options !== "object" || options === null) return withNested;
  const { target, relationType } = options as {
    target?: unknown;
    relationType?: unknown;
  };
  if (typeof target !== "string" || target === "") return withNested;
  if (!ONE_ENTRY_RELATION_TYPES.has(relationType)) return withNested;
  return {
    ...withNested,
    relationTo: target,
    // A one-to-one is a relationship to one entry marked unique, in the editor's words.
    ...(relationType === "oneToOne" && withNested.unique === undefined
      ? { unique: true }
      : {}),
  };
}

/**
 * `fields`, each relationship the earlier Builder stored given the target and the Unique mark the
 * editor reads, at any depth inside groups and repeaters. Any other field is returned as it is.
 *
 * @param fields a stored field list
 */
export function withEditorRelationshipFields<F>(fields: readonly F[]): F[] {
  return fields.map(field =>
    typeof field === "object" && field !== null
      ? (forEditor(field as StoredField) as F)
      : field
  );
}

/**
 * A collection's or Single's schema record as the editor reads it: its field list, and the copy
 * of it a collection's record also carries under `schemaDefinition`, each given the editor's
 * relationship shape (`withEditorRelationshipFields`). Every other property is returned as it is.
 *
 * @param record the record a schema read returns
 */
export function withEditorRelationshipShape<R>(record: R): R {
  if (typeof record !== "object" || record === null) return record;
  const shaped = { ...(record as Record<string, unknown>) };
  if (Array.isArray(shaped.fields)) {
    shaped.fields = withEditorRelationshipFields(shaped.fields);
  }
  const definition = shaped.schemaDefinition;
  if (
    typeof definition === "object" &&
    definition !== null &&
    Array.isArray((definition as { fields?: unknown }).fields)
  ) {
    shaped.schemaDefinition = {
      ...definition,
      fields: withEditorRelationshipFields(
        (definition as { fields: unknown[] }).fields
      ),
    };
  }
  return shaped as R;
}
