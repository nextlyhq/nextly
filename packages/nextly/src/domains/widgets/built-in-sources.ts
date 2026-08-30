/**
 * The sources every install has before any plugin: one per registered
 * collection.
 *
 * Derived from the collection registry rather than hand-listed, so adding a
 * collection makes it queryable with no second list to fall behind.
 *
 * @module domains/widgets/built-in-sources
 */

import { registerSource, type WidgetSourceField } from "./sources";

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

export function registerBuiltInSources(
  collections: Array<{
    slug: string;
    fields: Array<{ name: string; type: string }>;
  }>
): void {
  for (const collection of collections) {
    const declared = exposedFields(collection.fields);
    const seen = new Set(declared.map(f => f.name));

    registerSource({
      id: `collection:${collection.slug}`,
      label: collection.slug,
      kind: "collection",
      // The same resource namespace the permission table uses, so selecting a
      // source and reading a collection ask one question.
      requiredPermission: `${collection.slug}:read`,
      supports: ["count", "list"],
      fields: [
        ...declared,
        ...ALWAYS_PRESENT.filter(field => !seen.has(field.name)),
      ],
    });
  }
}
