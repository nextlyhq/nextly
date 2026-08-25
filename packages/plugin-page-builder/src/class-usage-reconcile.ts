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
import { MAX_NAMED_CLASS_NAME_LENGTH } from "@nextlyhq/blocks-engine";
import type { DocumentLimits } from "@nextlyhq/blocks-engine";

import { classUsageOf } from "./class-usage";
import type { ClassUsageRow } from "./collections/class-usage-index";

/**
 * The class id a marker row carries, chosen so no real reference can wear it.
 *
 * The engine constrains a class id by TYPE and LENGTH and nothing else —
 * `isUsableNamedClass` tests `typeof id === "string"` and
 * `id.length <= MAX_NAMED_CLASS_NAME_LENGTH`, with no pattern and no minimum.
 * So the empty string is a usable id, and a document really can reference one;
 * a marker wearing it would be indistinguishable from that reference, and a
 * lookup could not tell a class in use from a subject nobody could read.
 *
 * Exceeding the cap is therefore the ONLY way to be disjoint by construction
 * rather than by convention, because length is the only lever the rule offers.
 * A test asserts the engine rejects this value, so the day that rule changes,
 * this fails rather than silently starting to collide.
 */
export const UNDETERMINED_CLASS_ID = `undetermined:${"-".repeat(
  MAX_NAMED_CLASS_NAME_LENGTH
)}`;

/**
 * The document being described, minus the classes it references.
 *
 * DERIVED from {@link ClassUsageRow} rather than restated. The two are the same
 * four columns, and a second declaration of one shape agrees with the first on
 * the day it is written: a column added to the row would silently not be part
 * of a subject, so derivation would go on producing rows missing it.
 */
export type ClassUsageSubject = Omit<ClassUsageRow, "classId">;

/**
 * The columns that identify a subject, as values rather than as types.
 *
 * Built through a `Record` keyed by the subject's own keys, which is what makes
 * it exhaustive: a `Record<K, ...>` requires EVERY member of `K`, so adding a
 * column to {@link ClassUsageRow} fails to compile here until it is listed.
 * An array annotated `(keyof ClassUsageSubject)[]` type-checks perfectly while
 * missing a member, which is how a comparison silently stops covering one.
 */
const SUBJECT_KEYS = Object.keys({
  scope: true,
  entity: true,
  entityKey: true,
  field: true,
  locale: true,
} satisfies Record<
  keyof ClassUsageSubject,
  true
>) as (keyof ClassUsageSubject)[];

/** Whether a row describes the subject being reconciled. */
function describesSubject(
  row: ClassUsageSubject,
  subject: ClassUsageSubject
): boolean {
  return SUBJECT_KEYS.every(key => row[key] === subject[key]);
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
 * A stored row, as reconciliation needs to see it.
 *
 * Carries its subject columns rather than only what varies. An earlier shape
 * asked for `{ id, classId }` alone, on the reasoning that a caller cannot
 * misuse what it is not asked for — which is false: a caller maps its rows to
 * the narrow shape and a misbound query is exactly as wrong, only now
 * undetectable. Reconciliation issues REMOVALS, so it has to be able to refuse
 * rows that are not the subject's rather than trust that they are.
 */
export interface StoredClassUsageRow extends ClassUsageRow {
  /** The row's own id, which is what a removal names. */
  id: string;
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
    return {
      complete: false,
      undetermined: { ...subject, classId: UNDETERMINED_CLASS_ID },
    };
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
 *
 * THROWS when any row belongs to a different subject, rather than skipping it.
 * The caller supplies `stored` from a query, and a query missing or misbinding
 * one of the four subject predicates hands over another document's rows — which
 * this would otherwise report as references the subject has dropped, returning
 * their ids to be deleted. Refusing is what a guard on a destructive operation
 * owes: skipping silently would leave the misbound query in place, correcting
 * its damage invisibly on every call.
 *
 * The check is an equality over values already in hand, so it costs nothing on
 * the path where it never rejects.
 */
export function reconcileClassUsage(
  subject: ClassUsageSubject,
  derived: readonly ClassUsageRow[],
  stored: readonly StoredClassUsageRow[]
): ClassUsageReconciliation {
  for (const row of derived) {
    if (!describesSubject(row, subject)) {
      throw new Error(
        `Derived row for ${row.scope}:${row.entity}:${row.entityKey}:${row.field} ` +
          `does not describe the subject being reconciled ` +
          `(${subject.scope}:${subject.entity}:${subject.entityKey}:${subject.field}).`
      );
    }
  }
  for (const row of stored) {
    if (!describesSubject(row, subject)) {
      throw new Error(
        `Stored row ${row.id} belongs to ` +
          `${row.scope}:${row.entity}:${row.entityKey}:${row.field}, ` +
          `not to the subject being reconciled ` +
          `(${subject.scope}:${subject.entity}:${subject.entityKey}:${subject.field}).`
      );
    }
  }

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
