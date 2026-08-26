/**
 * Bringing one written document's index rows into agreement with it.
 *
 * The half that runs on every save. `class-usage-maintenance` reconciles ONE
 * subject against ONE document; this decides which subjects a save owes an
 * update to, obtains the document behind each, and reports what happened
 * without ever failing the save.
 *
 * ## Why every locale and variant is visited, not the one that changed
 *
 * The hook is not told which locale or variant was written. `_status` is
 * stripped from the payload before a hook sees it, and the write locale is
 * known at the call site and never forwarded. So "reconcile what changed" is
 * not expressible here: the only sound reading is that the document as a whole
 * may have changed, and every subject it owns is re-derived.
 *
 * That costs a read per subject on a save that touched one of them. It is the
 * price of not silently leaving a stale subject behind, and a stale subject is
 * the failure that licences deleting a class a page still renders.
 *
 * ## Why nothing here throws
 *
 * Collection `after*` hooks run AFTER the write commits. A throw would surface
 * to the caller as a failed save for a document that is already on disk, so the
 * author is told their work was lost while it was not. Every failure is
 * therefore captured and reported, never raised: an index that disagrees with a
 * document is recoverable by a rebuild, and a false error is not recoverable at
 * all.
 *
 * @module class-usage-write
 */
import type { DocumentLimits } from "@nextlyhq/blocks-engine";

import {
  blocksFieldsOf,
  type BlocksFieldsCollection,
} from "./class-usage-blocks-fields";
import {
  maintainClassUsage,
  type ClassUsageIndexStore,
} from "./class-usage-maintenance";
import type { ClassUsageSubject } from "./class-usage-reconcile";
import { classUsageSubjectsFor } from "./class-usage-subjects";

/**
 * How the caller obtains the document behind one subject.
 *
 * Injected rather than reached for, because the subject names a locale and a
 * variant and only the caller knows how its own runtime addresses those. It
 * also keeps this module testable against values.
 *
 * Answering `null` means the document does not exist in that locale and
 * variant, which is an ordinary state rather than an error — a collection with
 * drafts holds a published row for a document that has no pending draft, and a
 * localized field has no value in a locale nobody has translated yet.
 */
export interface ClassUsageDocumentReader {
  (subject: ClassUsageSubject): Promise<unknown>;
}

/** The collection a write landed on, as the host configured it. */
export interface WrittenCollectionConfig extends BlocksFieldsCollection {
  /** The collection's slug, stored as the `entity` of every row. */
  slug: string;
  /**
   * Whether this collection stores a working draft beside its published row.
   *
   * Resolved by the caller through the published draft-split question rather
   * than read from `status`, which is true for collections that keep no draft
   * at all. Guessing it wrong in either direction writes rows against a
   * document that does not exist, or omits the classes only a draft applies.
   */
  hasDrafts: boolean;
}

/** What one subject's reconciliation did, or why it did nothing. */
export interface ClassUsageSubjectOutcome {
  subject: ClassUsageSubject;
  inserted: number;
  removed: number;
  /** True when the document could not be read whole and a marker was written. */
  undetermined: boolean;
  /** Absent on success. Present, and the subject is unchanged, on failure. */
  failure?: unknown;
  /** True when no document exists in this locale and variant. */
  absent: boolean;
}

/** What a whole save did to the index. */
export interface ClassUsageWriteReport {
  /** Every subject the document owns, whether or not it changed. */
  subjects: number;
  /** Subjects whose rows were brought into agreement with a document. */
  reconciled: number;
  /** Subjects with no document in that locale and variant. */
  absent: number;
  /**
   * Subjects that failed.
   *
   * Non-empty means the index disagrees with the document for those subjects
   * until a rebuild runs. It never means the save failed.
   */
  failures: ClassUsageSubjectOutcome[];
  /** Per-subject detail, in enumeration order. */
  outcomes: ClassUsageSubjectOutcome[];
}

/**
 * Reconcile every subject a written document owns.
 *
 * Returns an empty report for the collections this index does not track, which
 * is most of them: `blocksFieldsOf` finds no field, so the document owns no
 * subject and nothing is read. That filter reads the collection configuration
 * passed in rather than a list captured when the plugin was wired, so a
 * collection created after that moment is tracked rather than missed.
 *
 * A failure against one subject does not stop the others. Each subject's rows
 * are independent, and stopping would leave the subjects after the failure
 * stale as well as the one that failed — turning one recoverable disagreement
 * into several for no gain, since reconciliation is idempotent and a rerun
 * repairs whatever this pass could not.
 */
export async function reconcileWrittenDocument(args: {
  store: ClassUsageIndexStore;
  read: ClassUsageDocumentReader;
  collection: WrittenCollectionConfig;
  /** The written document's id, stored as `entityKey`. */
  documentId: string;
  /** The site's configured locales, or empty when localization is off. */
  locales: readonly string[];
  /** The bounds the rows are derived under. Required, never defaulted here. */
  limits: DocumentLimits;
}): Promise<ClassUsageWriteReport> {
  // No early return for an untracked collection, deliberately. `blocksFieldsOf`
  // answers `[]` for one, `classUsageSubjectsFor` answers `[]` for no fields,
  // and the loop below then does nothing — so a guard here would be a branch
  // with no behaviour of its own, unreachable by any test that could tell it
  // from its absence.
  const fields = blocksFieldsOf(args.collection);
  const subjects = classUsageSubjectsFor({
    collection: args.collection.slug,
    entityKey: args.documentId,
    fields,
    locales: args.locales,
    hasDrafts: args.collection.hasDrafts,
  });

  const outcomes: ClassUsageSubjectOutcome[] = [];

  for (const subject of subjects) {
    outcomes.push(await reconcileOne(args, subject));
  }

  return {
    subjects: subjects.length,
    reconciled: outcomes.filter(o => o.failure === undefined && !o.absent)
      .length,
    absent: outcomes.filter(o => o.absent).length,
    failures: outcomes.filter(o => o.failure !== undefined),
    outcomes,
  };
}

/**
 * One subject, with every failure captured rather than raised.
 *
 * The read and the reconciliation are caught together deliberately. Both fail
 * the same way from here — the subject is left holding whatever it held — and
 * separating them would suggest a caller could respond to one differently,
 * which after the write has committed it cannot.
 */
async function reconcileOne(
  args: {
    store: ClassUsageIndexStore;
    read: ClassUsageDocumentReader;
    limits: DocumentLimits;
  },
  subject: ClassUsageSubject
): Promise<ClassUsageSubjectOutcome> {
  try {
    const document = await args.read(subject);
    // An absent document is left ALONE rather than reconciled against nothing.
    // Reconciling would delete the subject's rows, and absence here does not
    // mean the document was deleted: a read can answer null for a locale nobody
    // has translated or a draft that was never started, and for a document
    // whose read failed in a way the reader chose to report as absence. The
    // sweep in the rebuild is what removes rows for documents that are really
    // gone, because it can tell those apart and this cannot.
    if (document === null || document === undefined) {
      return {
        subject,
        inserted: 0,
        removed: 0,
        undetermined: false,
        absent: true,
      };
    }

    const report = await maintainClassUsage({
      store: args.store,
      subject,
      document,
      limits: args.limits,
    });

    return {
      subject,
      inserted: report.inserted,
      removed: report.removed,
      undetermined: report.undetermined,
      absent: false,
    };
  } catch (failure) {
    return {
      subject,
      inserted: 0,
      removed: 0,
      undetermined: false,
      absent: false,
      failure,
    };
  }
}
