/**
 * The table a relationship's foreign key points at, or none.
 *
 * One answer for every place that creates, predicts, alters or compares a
 * relationship's key, so the CREATE, a column added by an edit, the keys a
 * create is predicted to install, a change of referential action, a rename and
 * the push pipeline's desired table cannot disagree about the same field.
 *
 * @module domains/schema/services/relationship-key-target
 */
import { getTableName } from "../../collections/services/collection-utils";
import type { CollectionTables } from "../../dynamic-collections/services/collection-tables";

import {
  fieldProducesColumn,
  relationshipStoresJson,
} from "./field-column-descriptor";

/** The collection a relationship points at, and the table its rows live in. */
export interface RelationshipKeyTarget {
  slug: string;
  table: string;
}

/** The relation types whose single column holds one target's id, and so can carry a key. */
const KEYABLE_RELATION_TYPES: ReadonlySet<string> = new Set([
  "oneToOne",
  "manyToOne",
  "oneToMany",
]);

/** A field as far as its key is concerned: the shapes the Builder, REST and code-first configs write. */
export interface RelationshipKeyField {
  type?: unknown;
  hasMany?: unknown;
  relationTo?: unknown;
  options?: unknown;
  virtual?: unknown;
}

function optionsOf(field: RelationshipKeyField): {
  target?: unknown;
  relationType?: unknown;
} {
  // Any object: both keys are optional and read as `unknown`.
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
  const target = optionsOf(field).target;
  return typeof target === "string" && target !== "" ? target : null;
}

/**
 * The target a relationship field's column is keyed to, or null for one that
 * carries no key.
 *
 * - Only a relationship with a column of its own: an upload, a virtual field and
 *   a many-to-many (whose links live in a junction table) have none to key.
 * - Only a relation type that stores one id, many-to-one when unstated, as the
 *   Builder creates it.
 * - Not one stored as JSON: a `hasMany` list or a `relationTo` list holds no
 *   single id a key could check.
 * - The target is `relationTo` when it names one collection, as reads take it,
 *   else `options.target`.
 * - A `relationTo` target is keyed only through a map read for a Schema Builder
 *   collection's own keys (`builderKeyTables`), and only to a table that map
 *   holds: a target it does not hold may be Users, a Single or nothing at all,
 *   and a guessed table fails the apply. Without such a map, a relationship
 *   whose `relationTo` names another collection than its `options.target` gets
 *   no key, since its rows hold ids of the `relationTo` collection.
 * - An `options.target` target is keyed to the table the map holds for it, else
 *   the `dc_` table its slug spells, as it always has been.
 */
export function relationshipKeyTarget(
  field: RelationshipKeyField,
  targetTables?: CollectionTables
): RelationshipKeyTarget | null {
  if (field.type !== "relationship" || !fieldProducesColumn(field)) {
    return null;
  }
  const options = optionsOf(field);
  const relationType = options.relationType ?? "manyToOne";
  if (
    typeof relationType !== "string" ||
    !KEYABLE_RELATION_TYPES.has(relationType)
  ) {
    return null;
  }
  if (relationshipStoresJson(field)) return null;

  const slug = relationshipTargetSlug(field);
  if (slug === null) return null;

  if (targetTables?.keysRelationTo === true) {
    const table = targetTables.get(slug);
    if (table !== undefined) return { slug, table };
    // A slug the registry does not hold: only the `options.target` shape keeps its spelled table.
    return slug === options.target ? { slug, table: getTableName(slug) } : null;
  }
  // Not a Builder collection's own keys: only `options.target` is keyed, and only when the
  // relationship's `relationTo` (which reads follow) names the same collection or none.
  if (slug !== options.target) return null;
  return { slug, table: targetTables?.get(slug) ?? getTableName(slug) };
}
