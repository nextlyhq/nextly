/**
 * How many DOCUMENTS use a thing, asked of the index rather than of the pages.
 *
 * The count a library tile shows beside a component, and the one an author
 * reads before deciding whether something is safe to change. Generic over the
 * usage indexes because it is one question: the class index and the component
 * index differ in what a row references, not in what "used on N pages" means.
 *
 * ## Why DISTINCT documents, and why that is not a detail
 *
 * A row is filed per field, per locale and per stored variant, so one page
 * using one component in two languages while holding a pending draft
 * contributes several rows. Counting rows would report that page as several,
 * and the number would climb every time somebody added a translation — a count
 * that grows without the usage growing is worse than no count, because it reads
 * as information.
 *
 * ## Why the database groups, rather than this module
 *
 * The index exists to make this affordable over a population too large to walk.
 * Reading every row back to deduplicate here would spend exactly what the index
 * was built to save, and it would spend it per tile.
 *
 * ## What `complete` is for
 *
 * The grouped read is capped, so a component used on more documents than the
 * cap comes back short — and short in the direction that reads as fine. A
 * caller that shows the number without saying so tells an author a widely used
 * component is barely used, which is the reading that makes a delete look safe.
 * So the bound travels WITH the number and the surface decides how to say it.
 *
 * @module usage-count
 */
import type { UsageIndex, UsageSubject } from "./usage-index";

/** What a count of the documents using something answered. */
export interface UsageCount {
  /**
   * How many DISTINCT documents reference it.
   *
   * A floor rather than a total when `complete` is false: the documents seen,
   * not the documents there are.
   */
  documents: number;
  /**
   * Whether `documents` is the whole answer.
   *
   * False means the grouped read reached its cap and stopped, so more documents
   * use this than the number says. A surface showing the count without this
   * says "used on 50 pages" about a component used on thousands.
   */
  complete: boolean;
}

/**
 * How the index is grouped, injected so this module needs no Direct API.
 *
 * The shape is the Direct API's own grouped answer, narrowed to what a count
 * reads. Injected for the reason the Layout scan injects its reader: it keeps
 * the counting rule testable against values, and it keeps the decision about
 * WHICH collection is grouped with the caller that knows the slug.
 */
export interface GroupedUsageReader {
  (args: {
    where: Record<string, { equals: string }>;
    groupBy: string;
  }): Promise<{ bucketCount: number; truncated: boolean }>;
}

/**
 * The column a document is identified by in every usage index.
 *
 * `entityKey` holds the document's id, and it is the same column in each index
 * because the six subject columns are the shared half of the row. Grouping by
 * it is what turns rows into documents.
 */
const DOCUMENT_COLUMN = "entityKey";

/**
 * How many documents reference `referenceId`, and whether that is all of them.
 *
 * The index decides which rows count — it owns whether a marker sits beside its
 * references and how to exclude one — and this decides what the buckets mean.
 */
export async function countDocumentsUsing<TRow extends UsageSubject>(args: {
  index: UsageIndex<TRow>;
  read: GroupedUsageReader;
  referenceId: string;
}): Promise<UsageCount> {
  // An empty id references nothing and is not an id. Answered as COMPLETE
  // because it genuinely is — nothing can reference what is not a reference —
  // and answered without a read, because asking would spend a query to learn
  // what the argument already said.
  if (args.referenceId === "") return { documents: 0, complete: true };

  const grouped = await args.read({
    where: args.index.whereReferencing(args.referenceId),
    groupBy: DOCUMENT_COLUMN,
  });

  return { documents: grouped.bucketCount, complete: !grouped.truncated };
}
