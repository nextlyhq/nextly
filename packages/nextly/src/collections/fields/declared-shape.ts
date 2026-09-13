/**
 * What a field declaration says about its VALUE, published in one place.
 *
 * Several surfaces have to describe a field to something outside core: the
 * Singles facade a plugin reads, and any tool that answers "what shape is this
 * entity". Projecting the declaration member by member at each of
 * them makes the published key set a list somebody has to remember to extend,
 * and such a list cannot notice a name missing from it.
 *
 * The keys that go missing are the type-specific ones, because each belongs to a
 * minority of field types and no fixture built from the others exercises it: a
 * select's choices, a relationship's target and cardinality, the slugs a field
 * group points at.
 *
 * A spelling split hides inside the same shape. A select declares its choices as
 * `options` from code and as `fieldOptions` from the Schema Builder, so a
 * projection carrying one of the two is correct for every code-first fixture and
 * returns no choices at all for a Builder-authored field.
 *
 * So the projection lives here, once, and the set of keys it carries is DATA
 * rather than control flow. {@link declaredShape} copies the keys named in
 * {@link SCHEMA_FIELD_KEYS} and nothing else.
 *
 * ## Why an allowlist, when a denylist would never miss a key
 *
 * A denylist — copy everything except the private keys — cannot lose a
 * declaration key, which is the failure above. It fails the other way instead:
 * a key added to a stored declaration reaches every consumer the day it is
 * written, and one of these consumers describes an install to an agent holding
 * a narrowly scoped credential. Losing a key is a defect somebody reports;
 * publishing one nobody classified is a disclosure nobody sees.
 *
 * The allowlist keeps the safe failure direction, and the recurrence is closed
 * by a different mechanism: `declared-shape.test.ts` asserts that the
 * classification is TOTAL over the manifest field schema, so a key added there
 * belongs to exactly one of {@link SCHEMA_FIELD_KEYS} or
 * {@link WITHHELD_FIELD_KEYS} and a key in neither fails the build. The
 * question is settled by a test on the commit that adds the key, rather
 * than by whoever happens to be reading the diff.
 *
 * @module collections/fields/declared-shape
 */

import { typeHasNestedFields } from "./guards";

/**
 * A field as this projection publishes one: the declared members, open.
 *
 * The index signature is honest rather than lazy. What a declaration carries
 * depends on its type and on which writer produced it, so a closed interface
 * would either have to name every key of every field type or force a consumer
 * to assert. `name` and `type` are named because every consumer reads them, and
 * `fields` because it is what makes the shape recursive.
 *
 * `name` is optional at both sources and stays optional. Presentational types
 * carry none, and substituting an empty string would put a field in the answer
 * that a reader could then try to address.
 */
export interface DeclaredField {
  name?: string;
  type: string;
  fields?: DeclaredField[];
  [key: string]: unknown;
}

/**
 * The keys that describe what a field's VALUE is, and may be published.
 *
 * Drawn from the two writers that produce stored declarations: the manifest
 * schema (`schemas/_zod/ui-schema.ts`), which every schema-surface write is
 * validated against, and the legacy Builder type
 * (`schemas/dynamic-collections/legacy-types.ts`), which names several keys the
 * manifest does not. The two disagree about spelling in places — a select's
 * choices are `options` from code and `fieldOptions` from the Builder — so both
 * spellings are here and a consumer reads whichever arrived.
 *
 * Ordered by what a reader asks first: identity, then constraints, then the
 * type-specific declaration, then containment.
 */
export const SCHEMA_FIELD_KEYS: readonly string[] = [
  // Identity.
  "name",
  "type",
  "label",

  // Constraints that hold whatever the type.
  "required",
  "unique",
  "index",
  "localized",
  "private",
  "validation",

  // What the value is, per type. `options` is the code-first spelling of a
  // select or radio's choices and `fieldOptions` the Builder's; on the legacy
  // definition `options` is instead an object bag carrying a number's format or
  // a relation's target, so it is one key with two shapes and travels as
  // whichever it was.
  "options",
  "fieldOptions",
  "defaultValue",
  "default",
  "hasMany",
  "relationTo",
  "maxDepth",
  "relationshipFilter",
  "mimeTypes",
  "maxFileSize",
  "displayPreview",
  "length",
  "dbType",
  "precision",
  "scale",
  "minRows",
  "maxRows",
  "minChips",
  "maxChips",

  // Which field group a component field embeds. Four spellings, because the
  // storage migration rewrites `component`/`components` to
  // `fieldGroup`/`fieldGroups` and a definition may carry either.
  "component",
  "fieldGroup",
  "components",
  "fieldGroups",
  "repeatable",

  // Presentation that sits at the top level rather than under `admin`. Carried
  // because it is part of the declaration a writer wrote, and withholding it
  // would mean deciding per key which top-level member counts as shape.
  "labels",
  "initCollapsed",
  "rowLabelField",
  "isSortable",
  "allowCreate",
  "allowEdit",

  // Containment. Copied through {@link declaredShape} rather than by reference,
  // and only for the container types; see the guard in the projection.
  "fields",
];

/**
 * The keys deliberately NOT published, and why each one is withheld.
 *
 * - `admin` is how a field renders, not what it holds.
 * - `pluginOptions` belongs to the field's own plugin type. Handing it to a
 *   different consumer is exactly what the container exists to prevent.
 * - `access` and `hooks` are rules and lifecycle callbacks. Describing an
 *   install's authorization rules to whoever is asking about its shape is a
 *   disclosure of its own, and neither survives storage as anything callable.
 * - `validate` is a function, and `custom` is an arbitrary bag a config may put
 *   anything in, including things it would not choose to publish.
 *
 * Only `admin` and `pluginOptions` appear in the manifest schema; the rest are
 * code-first members it strips. They are named anyway, because an in-memory
 * declaration reaches this projection without passing through that parser.
 */
export const WITHHELD_FIELD_KEYS: readonly string[] = [
  "admin",
  "pluginOptions",
  "access",
  "hooks",
  "validate",
  "custom",
];

const PUBLISHED = new Set(SCHEMA_FIELD_KEYS);

/**
 * One field, reduced to the declared members this surface can publish.
 *
 * Two things are dropped beyond the allowlist, both because the published value
 * has to survive JSON and mean what it says:
 *
 * A FUNCTION never travels. `defaultValue` is declared
 * `(data) => unknown` on a code-first field and a plain value on a stored one,
 * so the key is publishable and the callable form is not: it is already absent
 * from anything read back through `JSON.parse`, and forwarding one from an
 * in-memory config would put a member in the answer that serializes to nothing.
 *
 * `fields` survives only where the TYPE is a container and the value really is
 * an array. A contributed field type carries an index signature, so it may hold
 * a `fields` option of any shape as its own configuration; published under a
 * member typed as an array, a consumer may legally walk it and get a
 * `TypeError`. A field group is a leaf here rather than a container: it names
 * the group it embeds by slug, and its children belong to that group's own
 * declaration.
 */
function declaredField(field: Record<string, unknown>): DeclaredField {
  const declared: Record<string, unknown> = {};
  for (const key of SCHEMA_FIELD_KEYS) {
    if (key === "fields") continue;
    if (!Object.prototype.hasOwnProperty.call(field, key)) continue;
    const value = field[key];
    // Assigned only when present, so an absent member stays absent. Writing
    // `undefined` would put the key in `Object.keys` and in an `in` check while
    // the type says it is optional.
    if (value === undefined) continue;
    if (typeof value === "function") continue;
    declared[key] = value;
  }
  const nested = field.fields;
  if (typeof field.type === "string" && typeHasNestedFields(field.type)) {
    if (Array.isArray(nested)) declared.fields = declaredShape(nested);
  }
  return declared as DeclaredField;
}

/**
 * @public The declared shape of a list of fields, to whatever depth it is
 * declared.
 *
 * Recursive because a repeater or a group holds its own fields, and a
 * projection that stopped at the top level would describe a document as having
 * a `sections` field of no particular shape, which a reader can neither read
 * nor write values from.
 *
 * Takes `unknown` entries because the two registries answer with different
 * types — a Single's fields are the serialized JSON shape, a collection's the
 * legacy `FieldDefinition` — and narrowing to either would make the other
 * caller assert. A non-object entry is dropped rather than published as an
 * empty field.
 */
export function declaredShape(fields: readonly unknown[]): DeclaredField[] {
  const declared: DeclaredField[] = [];
  for (const field of fields) {
    if (field === null || typeof field !== "object" || Array.isArray(field)) {
      continue;
    }
    const record = field as Record<string, unknown>;
    // A field with no type cannot be described: every consumer dispatches on
    // it, and the container rule above reads it. Dropped rather than defaulted,
    // because guessing a type puts a shape in the answer nothing declared.
    if (typeof record.type !== "string") continue;
    declared.push(declaredField(record));
  }
  return declared;
}

/** Whether a key is one this projection publishes. For callers that filter. */
export function isSchemaFieldKey(key: string): boolean {
  return PUBLISHED.has(key);
}
