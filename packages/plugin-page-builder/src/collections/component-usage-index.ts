/**
 * Where the record of "which documents embed which component" lives.
 *
 * One row per reference: a page embedding three components contributes three
 * rows. The question the library asks is "which documents use THIS component",
 * and a row per pair answers it with a lookup rather than a scan over every
 * stored document — which is what makes "used on N pages" affordable beside
 * every tile at once, rather than once per delete.
 *
 * Everything about the SUBJECT half — why a scope is stored rather than
 * inferred, why `entityKey` and `locale` are empty strings rather than null,
 * why the draft and published variants are counted separately — is the shared
 * `UsageSubject` and is documented there. This file carries only what is this
 * index's own.
 *
 * ## Why a second collection rather than a `kind` column on the class index
 *
 * The two record different things about the same documents, and deleting a
 * class and deleting a component are different jobs with different blast
 * radii. One table would make a defect in either sweep able to remove the
 * other's rows. Design section 6.2 names `nx-pb-component-usage` for this
 * reason, and the machinery is shared instead — which is where sharing
 * belongs, since it is the RULES that are common and not the records.
 *
 * @module collections/component-usage-index
 */
import { defineCollection, text } from "nextly/config";

import type { UsageSubject } from "../usage-index";

/** The slug this plugin's component index is stored under. */
export const COMPONENT_USAGE_INDEX_SLUG = "nx_pb_component_usage";

/**
 * What a row IS: a reference the document holds, or the record that the
 * document could not be read whole.
 *
 * A COLUMN rather than a sentinel id, and this is the one place the component
 * index cannot copy the class one. A class marker is disjoint by LENGTH —
 * `UNDETERMINED_CLASS_ID` exceeds the cap a class id is held to, and length is
 * the only lever the rule offers. A component id has no such lever: the
 * validator asks only that it be a nonempty string, so EVERY nonempty string
 * is a legal reference and the sole value disjoint from all of them is the
 * empty string — which is exactly what a reader takes for "no reference at
 * all", making it the worst available way to say "I could not read this".
 *
 * Saying what the row is, in its own column, keeps `componentId` free to hold
 * whatever the document held.
 */
export type ComponentUsageKind = "reference" | "unreadable";

/** One row: this document, through this field, embeds this component. */
export type ComponentUsageRow = UsageSubject & {
  kind: ComponentUsageKind;
  /**
   * The component definition's id, as stored in the instance node's
   * `props.componentId` — or empty on an `"unreadable"` row, where there is no
   * reference to name.
   *
   * Empty rather than absent for the reason every other column is: the values
   * form a total key, and a nullable member of a uniqueness constraint
   * compares as unknown on most dialects. Nothing here relies on the empty
   * string being distinguishable from a real id, because `kind` is what
   * distinguishes them.
   */
  componentId: string;
};

/**
 * The index collection.
 *
 * Every column is `text`, as the class index's are and for the same reason:
 * these are identifiers arriving from stored documents, and none of them is a
 * number, a date, or a relationship this plugin may assume exists. A
 * relationship to `pages` in particular would be wrong twice over — the index
 * spans every collection that mounts a blocks field, and a single has no row
 * to relate to.
 */
export function componentUsageIndexCollection() {
  return defineCollection({
    slug: COMPONENT_USAGE_INDEX_SLUG,
    labels: { singular: "Component usage", plural: "Component usage" },
    // Bookkeeping the plugin maintains, never authored. `internal` keeps it out
    // of the admin's navigation and nothing else — measured on the class index,
    // it sets `admin.hidden` and stops there — so the access rules below are
    // what keep it out of everything else.
    internal: true,
    fields: [
      text({ name: "scope", label: "Scope" }),
      text({ name: "entity", label: "Entity" }),
      // Indexed because every maintenance pass filters on it and it is the most
      // selective column in that filter: `scope` has two values and `entity`
      // one per collection, while a document id is unique. A composite index
      // over the whole subject would be better and cannot be declared — a
      // collection's `indexes` never reach the schema pipeline, which builds a
      // table's indexes from its FIELDS.
      text({ name: "entityKey", label: "Entity key", index: true }),
      text({ name: "field", label: "Field" }),
      text({ name: "locale", label: "Locale" }),
      text({ name: "variant", label: "Variant" }),
      text({ name: "kind", label: "Kind" }),
      // Indexed because this is the column the library filters on: the count is
      // shown beside every component tile, so "which documents use this one" is
      // asked once per component per render. Declared on the FIELD rather than
      // as a collection-level index, which is the form the pipeline
      // materialises.
      text({ name: "componentId", label: "Component id", index: true }),
    ],
    access: {
      // Derived from documents on every write and rebuilt from them on demand.
      // Nothing outside this plugin has a reason to author a row, and one
      // authored by hand would disagree with the document it claims to describe
      // until a rebuild replaced it.
      //
      // Functions returning a constant rather than bare `false`: access rules
      // are validated as callables, and a boolean is rejected at config time
      // rather than read as "never". The plugin's own maintenance runs through
      // the Direct API, which overrides access, so these close the wire API
      // without closing the path that maintains the rows. A super-admin session
      // bypasses them entirely; the rebuild is what repairs a table written
      // that way.
      create: () => false,
      update: () => false,
      delete: () => false,
      // Read is closed for that reason and one more: the rows enumerate which
      // documents exist and what they embed, which is a map of the site's
      // content to anyone who can list them.
      read: () => false,
    },
    // No webhook recording. An omitted option RECORDS — the registry reads
    // `webhooks?.record !== false` — so a site with an endpoint subscribed to
    // `entry.*` would receive every row this table writes, and access rules are
    // not consulted for outbox delivery. Reconciliation writes on every save,
    // so recording would also put an event on the outbox per changed reference.
    webhooks: false,
    admin: {
      description:
        "Which documents embed which components. Maintained automatically; editing it cannot change what any page renders.",
    },
    // A row is a fact derived from a document, not an event. `createdAt` and
    // `updatedAt` invite exactly the question they cannot answer — when the
    // REFERENCE appeared, which is a property of the document's history rather
    // than of this row's. Declared even though the pipeline injects both
    // columns regardless, because it is the correct statement for this
    // collection and a pipeline that learns to read it should apply it here.
    timestamps: false,
  });
}
