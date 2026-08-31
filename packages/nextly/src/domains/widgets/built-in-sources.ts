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
  sourceKindFromId,
  type WidgetSource,
  type WidgetSourceField,
} from "./sources";

/** The primary key. Present whatever else the collection is configured with. */
const IDENTITY_FIELD: WidgetSourceField = { name: "id", type: "string" };

/**
 * The columns `timestamps` creates, and the ones a recency widget sorts by.
 *
 * Appended only when the collection actually has them. `timestamps: false`
 * means the table carries no `created_at`/`updated_at` at all, so declaring
 * them selectable and sortable is a promise the read path cannot keep: the
 * query passes validation, reaches the compiler, and fails on a missing
 * column -- a refusal about a field the source itself said was available.
 */
const TIMESTAMP_FIELDS: readonly WidgetSourceField[] = [
  { name: "createdAt", type: "date" },
  { name: "updatedAt", type: "date" },
];

/**
 * The column `status` creates, and the one a "needs review" widget filters on.
 *
 * Appended on exactly the same terms as the timestamps, and for the same
 * reason: `status: true` is what makes the schema pipeline inject a `status`
 * system column (`hasStatus`, `diff/build-from-fields.ts` -- varchar/text NOT
 * NULL DEFAULT 'draft'), so the column's existence is a per-collection fact,
 * not a constant. Leaving it undeclared is the mirror image of the timestamps
 * defect and fails in the opposite direction: the read path has the column and
 * the SOURCE refuses it, so a `status: "all"` table widget cannot select, sort
 * or filter on a value its own rows carry.
 *
 * Typed `string` rather than a narrower kind because
 * `WIDGET_SOURCE_FIELD_TYPES` has no enum member -- "draft"/"published" is
 * text, which is what the column stores.
 */
const STATUS_FIELD: WidgetSourceField = { name: "status", type: "string" };

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

/**
 * The declared fields a collection exposes to widgets, minus anything
 * unreadable and minus any repeat of a name already taken.
 *
 * Deduplicated HERE rather than left to `validateSourceFields` to refuse,
 * because a collection can produce a duplicate without its author writing one:
 * `readableFields` flattens unnamed presentational groups into the level they
 * sit in, so a top-level `title` and a `title` inside a layout group arrive as
 * two entries carrying one name. Refusing that is right for a source declared
 * by hand and wrong for one DERIVED from a collection -- and the blast radius
 * is the whole install, since `refreshCollectionSources` rebuilds every
 * collection source in one pass.
 *
 * The FIRST declaration wins, which is the one an author reading their own
 * config from the top means: a layout group appended below cannot displace the
 * field it shadows.
 */
function exposedFields(
  fields: Array<{ name: string; type: string }>
): WidgetSourceField[] {
  const taken = new Set<string>();
  const exposed: WidgetSourceField[] = [];
  for (const field of fields) {
    if (NEVER_EXPOSED_FIELD_TYPES.has(field.type)) continue;
    if (taken.has(field.name)) continue;
    taken.add(field.name);
    exposed.push({ name: field.name, type: toSourceType(field.type) });
  }
  return exposed;
}

/** One collection, in the shape a widget source is built from. */
export interface WidgetSourceCollection {
  slug: string;
  fields: Array<{ name: string; type: string }>;
  /**
   * Whether the collection has `createdAt`/`updatedAt` columns. Absent means
   * ON, which is how `defineCollection` normalizes it and how the registry
   * stores it.
   */
  timestamps?: boolean;
  /**
   * Whether the collection has the Draft/Published `status` column.
   *
   * Absent means OFF -- the OPPOSITE default to `timestamps`, and deliberately
   * so: `DynamicCollectionRecord.status` defaults to false, so an install's
   * ordinary collection has no such column and declaring one would be the very
   * promise the read path cannot keep that `timestamps` is careful about.
   */
  status?: boolean;
}

/** The widget source a single collection exposes. */
function collectionSource(collection: WidgetSourceCollection): WidgetSource {
  const declared = exposedFields(collection.fields);
  const seen = new Set(declared.map(f => f.name));
  const systemFields: WidgetSourceField[] = [IDENTITY_FIELD];
  if (collection.timestamps !== false) systemFields.push(...TIMESTAMP_FIELDS);
  if (collection.status === true) systemFields.push(STATUS_FIELD);

  const id = `collection:${collection.slug}`;

  return {
    id,
    label: collection.slug,
    // DERIVED from the id rather than restated beside it. The id's namespace is
    // the canonical identity -- `registerSource` refuses a source whose two
    // disagree -- so writing `"collection"` here as well would be the same fact
    // in two places, which is the arrangement that let them drift apart.
    kind: sourceKindFromId(id),
    // `read-<slug>`: the spelling the permission table and `canReadEntity`
    // use, so a picker filtering on this asks the same question the read
    // path answers. Advisory only -- see `WidgetSource.requiredPermission`
    // for why nothing enforces it.
    requiredPermission: `read-${collection.slug}`,
    supports: ["count", "list"],
    fields: [
      ...declared,
      ...systemFields.filter(field => !seen.has(field.name)),
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
