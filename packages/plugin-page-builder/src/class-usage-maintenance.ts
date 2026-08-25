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
 * already landed. So a failure is REPORTED and swallowed, and the rebuild is
 * what repairs the record.
 *
 * That is not the same as the event bus, which was rejected for this job: an
 * event handler's failure is never surfaced to anybody, while this one reaches
 * the host's logger with the subject that failed.
 *
 * ## Why the document is RE-READ rather than taken from the hook
 *
 * The hook is handed the row this operation wrote. Two writes to one document
 * can interleave, and the one that wrote second is the one the site now serves —
 * so a hook deriving from its own operation's data can write rows describing a
 * document that is no longer live, and reconciliation would then remove the rows
 * the live document justifies. Reading the row back makes whichever hook runs
 * last derive from whatever actually won, so the two converge instead of
 * fighting.
 *
 * It does not make the pair atomic, and nothing available here can: the write
 * has committed and this is a second statement against a different table. What
 * it removes is the stale-derivation class of that race, leaving only the
 * narrow window where a hook's read precedes a commit its own write then
 * follows — and the rebuild covers that.
 *
 * @module class-usage-maintenance
 */
import { isPlainRecord } from "@nextlyhq/blocks-engine";
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
 * A guard against a store whose paging never reports an end.
 *
 * Sized so that reaching it means the response is wrong rather than that one
 * document references an implausible number of classes: the engine caps a
 * node's class list and the document's node count, so a real subject's row
 * count is bounded far below this.
 */
const MAX_PAGES = 100;

/** Whether a stored value could be a block document at all. */
export function looksLikeBlockDocument(value: unknown): boolean {
  const document = readStoredJson(value);
  return isPlainRecord(document) && Array.isArray(document.nodes);
}

/**
 * The fields of a written row that hold something shaped like a block document.
 *
 * A cheap, deliberately NON-authoritative filter. A global hook sees every write
 * in the application — logins, uploads, audit rows — and almost none of them can
 * hold a block tree; this rejects those in memory, without consulting the
 * configuration, so the common path costs one walk over the row's own keys.
 *
 * It is allowed to say yes about a field that is not a blocks field, because
 * the caller confirms against the declared field types before deriving. It must
 * not say no about one that is: a false negative here silently stops indexing a
 * real document, which is the under-count direction. That is why the test is
 * the same one `classUsageOf` applies to decide it can read a document at all,
 * rather than a narrower guess about what a block tree looks like.
 */
export function blockDocumentFields(data: unknown): string[] {
  if (!isPlainRecord(data)) return [];
  return Object.keys(data).filter(key => looksLikeBlockDocument(data[key]));
}

/** The rows the index currently holds for one subject. */
async function storedRowsFor(
  store: ClassUsageIndexStore,
  subject: ClassUsageSubject
): Promise<StoredClassUsageRow[]> {
  const rows: StoredClassUsageRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
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
    });
    for (const item of result.items) {
      // A row this cannot read an id out of is skipped rather than counted.
      // Persisted data arrives unvalidated, and one unreadable row must not
      // stop the subject being reconciled — but it is also not something to
      // silently delete, since nothing here knows what it is.
      if (!isPlainRecord(item)) continue;
      if (typeof item.id !== "string") continue;
      if (typeof item.classId !== "string") continue;
      rows.push({ ...subject, id: item.id, classId: item.classId });
    }
    if (!result.meta.hasNext) return rows;
  }
  // The store said there was more after the guard ran out. Reported rather than
  // absorbed: a partial row set reconciled against would read every unread row
  // as a reference the document has dropped, and delete it.
  throw new Error(
    `Class-usage index returned more than ${MAX_PAGES} pages of ${PAGE_SIZE} for ` +
      `${subject.scope}:${subject.entity}:${subject.entityKey}:${subject.field}.`
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

  const stored = await storedRowsFor(store, subject);
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
}): Promise<{ removed: number }> {
  const stored = await storedRowsFor(args.store, args.subject);
  for (const row of stored) {
    await args.store.delete({
      collection: CLASS_USAGE_INDEX_SLUG,
      id: row.id,
    });
  }
  return { removed: stored.length };
}
