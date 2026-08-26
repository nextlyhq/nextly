/**
 * Claiming the right to reconcile one subject.
 *
 * Reconciliation compares a document against the rows currently filed for it
 * and writes the difference. That is only sound while ONE writer is doing it:
 * two saves to the same document can each read the same rows, each compute a
 * difference against them, and each apply it — so the loser deletes a row the
 * winner still needs. The index then under-counts, and an under-count is the
 * direction that permits deleting a class a live page renders.
 *
 * ## Why a counter rather than a lock or a timestamp
 *
 * A lock held in memory is correct only inside one process, and these apps
 * deploy to platforms that run many. It would pass every test on one machine
 * and fail silently in production, which is worse than not having it.
 *
 * A timestamp cannot separate two writes that fall close together. Core already
 * learned this and wrote it down where its own working drafts are stored: a
 * timestamp's stored resolution differs per dialect and SQLite keeps whole
 * epoch SECONDS, so the second writer's read observes exactly what the first
 * wrote, its predicate matches, and it overwrites newer work believing the row
 * untouched. A counter advances on every write however close together they
 * fall.
 *
 * ## What it does NOT promise
 *
 * That the index ends up describing the document that WON the save. It cannot:
 * a collection row carries no version this plugin can read, so "last reconcile
 * wins" is not the same as "last save wins". What this does guarantee is that
 * the index is never left holding a MIXTURE of two documents' rows, which is
 * the state that under-counts. A rebuild is what closes the remaining gap, and
 * the count a safe-delete shows should describe itself as best-effort rather
 * than certain.
 *
 * @module class-usage-generation
 */
import { subjectWhere } from "./class-usage-maintenance";
import type { ClassUsageSubject } from "./class-usage-reconcile";

/** The generation a subject starts at, before anything has reconciled it. */
const FIRST_GENERATION = 1;

/**
 * The store operations claiming needs, declared structurally.
 *
 * Not the generated Direct API types, for the reason `ClassUsageIndexStore` is
 * not: those describe the HOST app's collections, which may not have been
 * generated when this plugin is wired.
 */
export interface SubjectGenerationStore {
  find(args: {
    collection: string;
    where: Record<string, { equals: string | number }>;
    limit: number;
    page: number;
    /** Required, and it must be a column the writes here cannot move. */
    sort: string;
  }): Promise<{ items: unknown[]; meta: { hasNext: boolean } }>;
  create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<unknown>;
  /**
   * Update every row matching `where`, reporting HOW MANY matched.
   *
   * The count is the whole mechanism rather than a diagnostic. A conditional
   * update that cannot say whether it applied is not a compare-and-set: the
   * caller would have to read back to find out, and another writer can act
   * between the write and that read.
   */
  update(args: {
    collection: string;
    where: Record<string, { equals: string | number }>;
    data: Record<string, unknown>;
  }): Promise<{ successCount: number }>;
}

/** Whether this caller may reconcile, and under which generation. */
export type GenerationClaim =
  | { claimed: true; generation: number }
  | { claimed: false };

/** One stored generation row, once it has been read as one. */
interface StoredGeneration {
  id: string;
  generation: number;
}

/** Whether a stored item can be read as a generation row. */
function readGeneration(value: unknown): StoredGeneration | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as { id?: unknown; generation?: unknown };
  if (typeof row.id !== "string") return null;
  // Rejected rather than coerced. A non-numeric generation cannot be compared
  // or advanced, and treating it as zero would hand every caller the same
  // claim — which is the serialisation failing open.
  if (typeof row.generation !== "number") return null;
  return { id: row.id, generation: row.generation };
}

/**
 * Claim the next generation for a subject, or report that somebody else did.
 *
 * A caller that is not claimed must NOT reconcile. It may retry, and a retry is
 * cheap because the winner's reconciliation will already have run: the loser
 * re-reads, finds the advanced generation, and either claims the one after it
 * or discovers the work is done.
 *
 * The row is created when absent. Two callers can create concurrently, because
 * the composite key this table describes cannot be enforced by the database —
 * a collection's declared indexes never reach the schema pipeline, so no unique
 * constraint exists to reject the second insert. Duplicates are therefore made
 * HARMLESS rather than prevented: every caller selects the lowest id, so they
 * agree on which row is the one that serialises them, whatever else is present.
 */
export async function claimSubjectGeneration(args: {
  store: SubjectGenerationStore;
  collection: string;
  subject: ClassUsageSubject;
}): Promise<GenerationClaim> {
  const where = subjectWhere(args.subject);

  const page = await args.store.find({
    collection: args.collection,
    where,
    limit: 10,
    // By id, which nothing here rewrites. The lowest is the agreed row, and an
    // ordering the writes could move would let two callers disagree about
    // which one that is — the disagreement this ordering exists to prevent.
    sort: "id",
    page: 1,
  });

  const rows = page.items
    .map(readGeneration)
    .filter((row): row is StoredGeneration => row !== null);

  if (rows.length === 0) {
    await args.store.create({
      collection: args.collection,
      data: { ...unwrapEquals(where), generation: FIRST_GENERATION },
    });
    // Claimed WITHOUT a compare-and-set, and only this once. There was no row
    // to compare against, and a concurrent creator gets the same answer — but
    // both then reconcile the same subject to the same rows from the same
    // document, because reconciliation is idempotent. The generation exists to
    // stop two DIFFERENT documents interleaving, and at creation there is only
    // one.
    return { claimed: true, generation: FIRST_GENERATION };
  }

  const [current] = rows;
  const next = current.generation + 1;
  const result = await args.store.update({
    collection: args.collection,
    // EQUALITY against the value this read observed, which is what
    // compare-and-set means: a concurrent writer advances it, this matches
    // nothing, and the slower caller is told it did not claim rather than
    // proceeding to overwrite newer work.
    where: {
      id: { equals: current.id },
      generation: { equals: current.generation },
    },
    data: { generation: next },
  });

  if (result.successCount === 0) return { claimed: false };
  return { claimed: true, generation: next };
}

/** The subject columns as plain values, for the row being created. */
function unwrapEquals(
  where: Record<string, { equals: string }>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(where).map(([column, predicate]) => [
      column,
      predicate.equals,
    ])
  );
}
