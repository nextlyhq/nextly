/**
 * Keeping the class-usage index in agreement with the documents it describes.
 *
 * The index answers "which documents reference this class" as a lookup rather
 * than a scan, which is only worth anything if it is current. This is what makes
 * it current: on every write to a document that can hold a block tree, derive
 * the rows that document should have and apply the difference.
 *
 * ## Why this runs AFTER the write, and why it does not throw
 *
 * A collection's row id does not exist until the insert has happened — nothing
 * on the create path assigns one before `beforeChange` — so a pre-write phase
 * cannot name the document it would be indexing. The `after*` phases can.
 *
 * They run POST-COMMIT: `committedWrite` is set before `afterCreate` is
 * executed, so the author's document is already saved by the time this runs.
 * That decides the failure policy. Throwing here cannot roll the document back;
 * it would report a failed save for a save that succeeded, which is the most
 * confusing direction a failure can take — an author would retry a write that
 * already landed. So a failure is REPORTED and swallowed.
 *
 * A swallowed failure needs something that repairs the record, and there is no
 * such thing for this table yet: `rebuildClassUsage` walks pages and rewrites
 * the legacy per-page `usedClasses` column, and never reads or writes
 * `nx_pb_class_usage`. Until an index rebuild exists, a failed write here
 * leaves the subject stale until its document is next saved. The write path
 * must not be wired on the strength of a repair that has not been built.
 *
 * That is not the same as the event bus, which was rejected for this job: an
 * event handler's failure is never surfaced to anybody, while this one reaches
 * the host's logger with the subject that failed.
 *
 * ## Why the document is RE-READ rather than taken from the hook
 *
 * The hook is handed the row its own operation wrote. Two writes to one
 * document can interleave, and the one that wrote second is the one the site
 * now serves — so a hook deriving from its own operation's data can write rows
 * describing a document that is no longer live. Reading the row back at least
 * derives from whatever is stored at that moment.
 *
 * It does NOT make concurrent writes converge, and this module must not be read
 * as claiming so. Starting from rows {a,b}: hook A can read live revision {a}
 * before hook B commits {b}; both then read the same index and independently
 * plan to remove the other's class; if both removals land after B commits, the
 * live document uses `b` and neither row remains. That is an under-count, which
 * is the direction safe-delete reads as permission.
 *
 * Nothing available here closes that. Reconciliation is sound only when its
 * CALLER serialises it per subject, or re-checks the document revision before
 * applying removals — a property of the write path, recorded here because this
 * is where the diff is computed and where the assumption would otherwise be
 * made silently.
 *
 * @module class-usage-maintenance
 */
import {
  MAX_CLASSES_PER_NODE,
  MAX_NODES,
  isPlainRecord,
} from "@nextlyhq/blocks-engine";
import type { DocumentLimits } from "@nextlyhq/blocks-engine";

import {
  deriveClassUsageRows,
  reconcileClassUsage,
  type ClassUsageSubject,
  type StoredClassUsageRow,
} from "./class-usage-reconcile";
import {
  CLASS_USAGE_INDEX_SLUG,
  type ClassUsageRow,
  type ClassUsageScope,
} from "./collections/class-usage-index";
import { readStoredJson } from "./stored-json";

/**
 * The store operations maintenance needs, declared structurally.
 *
 * Not the generated Direct API types, for the same reason `PageUsageStore` is
 * not: those describe the HOST app's collections, which may not have been
 * generated when this plugin is wired. The index collection is this plugin's
 * own to know.
 */
export interface ClassUsageIndexStore {
  find(args: {
    collection: string;
    where: Record<string, { equals: string }>;
    limit: number;
    page: number;
    /**
     * Required, and it must be a column the writes here cannot move.
     *
     * These are OFFSET queries, and the query service emits `ORDER BY` only
     * when a sort is supplied — so without one, successive pages have no
     * guaranteed order and a row can be skipped or returned twice. A skipped
     * row reads as a reference the document has dropped and is deleted; a
     * repeated one reads as a duplicate and is also deleted.
     */
    sort: string;
  }): Promise<{ items: unknown[]; meta: { hasNext: boolean } }>;
  create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<unknown>;
  delete(args: { collection: string; id: string }): Promise<unknown>;
}

/** How many index rows one query asks for. */
const PAGE_SIZE = 200;

/**
 * The most rows one subject can legitimately have, derived from the bounds the
 * document was read under.
 *
 * A fixed page ceiling was wrong here, and wrong in the direction that breaks a
 * valid site: a document may hold `maxNodes` nodes and each node contributes up
 * to `MAX_CLASSES_PER_NODE` references, so a legitimate subject can produce far
 * more rows than any round number chosen by eye. Once its first pass wrote more
 * than that ceiling, every later maintenance and every deletion would reach the
 * guard and throw, leaving the subject permanently stale.
 *
 * Derived from the SAME limits the document was read under, so it cannot
 * disagree with what the reader was allowed to produce — a host that raises
 * `maxNodes` raises this with it. The `+ 1` is the marker row, which is not a
 * node's reference and is written when no node's reference could be read.
 */
function maxRowsForSubject(limits: DocumentLimits | undefined): number {
  return (limits?.maxNodes ?? MAX_NODES) * MAX_CLASSES_PER_NODE + 1;
}

/** Whether a stored value could be a block document at all. */
export function looksLikeBlockDocument(value: unknown): boolean {
  const document = readStoredJson(value);
  return isPlainRecord(document) && Array.isArray(document.nodes);
}

/**
 * The fields of a written row that this write could have changed the classes of.
 *
 * A cheap, deliberately NON-authoritative filter. A global hook sees every write
 * in the application — logins, uploads, audit rows — and almost none of them can
 * hold a block tree; this rejects those in memory, without consulting the
 * configuration, so the common path costs one walk over the row's own keys.
 *
 * It names two things, and the second is not an afterthought. A field holding
 * something document-shaped is the obvious case. A field whose KEY is present
 * with no value is a field this write CLEARED — `null` and `undefined` are both
 * accepted values for a blocks field — and it has to be named for exactly the
 * reason the first case does: its old rows must go. A filter that recognised
 * only documents would leave a cleared field's references in place, so the
 * document would go on appearing to use every class it had before being
 * emptied, and none of them could ever be deleted.
 *
 * A key that is ABSENT is not a clear. It means this write said nothing about
 * that field, so the stored document stands and its rows are still correct.
 *
 * It is allowed to say yes about a field that is not a blocks field, because
 * the caller confirms against the declared field types before deriving. It must
 * not say no about one that is: a false negative silently stops maintaining a
 * real document, which is the under-count direction.
 */
export function blockDocumentFields(data: unknown): string[] {
  if (!isPlainRecord(data)) return [];
  return Object.keys(data).filter(key => {
    const value = data[key];
    if (value === null || value === undefined) return true;
    return looksLikeBlockDocument(value);
  });
}

/** Whether a stored value is one of the two scopes a row may carry. */
function readScope(value: unknown): ClassUsageScope | null {
  return value === "collection" || value === "single" ? value : null;
}

/**
 * One stored row, or null when it cannot be read as one.
 *
 * Every column comes from the ROW. Stamping the expected subject onto whatever
 * came back would make `reconcileClassUsage`'s mismatch guard unfalsifiable —
 * that guard exists to catch a query which misbound one of the four predicates,
 * and overwriting the evidence is exactly the operation that hides it.
 *
 * A row missing a column is SKIPPED rather than counted or deleted. Persisted
 * data arrives unvalidated, one unreadable row must not stop the subject being
 * reconciled, and nothing here knows enough about it to remove it.
 */
function readStoredRow(item: unknown): StoredClassUsageRow | null {
  if (!isPlainRecord(item)) return null;
  const scope = readScope(item.scope);
  if (scope === null) return null;
  const { id, entity, entityKey, field, classId } = item;
  if (typeof id !== "string") return null;
  if (typeof entity !== "string") return null;
  if (typeof entityKey !== "string") return null;
  if (typeof field !== "string") return null;
  if (typeof classId !== "string") return null;
  return { id, scope, entity, entityKey, field, classId };
}

/**
 * The rows the index currently holds for one subject.
 *
 * Every column is read from the ROW rather than stamped from the subject, and
 * that is the whole point. Spreading the expected subject onto each row would
 * make `reconcileClassUsage`'s mismatch guard unfalsifiable — the guard exists
 * to catch a query that misbound one of the four predicates, and stamping the
 * expected values onto whatever came back is precisely the operation that hides
 * that. Its removals would then delete another document's rows.
 */
async function storedRowsFor(
  store: ClassUsageIndexStore,
  subject: ClassUsageSubject,
  limits: DocumentLimits | undefined
): Promise<StoredClassUsageRow[]> {
  const rows: StoredClassUsageRow[] = [];
  const ceiling = maxRowsForSubject(limits);
  // Bounded by PAGES REQUESTED rather than by rows collected, and the
  // difference is the whole termination argument: a store answering `hasNext`
  // forever with an empty page never grows `rows`, so a row-count bound would
  // spin without end. The page count is derived from the row ceiling, so it is
  // still large enough for anything a document under these limits can produce.
  const maxPages = Math.ceil(ceiling / PAGE_SIZE) + 1;
  for (let page = 1; page <= maxPages; page++) {
    const result = await store.find({
      collection: CLASS_USAGE_INDEX_SLUG,
      where: {
        scope: { equals: subject.scope },
        entity: { equals: subject.entity },
        entityKey: { equals: subject.entityKey },
        field: { equals: subject.field },
      },
      limit: PAGE_SIZE,
      page,
      // Ordered by a column these writes cannot move. Offset paging reads
      // position N of an ordered set, so ordering by anything this maintenance
      // rewrites would reshuffle rows between queries and skip some.
      sort: "id",
    });
    for (const item of result.items) {
      const row = readStoredRow(item);
      if (row !== null) rows.push(row);
    }
    if (!result.meta.hasNext) return rows;
  }
  // More rows than the document could have produced under the bounds it was
  // read with. Reported rather than absorbed: a partial row set reconciled
  // against reads every unread row as a reference the document has dropped.
  throw new Error(
    `Class-usage index still reported more rows after ${maxPages} pages of ` +
      `${PAGE_SIZE} for ` +
      `${subject.scope}:${subject.entity}:${subject.entityKey}:${subject.field}, ` +
      `which exceeds the ${ceiling} a document under these limits can reference.`
  );
}

/** What one subject's maintenance did, in the terms a caller can report. */
export interface ClassUsageMaintenanceReport {
  inserted: number;
  removed: number;
  /** True when the document could not be read whole and a marker was written. */
  undetermined: boolean;
}

/**
 * Bring one subject's index rows into agreement with its document.
 *
 * The document is passed in rather than read here, so the caller decides which
 * revision is authoritative — and so this stays testable against values.
 */
export async function maintainClassUsage(args: {
  store: ClassUsageIndexStore;
  subject: ClassUsageSubject;
  document: unknown;
  limits?: DocumentLimits;
}): Promise<ClassUsageMaintenanceReport> {
  const { store, subject } = args;
  const derivation = deriveClassUsageRows(subject, args.document, args.limits);

  // An incomplete read contributes its marker and nothing else. Reconciling
  // against the prefix it managed to read would remove the rows for every
  // reference past the bound, which is the answer that licences deleting a
  // class the document still applies.
  const derived: ClassUsageRow[] = derivation.complete
    ? derivation.rows
    : [derivation.undetermined];

  const stored = await storedRowsFor(store, subject, args.limits);
  const { insert, remove } = reconcileClassUsage(subject, derived, stored);

  // Inserts before removals. Between the two statements the index reports the
  // subject as referencing both what it did and what it now does — an
  // over-count, which warns about a delete that was safe. The other ordering
  // reports it as referencing neither, which permits one that was not.
  for (const row of insert) {
    await store.create({
      collection: CLASS_USAGE_INDEX_SLUG,
      data: { ...row },
    });
  }
  for (const id of remove) {
    await store.delete({ collection: CLASS_USAGE_INDEX_SLUG, id });
  }

  return {
    inserted: insert.length,
    removed: remove.length,
    undetermined: !derivation.complete,
  };
}

/**
 * Drop every row describing a subject, for a document that no longer exists.
 *
 * Without this a deleted page's references outlive it, and a class it was the
 * only user of can never be deleted — the count never reaches zero and the
 * author is warned about documents that are gone.
 */
export async function forgetClassUsage(args: {
  store: ClassUsageIndexStore;
  subject: ClassUsageSubject;
  /** The same bounds the document was indexed under, which bound its row count. */
  limits?: DocumentLimits;
}): Promise<{ removed: number }> {
  const stored = await storedRowsFor(args.store, args.subject, args.limits);
  for (const row of stored) {
    await args.store.delete({
      collection: CLASS_USAGE_INDEX_SLUG,
      id: row.id,
    });
  }
  return { removed: stored.length };
}
