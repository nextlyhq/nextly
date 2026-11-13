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
 * `relationTo`, and Unique for a one-to-one, read as its column's uniqueness is
 * (`builderColumnIsUnique`): on for a one-to-one even where the field also stores Unique off.
 * Nothing is taken away, so every other reader of the definition reads what it read before. The
 * shape stays what the field already is: a relationship to one entry of one collection, whose
 * column keeps one id. A many-to-many keeps its links in a junction table, where a relationship
 * holding many keeps a list on the row, and a relationship to several collections holds
 * references rather than ids; read as either, an unchanged save would plan moving every value.
 * Both are left as they are stored.
 *
 * A save is given back what the read added: a relationship still pointed at its stored target is
 * written in its stored shape, its options kept and its cardinality following Unique
 * (`withStoredRelationshipOptions`), so opening and saving it changes nothing it records.
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
    // A one-to-one is a relationship to one entry marked unique, in the editor's words, and its
    // column is unique whatever Unique mark it also stores.
    ...(relationType === "oneToOne" ? { unique: true } : {}),
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
 * The Unique mark the editor read off a stored field (`forEditor`): a one-to-one's, or its own.
 */
function uniqueAsRead(stored: StoredField, relationType: unknown): boolean {
  return relationType === "oneToOne" || stored.unique === true;
}

/**
 * The stored options of the earlier-shaped relationship a saved field was read from, or
 * `undefined` when it was not read from one: the stored field has no `relationTo` of its own and
 * keeps a one-entry `options.target`, and the saved field still points at that one target, and
 * holds many entries only where the stored one did.
 */
function storedOptionsReadInto(
  sent: StoredField,
  stored: StoredField
): Record<string, unknown> | undefined {
  const relationships =
    sent.type === "relationship" && stored.type === "relationship";
  if (!relationships || stored.relationTo !== undefined) return undefined;
  // One made to hold many is saved as sent: a list on the row is not what the options described.
  if (sent.hasMany === true && stored.hasMany !== true) return undefined;
  const options = stored.options;
  if (typeof options !== "object" || options === null) return undefined;
  const { target, relationType } = options as {
    target?: unknown;
    relationType?: unknown;
  };
  const sameTarget = typeof target === "string" && target === sent.relationTo;
  return sameTarget && ONE_ENTRY_RELATION_TYPES.has(relationType)
    ? (options as Record<string, unknown>)
    : undefined;
}

/**
 * The cardinality a restored relationship is saved with. It follows the Unique mark only where the
 * save changed it, so an unchanged save writes back exactly what was stored: a one-to-one is
 * unique, and one no longer unique is many-to-one.
 */
function relationTypeAfter(
  sent: StoredField,
  stored: StoredField,
  relationType: unknown
): unknown {
  const unique = sent.unique === true;
  if (unique === uniqueAsRead(stored, relationType)) return relationType;
  if (unique) return "oneToOne";
  return relationType === "oneToOne" ? "manyToOne" : relationType;
}

/**
 * A saved field given back the options of the earlier-shaped relationship it was read from
 * (`storedOptionsReadInto`), or `undefined` when it was not read from one.
 */
function restoredRelationship(
  sent: StoredField,
  stored: StoredField
): StoredField | undefined {
  const options = storedOptionsReadInto(sent, stored);
  if (options === undefined) return undefined;
  const nextRelationType = relationTypeAfter(
    sent,
    stored,
    options.relationType
  );
  const { relationTo: _target, unique: sentUnique, ...rest } = sent;
  const sentOptions =
    typeof sent.options === "object" && sent.options !== null
      ? (sent.options as Record<string, unknown>)
      : {};
  return {
    ...rest,
    // A stored field with a Unique mark of its own keeps it while the save leaves Unique as it was
    // read, and takes the one the save sent where the save turned it on or off.
    ...(stored.unique === undefined
      ? {}
      : {
          unique:
            (sentUnique === true) === uniqueAsRead(stored, options.relationType)
              ? stored.unique
              : sentUnique,
        }),
    // What the save sends over what was stored, as any edit is: the stored target, which the
    // save still points at, and the cardinality that follows its Unique mark stay as derived.
    options: {
      ...options,
      ...sentOptions,
      target: options.target,
      ...(nextRelationType === undefined
        ? {}
        : { relationType: nextRelationType }),
    },
  };
}

/**
 * The fields a save sends, each relationship the editor read from an earlier-shaped one
 * (`withEditorRelationshipFields`) written back the way it was stored, at any depth inside groups
 * and repeaters. Read the other way, its stored `options` would be replaced by the editor's
 * `relationTo` and Unique mark, losing what only they record, such as its delete action. A field
 * is matched to the stored field of the same name at the same place, or to the one it is renamed
 * from; one pointed at another target, or made to hold many, is saved as sent. Any other field is
 * returned as it is.
 *
 * @param sent the field list a save sends
 * @param stored the entity's stored field list the editor read
 * @param renames the renames the save makes among `stored`'s fields (`acceptedFieldRenames`)
 */
export function withStoredRelationshipOptions<F>(
  sent: readonly F[],
  stored: readonly unknown[],
  renames: readonly {
    from: { name: string };
    to: { name: string };
  }[] = []
): F[] {
  const storedByName = new Map<unknown, StoredField>();
  for (const field of stored) {
    if (typeof field === "object" && field !== null) {
      const named = field as StoredField;
      if (typeof named.name === "string") storedByName.set(named.name, named);
    }
  }
  return sent.map(field => {
    if (typeof field !== "object" || field === null) return field;
    const sentField = field as StoredField;
    // A field the save renames is matched to the stored field it was before.
    const storedField = storedByName.get(
      renames.find(rename => rename.to.name === sentField.name)?.from.name ??
        sentField.name
    );
    if (storedField === undefined) return field;
    const restored = restoredRelationship(sentField, storedField);
    if (restored !== undefined) return restored as F;
    if (
      typeof sentField.type === "string" &&
      typeHasNestedFields(sentField.type) &&
      sentField.type === storedField.type &&
      Array.isArray(sentField.fields) &&
      Array.isArray(storedField.fields)
    ) {
      return {
        ...sentField,
        fields: withStoredRelationshipOptions(
          sentField.fields,
          storedField.fields
        ),
      } as F;
    }
    return field;
  });
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
