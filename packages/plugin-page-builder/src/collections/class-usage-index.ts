/**
 * Where the record of "which documents reference which named class" lives.
 *
 * One row per reference: a document that uses three classes contributes three
 * rows. That normalisation is the whole point — the question the class library
 * asks is "which documents use THIS class", and a row per pair answers it with
 * a lookup rather than a scan over every stored document.
 *
 * ## Why a collection rather than a table
 *
 * A plugin cannot own a table. `PluginContributions` offers `collections`,
 * `singles` and `fieldGroups`, and nothing else, so a collection marked
 * `internal` is the storage unit available — and it is the one the option was
 * added for, its own docblock naming "a plugin's internal records".
 *
 * Being a collection also means the schema pipeline builds and migrates it on
 * every dialect for free, which a hand-rolled table would have to reimplement
 * three times.
 *
 * ## `internal` hides it from navigation and NOTHING else
 *
 * Measured: `internal: true` sets `admin.hidden` and stops there. No API
 * routing, no dispatcher and no registry sync reads the flag, so an internal
 * collection is reachable over the Direct API and the wire API exactly like any
 * other. The access rules below are what close it, rather than a second layer
 * behind a first.
 *
 * They do not close it for everyone. `checkCollectionAccess` returns before
 * evaluating a collection's own rules when the caller is a super-admin session,
 * so a super-admin can address this slug directly and write to it. That is a
 * property of the access service rather than of this collection, and it is why
 * the rebuild exists: a row authored by hand disagrees with the document it
 * claims to describe until a rebuild replaces it.
 *
 * @module collections/class-usage-index
 */
import { defineCollection, text } from "nextly/config";

/** The slug this plugin's usage index is stored under. */
export const CLASS_USAGE_INDEX_SLUG = "nx_pb_class_usage";

/**
 * Which kind of content a row points at.
 *
 * Collections and singles are addressed differently and the difference is not
 * cosmetic, so the kind is stored rather than inferred from whether `entityKey`
 * happens to be empty.
 */
export type ClassUsageScope = "collection" | "single";

/**
 * Which of a document's two stored forms a row was read from.
 *
 * A closed set rather than free text, for the same reason `scope` is one. Both
 * are stored as text and both partition the index into subject families, so a
 * value outside the set produces rows that no query built from a real subject
 * can ever select — neither to reconcile nor to sweep. A typo does not fail, it
 * accumulates.
 */
export type ClassUsageVariant = "published" | "draft";

/** One reference: this document, through this field, uses this class. */
export interface ClassUsageRow {
  scope: ClassUsageScope;
  /** The collection's or single's slug. */
  entity: string;
  /**
   * Which document within `entity`, or empty for a single.
   *
   * A single has one document, and its ROW MAY NOT EXIST — an unedited single
   * still renders its declared defaults. So a single is addressed by its slug
   * alone, in `entity`, and this stays empty rather than holding an id that is
   * absent until somebody types.
   *
   * Kept as an empty string rather than null so the five columns form a total
   * key. Nothing in the database enforces that today — a collection's declared
   * indexes do not reach the schema pipeline, so the composite constraint this
   * key describes cannot currently be created — and it is the reconciler that
   * keeps the rows unique instead. A null here would still be wrong the day
   * that changes, because a nullable member of a uniqueness constraint compares
   * as unknown on most dialects.
   */
  entityKey: string;
  /** The blocks field the reference was found in. */
  field: string;
  /**
   * Which locale's document the reference was found in, or empty when the field
   * is not localized.
   *
   * A localized blocks field stores a DOCUMENT PER LOCALE, and each may apply a
   * different set of classes. Without this column every locale would share one
   * key, so maintaining one locale's document would remove the rows for classes
   * only another locale uses — and a class still rendered by that other locale
   * would read as unused, which is the answer that permits deleting it.
   *
   * Empty rather than null for the reason `entityKey` is: the columns have to
   * form a total key, and a nullable member of a uniqueness constraint compares
   * as unknown on most dialects.
   */
  locale: string;
  /**
   * Which stored variant of the document the reference was found in —
   * `"published"` or `"draft"`.
   *
   * A collection with drafts holds TWO documents under one id, and they can
   * apply different classes: a pure draft edit leaves the live row untouched,
   * so the published page and the pending draft disagree until it is
   * published. Without this column they share one key, and indexing either
   * removes the rows the other justifies — so a class the published page still
   * renders reads as unused because a draft dropped it.
   *
   * Both are worth counting rather than only the published one. The count
   * answers "is this class safe to delete", and deleting a class an unpublished
   * draft applies breaks that draft the moment somebody publishes it.
   */
  variant: ClassUsageVariant;
  /**
   * The named class's id, as stored in `node.classes`, or the marker id on a
   * marker row.
   *
   * A document whose references could not all be read contributes ONE row
   * carrying the marker id, rather than a row per class it managed to read. Without it, a
   * document nobody has been able to read looks exactly like one that
   * references nothing — and "references nothing" is the answer that permits
   * deleting a class the unread part of the document still applies.
   *
   * A marker row rather than a separate column, and rather than a flag on every
   * row, because the state belongs to the SUBJECT and there may be no rows to
   * carry a flag: an oversized document indexed for the first time has none.
   *
   * The marker id is longer than the engine's cap on a class id, which is what
   * makes it disjoint from every real reference. NOT the empty string: the
   * engine constrains an id by type and length only, so the empty string is a
   * usable class id and a document can genuinely reference one.
   */
  classId: string;
}

/**
 * The index collection.
 *
 * Every column is `text` deliberately. These are identifiers — slugs, ids,
 * field names — that arrive from stored documents and from a plugin's own
 * declarations, and none of them is a number, a date or a relationship this
 * plugin may assume exists. A relationship to `pages` in particular would be
 * wrong twice over: the index spans every collection that mounts a blocks
 * field, not one, and a single has no row to relate to.
 */
export function classUsageIndexCollection() {
  return defineCollection({
    slug: CLASS_USAGE_INDEX_SLUG,
    labels: { singular: "Class usage", plural: "Class usage" },
    // Bookkeeping the plugin maintains, never authored. `internal` keeps it out
    // of the admin's navigation; the access rules below are what keep it out of
    // everything else.
    internal: true,
    fields: [
      text({ name: "scope", label: "Scope" }),
      text({ name: "entity", label: "Entity" }),
      // Indexed because every maintenance pass filters on it, and it is the
      // most selective column in that filter: `scope` has two values and
      // `entity` has one per collection, while a row id is unique to its
      // document. A composite index over the whole subject would be better and
      // cannot be declared — a collection's `indexes` never reach the schema
      // pipeline, which builds a table's indexes from its FIELDS.
      text({ name: "entityKey", label: "Entity key", index: true }),
      text({ name: "field", label: "Field" }),
      text({ name: "locale", label: "Locale" }),
      text({ name: "variant", label: "Variant" }),
      // Indexed because this is the column the library filters on: the count
      // is shown beside every class, so "which documents use this one" is asked
      // once per class per render rather than once per delete. Declared on the
      // FIELD rather than as a collection-level index, which is the form the
      // schema pipeline materialises.
      text({ name: "classId", label: "Class id", index: true }),
    ],
    access: {
      // Derived from documents on every write, and rebuilt from them on demand.
      // Nothing outside this plugin has a reason to author a row, and a row
      // authored by hand would disagree with the document it claims to describe
      // until the next rebuild silently replaced it.
      //
      // Written as functions returning a constant rather than as bare `false`:
      // access rules are validated as callables, and a boolean is rejected at
      // config time rather than read as "never".
      //
      // A constant rather than a role check: an administrator editing this by hand
      // is not a privilege to grant, it is a way to make the record wrong. The
      // plugin's own maintenance runs through the Direct API, which defaults to
      // `overrideAccess: true`, so these close the wire API for an ordinary
      // caller without closing the path that maintains the rows.
      //
      // A super-admin session is not an ordinary caller and bypasses these
      // entirely; the rebuild is what repairs a table written that way.
      create: () => false,
      update: () => false,
      delete: () => false,
      // Read is closed for the same reason the rest are, and one more: the rows
      // enumerate which documents exist and what they reference, which is a map
      // of the site's content to anyone who can list them. The class library
      // reads this through the plugin, on the same overriding path.
      read: () => false,
    },
    // No webhook recording. An omitted option RECORDS — the registry reads
    // `webhooks?.record !== false`, which `undefined` satisfies — so a site
    // with an endpoint subscribed to `entry.*` receives every row this table
    // writes, carrying the full document. Access rules are not consulted for
    // outbox delivery, so the rules above do not cover this path.
    //
    // Two reasons, either sufficient. These rows enumerate which documents
    // exist and what they reference, which is a map of the site's content;
    // and reconciliation writes on every save, so recording them would put an
    // event on the outbox for each reference that changed.
    webhooks: false,
    admin: {
      description:
        "Which documents reference which named classes. Maintained automatically; editing it cannot change what any page renders.",
    },
    // A row is a fact derived from a document, not an event, and
    // `createdAt`/`updatedAt` on a derived row invite exactly the question they
    // cannot answer — when the REFERENCE appeared, which is a property of the
    // document's history rather than of this row's.
    //
    // Declared even though nothing honours it today. The schema pipeline is
    // given `{ builtBy, hasStatus, localized }` and injects both timestamp
    // columns unconditionally, and the mutation service stamps them on every
    // create, so this table carries two values per reference that mean nothing.
    // Kept rather than dropped because it is the correct statement for this
    // collection and a pipeline that learns to read it should apply it here;
    // removing it would make that future fix silently skip this table.
    timestamps: false,
  });
}
