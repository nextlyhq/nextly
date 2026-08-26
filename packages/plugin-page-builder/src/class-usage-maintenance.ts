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
 * A swallowed failure needs something that repairs the record, and
 * `rebuildClassUsageIndex` is it — a walk over a collection's documents that
 * brings each one's rows back into agreement. It is exported from the package,
 * so a host can run it.
 *
 * Its reach is narrower than "the index", and the write path should be wired
 * knowing that rather than assuming a total repair. It rebuilds one
 * collection, one field, one locale and one variant per invocation, so rows
 * whose subject names a collection that no longer exists, or whose columns a
 * restore corrupted, are unreachable by every query it makes. Singles have no
 * rebuild at all, because a plugin has no supported way to read a Single's
 * document.
 *
 * Note that the LEGACY `rebuildClassUsage` is a different thing: it rewrites
 * the per-page `usedClasses` column and never touches `nx_pb_class_usage`.
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
  type ClassUsageScope,
  type ClassUsageVariant,
} from "./collections/class-usage-index";
import { walkPages } from "./paged-walk";
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
 * A runaway guard on the paging loop, and NOT a claim about the data.
 *
 * Three earlier shapes were each wrong, and each was wrong the same way: it
 * tried to make the bound MEAN something about how many rows a subject should
 * have. A round number chosen by eye rejected a valid document. Deriving it
 * from the current limits rejected rows written under different limits.
 * Budgeting two row sets rejected a subject that had accumulated more, because
 * repeated failed removals stack another set each time and the next pass does
 * not necessarily clear the pair.
 *
 * Every one of those rejected the state the walk existed to repair, and the
 * rejection is permanent: once a subject is past the bound, maintenance throws
 * before reaching the reconciler that would have cleared it.
 *
 * So the bound expresses nothing about rows. It is a flat, generous ceiling
 * whose only job is to stop an unterminated loop, matching the one the
 * document walk already uses, and reaching it is evidence about the STORE
 * rather than about the site.
 */
const MAX_PAGES = 10_000;

/** Whether a stored value could be a block document at all. */
export function looksLikeBlockDocument(value: unknown): boolean {
  const document = readStoredJson(value);
  return isPlainRecord(document) && Array.isArray(document.nodes);
}

/** The columns of a stored row that must each be a string. */
const ROW_STRING_COLUMNS = [
  "id",
  "entity",
  "entityKey",
  "field",
  "classId",
] as const;

/**
 * Read every named key as a string, or nothing if any is not one.
 *
 * One loop rather than a branch per column. A list of identical checks grows a
 * branch each time the row does, and the branch that gets forgotten is the one
 * that lets an unvalidated value through.
 */
function readStrings(
  item: Record<string, unknown>,
  keys: readonly string[]
): string[] | null {
  const values: string[] = [];
  for (const key of keys) {
    const value = item[key];
    if (typeof value !== "string") return null;
    values.push(value);
  }
  return values;
}

/** Whether a stored value is one of the two scopes a row may carry. */
function readScope(value: unknown): ClassUsageScope | null {
  return value === "collection" || value === "single" ? value : null;
}

/**
 * Whether a stored value is one of the two variants a row may carry.
 *
 * Checked against the set rather than accepted as any string, because `variant`
 * partitions the index the way `scope` does: every query binds one value, so a
 * row carrying anything else belongs to a family no real subject can name. It
 * would be neither reconciled nor swept, and would count towards a class for
 * ever.
 */
function readVariant(value: unknown): ClassUsageVariant | null {
  return value === "published" || value === "draft" ? value : null;
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

  // A row written before the locale column existed carries NULL rather than
  // the empty-string sentinel, because the column was ADDED to a live table
  // and a new column is nullable. Rejecting it would make those rows invisible
  // to every query AND to the sweep, so they could never be read or repaired.
  // Absent means "not localized", which is what the sentinel means.
  const locale = item.locale ?? "";
  if (typeof locale !== "string") return null;

  const variant = readVariant(item.variant);
  if (variant === null) return null;

  const parts = readStrings(item, ROW_STRING_COLUMNS);
  if (parts === null) return null;
  const [id, entity, entityKey, field, classId] = parts;

  return { id, scope, entity, entityKey, field, locale, variant, classId };
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
  await walkPages({
    maxPages: MAX_PAGES,
    describe,
    fetchPage: page =>
      store.find({
        collection: CLASS_USAGE_INDEX_SLUG,
        where,
        limit: PAGE_SIZE,
        page,
        // Ordered by a column these writes cannot move. Offset paging reads
        // position N of an ordered set, so ordering by anything this
        // maintenance rewrites would reshuffle rows between queries and skip
        // some — and a skipped row reads as a reference the document dropped.
        sort: "id",
      }),
    onPage: items => {
      for (const item of items) {
        const row = readStoredRow(item);
        if (row === null) continue;
        // Validated HERE rather than by each consumer. Every path that reads
        // rows goes on to delete some of them, and a row outside the requested
        // predicates is another document's.
        assertRowMatches(row, where, describe);
        rows.push(row);
      }
    },
  });
  return rows;
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
    variant: { equals: subject.variant },
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
  limits: DocumentLimits;
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
 * Drop rows belonging to documents that no longer exist.
 *
 * A walk over live documents can only reconcile the ones it finds. A document
 * deleted through a path that did not maintain the index — a direct database
 * edit, a restore, a bulk operation — never appears in that walk, so its rows
 * survive a rebuild that reports success. The class it referenced then reads as
 * used by a document nobody can open, and can never be deleted.
 *
 * Answerable only by comparing the index against the set of documents actually
 * seen, which is why the caller supplies that set rather than this reading it
 * again: the two must be the same walk, or a document created between them is
 * read as absent and loses rows it should keep.
 *
 * Scoped to one entity, field and locale, so a rebuild of one blocks field
 * cannot remove rows belonging to another.
 */
export async function forgetAbsentDocuments(args: {
  store: ClassUsageIndexStore;
  scope: ClassUsageScope;
  entity: string;
  field: string;
  locale: string;
  variant: ClassUsageVariant;
  /** Every `entityKey` the walk actually visited. */
  visited: ReadonlySet<string>;
  /**
   * Confirm a document really is gone before its rows are removed.
   *
   * The visited set is built by an offset-paginated walk over a collection
   * other writers can change, so a LIVE document can be missing from it — a
   * deletion ahead of the cursor shifts a later document behind the next
   * offset, and one created after its position was passed is never reached.
   *
   * Consulted only for documents the walk did not see, and answering `true`
   * KEEPS the rows. The asymmetry is deliberate: a kept stale row over-counts
   * and blocks a delete that was safe, while a wrongly removed one
   * under-counts and permits deleting a class a live document still renders.
   */
  stillExists: (entityKey: string) => Promise<boolean>;
}): Promise<{ removed: number }> {
  const where = {
    scope: { equals: args.scope },
    entity: { equals: args.entity },
    field: { equals: args.field },
    locale: { equals: args.locale },
    variant: { equals: args.variant },
  };
  const rows = await storedRowsWhere(
    args.store,
    where,
    `${args.scope}:${args.entity}:*:${args.field}`
  );

  let removed = 0;
  // Cached per document rather than per row: one document contributes a row
  // per class it references, and asking the store once per row would multiply
  // the check by a factor that has nothing to do with how many are orphaned.
  const confirmedGone = new Map<string, boolean>();

  for (const row of rows) {
    if (args.visited.has(row.entityKey)) continue;

    let gone = confirmedGone.get(row.entityKey);
    if (gone === undefined) {
      gone = !(await args.stillExists(row.entityKey));
      confirmedGone.set(row.entityKey, gone);
    }
    if (!gone) continue;

    await args.store.delete({ collection: CLASS_USAGE_INDEX_SLUG, id: row.id });
    removed += 1;
  }
  return { removed };
}
