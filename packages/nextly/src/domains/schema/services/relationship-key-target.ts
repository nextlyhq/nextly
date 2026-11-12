/**
 * The table a relationship's foreign key points at, or none.
 *
 * One answer for every place that creates, predicts, alters or compares a
 * relationship's key, so the CREATE, a column added by an edit, the indexes a
 * create is predicted to install, a change of referential action and a rename
 * cannot disagree about the same field.
 *
 * @module domains/schema/services/relationship-key-target
 */
import { getTableName } from "../../collections/services/collection-utils";

import {
  fieldProducesColumn,
  relationshipStoresJson,
} from "./field-column-descriptor";

/** The collection a relationship points at, and the table its rows live in. */
export interface RelationshipKeyTarget {
  slug: string;
  table: string;
}

/**
 * The table a collection's rows live in, by its slug, as the registry records
 * it: honouring a `dbName`, and null for a slug it holds no table for.
 */
export type TableForSlug = (slug: string) => string | null | undefined;

/** The relation types whose single column holds one target's id, and so can carry a key. */
const KEYABLE_RELATION_TYPES = new Set(["oneToOne", "manyToOne", "oneToMany"]);

/**
 * The one collection a relationship points at: `relationTo` when it names one,
 * as reads take it, else `options.target`. Null for a field naming none, or
 * several (a `relationTo` list).
 */
export function relationshipTargetSlug(field: {
  relationTo?: unknown;
  options?: unknown;
}): string | null {
  if (typeof field.relationTo === "string" && field.relationTo !== "") {
    return field.relationTo;
  }
  if (Array.isArray(field.relationTo)) return null;
  const target =
    typeof field.options === "object" && field.options !== null
      ? (field.options as { target?: unknown }).target
      : undefined;
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
 * - Its table is the one `tableFor` finds. Without one, an `options.target`
 *   keeps the `dc_` table it has always been keyed to, while a `relationTo`
 *   that names another collection gets no key: its target may be Users, a
 *   Single or nothing at all, and a guessed table fails the apply.
 */
export function relationshipKeyTarget(
  field: {
    type?: unknown;
    hasMany?: unknown;
    relationTo?: unknown;
    options?: unknown;
    virtual?: unknown;
  },
  tableFor?: TableForSlug
): RelationshipKeyTarget | null {
  if (field.type !== "relationship" || !fieldProducesColumn(field)) {
    return null;
  }
  const options =
    typeof field.options === "object" && field.options !== null
      ? (field.options as { target?: unknown; relationType?: unknown })
      : {};
  const relationType = options.relationType || "manyToOne";
  if (
    typeof relationType !== "string" ||
    !KEYABLE_RELATION_TYPES.has(relationType)
  ) {
    return null;
  }
  if (relationshipStoresJson(field)) return null;

  const slug = relationshipTargetSlug(field);
  if (slug === null) return null;

  // The `dc_` table is kept only for the slug `options.target` names, which is the table such a
  // relationship has always been keyed to.
  const table =
    tableFor?.(slug) ?? (slug === options.target ? getTableName(slug) : null);
  return table ? { slug, table } : null;
}
