/**
 * The sources every install has before any plugin: one per registered
 * collection.
 *
 * Derived from the collection registry rather than hand-listed, so adding a
 * collection makes it queryable with no second list to fall behind.
 *
 * @module domains/widgets/built-in-sources
 */

import { entryTitleField } from "../collections/entry-title";

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

/**
 * Field types whose stored value a row-drawing card can PRINT.
 *
 * 🔴 An allowlist, and read against the field's ORIGINAL type rather than the
 * coarse one below: `toSourceType` maps everything it does not recognise to
 * `"string"`, so a `json`, `group`, `repeater`, `component` or `chips` field is
 * indistinguishable from a text field by the time a source is built. Schema
 * validation permits any of those as `admin.useAsTitle`, and the card that
 * results asks for an object per row -- which `asText` correctly declines to
 * stringify, so every row draws an em dash and the card says nothing at all.
 *
 * 🔴 CARDINALITY is checked beside the type, because a scalar type is not a
 * scalar VALUE. `text` and `select` both accept `hasMany`, and one of those
 * stores an array — which `asText` declines to print, so the card draws an em
 * dash on every row while a usable conventional title sits unused beside it.
 * Type alone was the wrong question.
 *
 * FAILS CLOSED on a type it does not know, including one a plugin registered.
 * The two outcomes are not symmetric: an unrecognised scalar costs that
 * collection its recent card, which is a missing card; an unrecognised
 * structured type costs the reader a card of em dashes, which looks like the
 * product is broken. `relationship` and `upload` are excluded for a third
 * reason -- their value may well be a printable id, and an id is not a name.
 */
/**
 * 🔴 The INVARIANT this list has to hold: every type in it must produce a value
 * the shared naming rule will actually print. That rule accepts a non-empty
 * string or a finite number and refuses everything else, in both places it is
 * implemented -- `readableText` for the entry surfaces and the candidate walk in
 * `entryHeading` for the activity feed.
 *
 * `checkbox` is absent for that reason, and its absence is the point rather than
 * an oversight: a boolean is a legal `useAsTitle` nomination and a conventional
 * field can itself be a checkbox, so nominating one here made the field-level
 * answer disagree with every value-level answer -- the generated card selecting
 * a column whose value each of those rules then declines, while the same entry
 * is named by a conventional fallback everywhere else. A type this list admits
 * but the value rule refuses is a card that names nothing.
 */
const PRINTABLE_FIELD_TYPES: ReadonlySet<string> = new Set([
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "email",
  "code",
  "radio",
]);

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
/**
 * The declarations a source actually CARRIES, one per name.
 *
 * 🔴 Split out so every question about a field is asked of the SAME
 * declaration. A collection may declare one name twice, and the two need not
 * agree: `tags` as `hasMany` and then `tags` as a scalar is a legal config. The
 * exposed field list kept the first of those while the printable-title filter
 * was asked of the RAW list, where the second one also gets a vote -- so a name
 * whose retained declaration stores an array could be nominated as the title,
 * and the list card printed an array where a name belongs.
 *
 * Hidden types are dropped BEFORE a name is claimed, which is deliberate and is
 * why "first" here means first EXPOSED: a name first declared as a
 * never-exposed type and later as text is carried by the later declaration,
 * because the earlier one was never a candidate to begin with.
 */
function retainedDeclarations<T extends { name: string; type: string }>(
  fields: readonly T[]
): T[] {
  const taken = new Set<string>();
  const kept: T[] = [];
  for (const field of fields) {
    if (NEVER_EXPOSED_FIELD_TYPES.has(field.type)) continue;
    if (taken.has(field.name)) continue;
    taken.add(field.name);
    kept.push(field);
  }
  return kept;
}

function exposedFields(
  fields: Array<{ name: string; type: string; label?: string }>
): WidgetSourceField[] {
  // The label travels with the field. This function REBUILDS each entry rather
  // than passing it through -- `type` is mapped into the source vocabulary
  // here -- so anything not named is dropped, which is how the label went
  // missing between the collection registry and the source in the first place.
  return retainedDeclarations(fields).map(field => ({
    name: field.name,
    type: toSourceType(field.type),
    ...(field.label !== undefined && { label: field.label }),
  }));
}

/** One collection, in the shape a widget source is built from. */
export interface WidgetSourceCollection {
  slug: string;
  fields: Array<{
    name: string;
    type: string;
    label?: string;
    /** Whether the field stores an ARRAY. A scalar type may still be one. */
    hasMany?: boolean;
  }>;
  /**
   * What a human calls this collection — the registry's plural label.
   *
   * Absent falls back to the slug, which is what every source published before
   * this was carrying. A collection that never set one has no better answer.
   */
  label?: string;
  /**
   * The field the collection's author nominated to name its entries
   * (`admin.useAsTitle`), when they nominated one.
   *
   * Carried rather than resolved by the caller, because resolving it needs the
   * full field list — system columns included — which only the source knows.
   */
  useAsTitle?: string;
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
  const fields = [
    ...declared,
    ...systemFields.filter(field => !seen.has(field.name)),
  ];
  // Through the shared rule, with BOTH halves: the author's nomination and the
  // names it must exist in. Resolved once here so no consumer has to ask again
  // with only one of them.
  // Only the fields a card could actually print are candidates. Passing every
  // name would let the shared rule nominate a structured field, and the entry
  // list does not behave that way either: it reads the VALUE and falls back
  // when the nominated one is not readable text. This is that same behaviour,
  // decided from the declaration instead of from a row.
  //
  // Asked of the RETAINED declarations, not of `collection.fields`. A duplicate
  // name's later declaration is not the one this source carries, so letting it
  // answer here would qualify a name whose actual declaration stores an array.
  const printable = new Set(
    retainedDeclarations(collection.fields)
      .filter(
        field => PRINTABLE_FIELD_TYPES.has(field.type) && field.hasMany !== true
      )
      .map(field => field.name)
  );
  const titleField = entryTitleField(
    collection.useAsTitle,
    fields.filter(field => printable.has(field.name)).map(field => field.name)
  );

  return {
    id,
    ...(titleField === undefined ? {} : { titleField }),
    // What a HUMAN calls this collection, which is what `label` means. The slug
    // is a storage identifier: a collection whose plural label is "Articles"
    // was published to the source picker, and to every generated card's title,
    // as `blog-posts` -- disagreeing with the name used everywhere else in the
    // admin. The slug remains the identity, in `id`.
    label: collection.label ?? collection.slug,
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
    fields,
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
