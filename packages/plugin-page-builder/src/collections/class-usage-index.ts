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
 * other. The access rules below are therefore the ONLY thing keeping this
 * private, rather than a second layer behind a first.
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
 * The columns that together identify one reference.
 *
 * Named once and used by both the uniqueness constraint and the type, so the
 * key cannot be widened in one and left alone in the other — the failure that
 * leaves a constraint enforcing a key nobody means any more.
 */
export const CLASS_USAGE_KEY_FIELDS = [
  "scope",
  "entity",
  "entityKey",
  "field",
  "classId",
] as const;

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
   * key: a nullable member of a uniqueness constraint compares as unknown on
   * most dialects, which would let duplicate rows through exactly where the
   * index needs them not to.
   */
  entityKey: string;
  /** The blocks field the reference was found in. */
  field: string;
  /** The named class's id, as stored in `node.classes`. */
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
      text({ name: "entityKey", label: "Entity key" }),
      text({ name: "field", label: "Field" }),
      text({ name: "classId", label: "Class id" }),
    ],
    indexes: [
      {
        // What makes reconciliation idempotent rather than merely intended. The
        // maintenance path derives a document's rows and writes the ones that
        // are missing, so a save applied twice — a retry, a concurrent write,
        // a rebuild racing an edit — must be unable to leave two rows saying
        // the same thing. Without this the duplicate is invisible: nothing
        // reads a row's identity, so the library would just report a class as
        // used in more places than it is, and the number would drift upward
        // with every retry the site ever performs.
        fields: [...CLASS_USAGE_KEY_FIELDS],
        unique: true,
        name: "nx_pb_class_usage_reference_unique",
      },
      {
        // The read this table exists to serve: given a class, which documents
        // reference it. Without an index that question scans every row, which
        // is the cost the whole design was chosen to avoid — the count is shown
        // ambiently beside every class in the library, so it is asked once per
        // class per render rather than once per delete.
        //
        // `classId` leads because it is the column the question filters on, and
        // `scope` follows so a caller narrowing to one kind of content reads
        // the index rather than the rows behind it.
        fields: ["classId", "scope"],
        name: "nx_pb_class_usage_by_class_idx",
      },
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
      // `overrideAccess: true`, so these close the wire API without closing the
      // path that maintains the rows.
      create: () => false,
      update: () => false,
      delete: () => false,
      // Read is closed for the same reason the rest are, and one more: the rows
      // enumerate which documents exist and what they reference, which is a map
      // of the site's content to anyone who can list them. The class library
      // reads this through the plugin, on the same overriding path.
      read: () => false,
    },
    admin: {
      description:
        "Which documents reference which named classes. Maintained automatically; editing it cannot change what any page renders.",
    },
    // No timestamps. A row is a fact derived from a document, not an event, and
    // `createdAt`/`updatedAt` on a derived row invite exactly the question they
    // cannot answer — when the REFERENCE appeared, which is a property of the
    // document's history rather than of this row's.
    timestamps: false,
  });
}
