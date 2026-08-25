/**
 * Turning one document into the index rows that describe it, and working out
 * what has to change for the stored rows to say the same thing.
 *
 * Split from the write path deliberately: deciding what the rows SHOULD be is a
 * question about a document, and it is answerable without a database, a
 * transaction or a hook. Everything here is a pure function over values, so the
 * hard part is tested against documents rather than against a store.
 *
 * ## Reconcile rather than replace
 *
 * The obvious maintenance is "delete this document's rows, insert the derived
 * ones". It is wrong for a table whose rows are read constantly: between the
 * delete and the insert the document appears to reference NOTHING, so a usage
 * count read in that window reports zero and a safe-delete check performed in
 * it is answered with the one value that licences the deletion. Reconciling
 * writes only the difference, so a reference that survives the edit is never
 * absent at any instant.
 *
 * It is also the cheaper shape by far in the common case: an author editing a
 * page's text changes no class references at all, and reconciliation of an
 * unchanged document issues no writes.
 *
 * ## An incomplete derivation is not a shorter one
 *
 * `classUsageOf` reads a bounded number of nodes, so a document larger than the
 * bound yields a PREFIX of its references rather than all of them. A prefix
 * must never be reconciled against, because reconciliation would remove the
 * rows for every reference past the bound — turning "we could not read it all"
 * into "it references nothing", which is the under-count direction that gets a
 * live class deleted.
 *
 * That is why {@link ClassUsageDerivation} carries no `rows` at all when it is
 * incomplete. A caller cannot reach for a list that does not exist, so the rule
 * is enforced by the type rather than remembered by each caller.
 *
 * @module class-usage-reconcile
 */
import type { DocumentLimits } from "@nextlyhq/blocks-engine";

import { classUsageOf } from "./class-usage";
import type {
  ClassUsageRow,
  ClassUsageScope,
} from "./collections/class-usage-index";

/**
 * The document being described, minus the classes it references.
 *
 * These four columns are constant for one document's rows, which is what lets
 * everything below identify a row by its `classId` alone.
 */
export interface ClassUsageSubject {
  scope: ClassUsageScope;
  /** The collection's or single's slug. */
  entity: string;
  /** The row id for a collection, or the empty string for a single. */
  entityKey: string;
  /** The blocks field the document was read from. */
  field: string;
}

/**
 * What a document's rows should be, or the fact that they could not be
 * determined.
 *
 * A discriminated union rather than a list plus a flag: the incomplete arm has
 * no `rows` member, so a caller that forgets to check cannot read a truncated
 * list. The narrowing is the control.
 *
 * It carries a single marker row instead, which is a different thing from a
 * shorter list and is written rather than skipped. Skipping preserves whatever
 * rows the subject already had, and preserves NOTHING when it has none — which
 * is the state an oversized document is in the first time anything indexes it.
 * The marker is what stops that reading as "references nothing".
 */
export type ClassUsageDerivation =
  | { complete: true; rows: ClassUsageRow[] }
  | { complete: false; undetermined: ClassUsageRow };

/**
 * Enough of a stored row to reconcile against it.
 *
 * Narrower than {@link ClassUsageRow} on purpose. The four subject columns are
 * fixed by the query that fetched these, so repeating them here would invite a
 * caller to pass rows belonging to some OTHER document — and reconciliation
 * would then read those as references this document has dropped and remove
 * them. Asking only for what varies makes that mistake harder to make.
 */
export interface StoredClassUsageRow {
  /** The row's own id, which is what a removal names. */
  id: string;
  classId: string;
}

/** The writes that bring a document's stored rows into agreement with it. */
export interface ClassUsageReconciliation {
  /** References the document has that no stored row records yet. */
  insert: ClassUsageRow[];
  /**
   * Ids of stored rows to remove: references the document no longer has, plus
   * any duplicate recording a reference another row already records.
   */
  remove: string[];
}

/**
 * The rows describing one document, or the fact that it could not be read whole.
 *
 * `classUsageOf` is total — a malformed document yields a list rather than an
 * error — so the only way this reports incompleteness is a document larger than
 * the bounds the page is rendered under.
 */
export function deriveClassUsageRows(
  subject: ClassUsageSubject,
  document: unknown,
  limits?: DocumentLimits
): ClassUsageDerivation {
  const usage = classUsageOf(document, limits);
  if (!usage.complete) {
    // The prefix it DID read is discarded rather than recorded. A partial list
    // stored as a list is indistinguishable from a complete one, and the whole
    // point of the marker is to be distinguishable.
    return { complete: false, undetermined: { ...subject, classId: "" } };
  }
  return {
    complete: true,
    rows: usage.ids.map(classId => ({ ...subject, classId })),
  };
}

/**
 * The difference between what a document references and what its stored rows
 * say it references.
 *
 * Duplicates among `stored` are resolved by keeping the first row for each
 * class; the branch below says why that is the right resolution.
 *
 * Takes derived ROWS rather than a derivation, so an incomplete read cannot be
 * reconciled: there is no value of {@link ClassUsageDerivation} whose
 * incomplete arm can be passed here.
 */
export function reconcileClassUsage(
  derived: readonly ClassUsageRow[],
  stored: readonly StoredClassUsageRow[]
): ClassUsageReconciliation {
  const wanted = new Set(derived.map(row => row.classId));
  // Which classes a SURVIVING stored row records. A class reaches this set only
  // by having a row that is both wanted and the first of its class, which is
  // what makes it the right thing to subtract the inserts from: a class whose
  // every row is being removed is absent from it, so its row is re-inserted.
  const kept = new Set<string>();
  const remove: string[] = [];

  for (const row of stored) {
    // A duplicate is not a reference held twice — a document applying one class
    // to ten nodes references it once — so a second row for a class already
    // kept is removed rather than counted.
    //
    // This is the ONLY thing keeping the rows unique. The database holds no
    // composite constraint over the key columns, because a collection's
    // declared indexes do not reach the schema pipeline, so two concurrent
    // writes to one document can both insert.
    //
    // A duplicate insert is the benign outcome, and it is NOT the only one a
    // race produces. Both writes diff against the same stored rows, so the
    // loser's diff describes a document that is no longer the live one: if it
    // commits second, its removals delete rows the winning document still
    // justifies, and the count reads LOW — the direction that permits deleting
    // a class the page renders. Reconciliation is therefore only sound when
    // the caller serialises it with the document write it derives from, or
    // re-derives from the row that won. That is a property of the write path,
    // which cannot be established here, and this comment is where it is
    // recorded rather than assumed.
    const duplicate = kept.has(row.classId);
    if (duplicate || !wanted.has(row.classId)) {
      remove.push(row.id);
      continue;
    }
    kept.add(row.classId);
  }

  return {
    insert: derived.filter(row => !kept.has(row.classId)),
    remove,
  };
}
