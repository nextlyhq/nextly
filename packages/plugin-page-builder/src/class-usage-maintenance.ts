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
 * A runaway guard on the paging loop, deliberately NOT a claim about the data.
 *
 * Two earlier shapes were wrong in opposite directions. A round number chosen
 * by eye was low enough to reject a valid document, and every later maintenance
 * then threw forever. Deriving it from the limits the document is read under
 * NOW was worse in a subtler way: a host that LOWERS `maxNodes` does not
 * shorten the rows already written under the old bound, so the guard would
 * start rejecting rows that were legitimate when they were made — and
 * `forgetClassUsage` cannot even know what the historical bound was.
 *
 * So the bound is fixed, derived from the engine's own maxima rather than from
 * anything a host can change, and generous enough that reaching it means the
 * store's paging is broken rather than that the document is large. Its job is
 * to stop an endless loop, not to police row counts.
 */
const MAX_PAGES = Math.ceil((MAX_NODES * MAX_CLASSES_PER_NODE) / PAGE_SIZE) + 1;

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
  const found: string[] = [];
  collectBlockDocumentFields(data, "", found);
  return found;
}

/**
 * Walk one record, descending into the containers a blocks field can sit in.
 *
 * A `blocks()` field declared inside a `group` or a `repeater` is a supported
 * schema, not a malformed one — core accepts contributed field types in both.
 * The value seen at the top level is then the container, so a filter reading
 * only the outer keys finds no candidate and the nested field is never
 * maintained: classes added, removed or cleared inside it leave the index
 * stale, and a class only that field renders reads as unused.
 *
 * Paths are dotted, and a repeater's entries carry their index, so two nested
 * documents under one container are distinct subjects rather than one that
 * overwrites the other.
 */
function collectBlockDocumentFields(
  value: unknown,
  prefix: string,
  found: string[]
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectBlockDocumentFields(entry, `${prefix}[${index}]`, found)
    );
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const key of Object.keys(value)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    const child = value[key];
    const verdict = classifyChild(child);
    if (verdict === "candidate") found.push(path);
    if (verdict === "container") collectBlockDocumentFields(child, path, found);
  }
}

/** What one value under a key is, to a walk looking for blocks fields. */
type ChildVerdict = "candidate" | "container" | "ignore";

/**
 * Whether a value is a field to maintain, a container to descend into, or
 * neither.
 *
 * A block document is a CANDIDATE and never a container, even though it is
 * itself a record: descending into one would report its own internals — a
 * node's null prop, say — as fields of the document.
 */
function classifyChild(child: unknown): ChildVerdict {
  // A key present with no value is a CLEAR, and a clear is exactly what has to
  // be maintained: its rows must go. An absent key never reaches here.
  if (child === null || child === undefined) return "candidate";
  if (looksLikeBlockDocument(child)) return "candidate";
  if (Array.isArray(child) || isPlainRecord(child)) return "container";
  return "ignore";
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
  const { id, entity, entityKey, field, locale, classId } = item;
  if (typeof id !== "string") return null;
  if (typeof entity !== "string") return null;
  if (typeof entityKey !== "string") return null;
  if (typeof field !== "string") return null;
  if (typeof locale !== "string") return null;
  if (typeof classId !== "string") return null;
  return { id, scope, entity, entityKey, field, locale, classId };
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
async function storedRowsWhere(
  store: ClassUsageIndexStore,
  where: Record<string, { equals: string }>,
  describe: string
): Promise<StoredClassUsageRow[]> {
  const rows: StoredClassUsageRow[] = [];
  // Bounded by PAGES REQUESTED rather than by rows collected: a store answering
  // `hasNext` forever with an empty page never grows `rows`, so a row-count
  // bound would spin without end. Termination has to depend on a counter the
  // store cannot hold still.
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await store.find({
      collection: CLASS_USAGE_INDEX_SLUG,
      where,
      limit: PAGE_SIZE,
      page,
      // Ordered by a column these writes cannot move. Offset paging reads
      // position N of an ordered set, so ordering by anything this maintenance
      // rewrites would reshuffle rows between queries and skip some.
      sort: "id",
    });
    for (const item of result.items) {
      const row = readStoredRow(item);
      if (row === null) continue;
      // Validated HERE rather than by each consumer. Every path that reads rows
      // goes on to delete some of them, and a row outside the requested
      // predicates is another document's — the misbound-query failure. Guarding
      // at the source covers reconciliation, the per-subject forget and the
      // removed-field sweep at once; guarding per consumer covered the first
      // and missed the two added after it.
      assertRowMatches(row, where, describe);
      rows.push(row);
    }
    if (!result.meta.hasNext) return rows;
  }
  // More rows than the document could have produced under the bounds it was
  // read with. Reported rather than absorbed: a partial row set reconciled
  // against reads every unread row as a reference the document has dropped.
  throw new Error(
    `Class-usage index still reported more rows after ${MAX_PAGES} pages of ` +
      `${PAGE_SIZE} for ${describe}, ` +
      `which is more than any document can reference — the store's paging is wrong.`
  );
}

/**
 * Refuse a row the query did not ask for.
 *
 * Compared against the PREDICATES rather than against a subject, so it holds
 * for a document-wide read as well as a per-subject one — the two differ in
 * which columns they bind, and a check written against a subject could not
 * express the wider query at all.
 *
 * Thrown rather than skipped. Every caller of this goes on to delete rows, so
 * silently dropping a foreign one would correct a misbound query's damage
 * invisibly on every call and nothing would ever report it.
 */
function assertRowMatches(
  row: StoredClassUsageRow,
  where: Record<string, { equals: string }>,
  describe: string
): void {
  for (const [column, predicate] of Object.entries(where)) {
    const actual = (row as unknown as Record<string, unknown>)[column];
    if (actual === predicate.equals) continue;
    throw new Error(
      `Class-usage row ${row.id} has ${column}="${String(actual)}" but the ` +
        `query asked for "${predicate.equals}" while reading ${describe}; ` +
        `the query is misbound and its rows must not be deleted.`
    );
  }
}

/** Every column that identifies one subject, as a query. */
function subjectWhere(
  subject: ClassUsageSubject
): Record<string, { equals: string }> {
  return {
    scope: { equals: subject.scope },
    entity: { equals: subject.entity },
    entityKey: { equals: subject.entityKey },
    field: { equals: subject.field },
    locale: { equals: subject.locale },
  };
}

/** How a subject reads in an error, so a refusal names what it was reading. */
function describeSubject(subject: ClassUsageSubject): string {
  return `${subject.scope}:${subject.entity}:${subject.entityKey}:${subject.field}`;
}

/** The rows the index currently holds for one subject. */
async function storedRowsFor(
  store: ClassUsageIndexStore,
  subject: ClassUsageSubject
): Promise<StoredClassUsageRow[]> {
  return storedRowsWhere(
    store,
    subjectWhere(subject),
    describeSubject(subject)
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

/**
 * Drop rows for fields the document no longer has.
 *
 * The walk over a written row reports the paths that are THERE. It cannot
 * report one that has gone: a repeater shrinking from two entries to one
 * removes `sections[1].body` from the value entirely, so no candidate names it
 * and maintenance is never invoked for it. Its rows then survive the edit, and
 * a class only that entry applied goes on reading as used — for ever, because
 * nothing will ever visit that path again.
 *
 * Answerable only against the INDEX, which is the one place the departed path
 * still exists. Every row for the document is read and any whose field is not
 * among the paths present now is removed.
 *
 * Safe because the `after*` phases carry the whole stored row rather than the
 * caller's patch — `data: entry` is the record the database returned — so
 * "not present" means the document really does not have it, rather than that
 * this particular write did not mention it. A caller handing over a PARTIAL
 * document would delete the rows of every field it omitted.
 */
export async function forgetRemovedFields(args: {
  store: ClassUsageIndexStore;
  /** The document, without the field and locale a subject also carries. */
  document: Pick<ClassUsageSubject, "scope" | "entity" | "entityKey">;
  /** Every blocks-field path the stored row holds now. */
  presentFields: readonly string[];
}): Promise<{ removed: number }> {
  const { document } = args;
  const rows = await storedRowsWhere(
    args.store,
    {
      scope: { equals: document.scope },
      entity: { equals: document.entity },
      entityKey: { equals: document.entityKey },
    },
    `${document.scope}:${document.entity}:${document.entityKey}`
  );

  const present = new Set(args.presentFields);
  let removed = 0;
  for (const row of rows) {
    if (present.has(row.field)) continue;
    await args.store.delete({ collection: CLASS_USAGE_INDEX_SLUG, id: row.id });
    removed += 1;
  }
  return { removed };
}
