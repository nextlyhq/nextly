/**
 * The sources every install has before any plugin: one per registered
 * collection.
 *
 * Derived from the collection registry rather than hand-listed, so adding a
 * collection makes it queryable with no second list to fall behind.
 *
 * @module domains/widgets/built-in-sources
 */

import {
  replaceSourcesOfKind,
  type WidgetSource,
  type WidgetSourceField,
} from "./sources";

/** Columns every collection has, and the ones a recency widget sorts by. */
const ALWAYS_PRESENT: readonly WidgetSourceField[] = [
  { name: "id", type: "string" },
  { name: "createdAt", type: "date" },
  { name: "updatedAt", type: "date" },
];

/**
 * Field types a widget must never see, however the caller declares the
 * collection. `password`'s own type declares its value "never returned by any
 * read or mutation response" (collections/fields/types/password.ts) -- so
 * declaring it queryable would be a promise the executor cannot keep, and
 * would hand a `where` filter an oracle over a value that is supposed to be
 * unreadable. A source's `fields` list is what a widget author is offered to
 * select or filter on, so this is where that guarantee has to be enforced,
 * not left to whatever the Direct API happens to redact downstream.
 */
const NEVER_EXPOSED_FIELD_TYPES: ReadonlySet<string> = new Set(["password"]);

/** Map a Nextly field type onto the coarse type a query validator needs. */
function toSourceType(fieldType: string): WidgetSourceField["type"] {
  switch (fieldType) {
    case "number":
    case "float":
    case "integer":
      return "number";
    case "checkbox":
    case "boolean":
      return "boolean";
    case "date":
    case "datetime":
      return "date";
    default:
      return "string";
  }
}

/** The declared fields a collection exposes to widgets, minus anything unreadable. */
function exposedFields(
  fields: Array<{ name: string; type: string }>
): WidgetSourceField[] {
  return fields
    .filter(field => !NEVER_EXPOSED_FIELD_TYPES.has(field.type))
    .map(field => ({ name: field.name, type: toSourceType(field.type) }));
}

/** One collection, in the shape a widget source is built from. */
export interface WidgetSourceCollection {
  slug: string;
  fields: Array<{ name: string; type: string }>;
}

/** The widget source a single collection exposes. */
function collectionSource(collection: WidgetSourceCollection): WidgetSource {
  const declared = exposedFields(collection.fields);
  const seen = new Set(declared.map(f => f.name));

  return {
    id: `collection:${collection.slug}`,
    label: collection.slug,
    kind: "collection",
    // `read-<slug>`: the spelling the permission table and `canReadEntity`
    // use, so a picker filtering on this asks the same question the read
    // path answers. Advisory only -- see `WidgetSource.requiredPermission`
    // for why nothing enforces it.
    requiredPermission: `read-${collection.slug}`,
    supports: ["count", "list"],
    fields: [
      ...declared,
      ...ALWAYS_PRESENT.filter(field => !seen.has(field.name)),
    ],
  };
}

/**
 * Publish exactly these collections as the install's collection sources.
 *
 * A REPLACEMENT rather than an addition, because the collection set is derived
 * from a registry that changes while the process runs: a collection dropped
 * from it has to lose its source, and republishing the same slug has to be
 * something that can happen twice without colliding with itself.
 */
export function registerBuiltInSources(
  collections: WidgetSourceCollection[]
): void {
  replaceSourcesOfKind("collection", collections.map(collectionSource));
}
