/**
 * Where the record of "which documents use which variable" lives.
 *
 * A variable is a design token, and a document uses one by storing its
 * identity in a `$token` reference inside a block's styles or the document's
 * own `settings.styles`. One row per reference: a page using three variables
 * contributes three rows, so "which documents use THIS variable" is a lookup
 * rather than a walk over every stored document, which is what lets the
 * Variables panel show a count beside every variable and lets a removal ask
 * the question cheaply before it reads the documents themselves.
 *
 * Everything about the SUBJECT half is the shared `UsageSubject` and is
 * documented there; this file carries only what is this index's own. A third
 * collection rather than a column on the class index, for the reason the
 * component index gives: deleting a class and deleting a variable are
 * different jobs, and one table would let a defect in either sweep remove the
 * other's rows.
 *
 * @module collections/token-usage-index
 */
import { defineCollection, text, type CollectionConfig } from "nextly/config";

import type { UsageSubject } from "../usage-index";

/** The slug this plugin's variable usage index is stored under. */
export const TOKEN_USAGE_INDEX_SLUG = "nx_pb_token_usage";

/** One row: this document, through this field, uses this variable. */
export type TokenUsageRow = UsageSubject & {
  /**
   * The variable's identity as the document stores it in `$token` (the
   * token's `id`, else its name), or the marker `UNDETERMINED_TOKEN_ID` on the
   * row recording that the document could not be read whole.
   *
   * The marker shares the column because it is disjoint by LENGTH: it is
   * longer than any identity the engine writes, and the derivation records no
   * identity longer than that, so no real reference can wear it.
   */
  tokenId: string;
};

/**
 * The index collection: every column `text`, internal, closed to every
 * caller, with no webhook recording and no timestamps, as the class and
 * component indexes are and for the reasons their collections give.
 */
export function tokenUsageIndexCollection(): CollectionConfig {
  return defineCollection({
    slug: TOKEN_USAGE_INDEX_SLUG,
    labels: { singular: "Variable usage", plural: "Variable usage" },
    // Bookkeeping the plugin maintains, never authored: kept out of the
    // admin's navigation, and the access rules below keep it out of the rest.
    internal: true,
    fields: [
      text({ name: "scope", label: "Scope" }),
      text({ name: "entity", label: "Entity" }),
      // Indexed because every maintenance pass filters on it, and it is the
      // most selective column of the subject.
      text({ name: "entityKey", label: "Entity key", index: true }),
      text({ name: "field", label: "Field" }),
      text({ name: "locale", label: "Locale" }),
      text({ name: "variant", label: "Variant" }),
      // Indexed because this is the column the Variables panel and a removal
      // filter on: "which documents use this variable" is asked per variable.
      text({ name: "tokenId", label: "Variable", index: true }),
    ],
    access: {
      // Derived from documents on every write and rebuilt from them on
      // demand; a row authored by hand would disagree with its document. The
      // plugin maintains the rows through the Direct API, which overrides
      // access, so these close the wire API alone. Read is closed too: the
      // rows map which documents exist and what they use.
      create: () => false,
      update: () => false,
      delete: () => false,
      read: () => false,
    },
    // No webhook recording: an omitted option records, and reconciliation
    // writes on every save, so each changed reference would reach the outbox.
    webhooks: false,
    admin: {
      description:
        "Which documents use which variables. Maintained automatically; editing it cannot change what any page renders.",
    },
    // A row is a fact derived from a document, not an event.
    timestamps: false,
  });
}
