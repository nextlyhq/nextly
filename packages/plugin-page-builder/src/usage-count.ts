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
 * The number can be short for two reasons, and both are short in the direction
 * that reads as fine. The grouped read is capped, so a component used on more
 * documents than the cap comes back at the cap. And a document that could not
 * be walked whole is recorded as one marker with its references DISCARDED, so
 * it is absent from every component's count rather than counted against the
 * wrong one — a component embedded only in such a document reads as used
 * nowhere.
 *
 * A caller that shows the number without saying so tells an author a widely
 * used component is barely used, which is the reading that makes a delete look
 * safe. So the bound travels WITH the number and the surface decides how to say
 * it.
 *
 * @module usage-count
 */
import type {
  GroupedUsageReader,
  UsageIndex,
  UsageSubject,
} from "./usage-index";
import { indexIsWhole, type UsageIndexHealth } from "./usage-index-health";

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
   * False means the number is a FLOOR, from either of two causes: the grouped
   * read reached its cap and stopped, or some document could not be read whole
   * and so is missing from the population entirely. A surface showing the count
   * without this says "used on 50 pages" about a component used on thousands,
   * and says "used on no pages" about one embedded in a document too large to
   * walk.
   */
  complete: boolean;
}

/**
 * The two columns that together identify a document in every usage index.
 *
 * `entityKey` holds the document's id and `entity` the collection it lives in,
 * and both are the same columns in each index because the six subject columns
 * are the shared half of the row. A document is the PAIR: ids are minted per
 * collection, so two tracked collections can each hold a document with the
 * same id — restored or imported records do — and grouping by the id alone
 * folds those into one bucket. The count then reads below the truth while
 * presenting itself as exact, which is the one answer a safe delete must never
 * be handed.
 */
const COLLECTION_COLUMN = "entity";
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
  /**
   * What is known about the index as a whole, resolved ONCE by the caller.
   *
   * Required rather than defaulted, and that is the API decision worth
   * defending. A default would have to be either "whole", which is the
   * confident wrong answer this module exists to stop, or "a floor", which
   * quietly caveats every count on a healthy site. Neither is a fact, so the
   * caller supplies one — and being made to says out loud that this half of
   * the answer is a property of the SCREEN rather than of the component.
   */
  health: UsageIndexHealth;
}): Promise<UsageCount> {
  // An empty id references nothing and is not an id. Answered as COMPLETE
  // because it genuinely is — nothing can reference what is not a reference —
  // and answered without a read, because asking would spend a query to learn
  // what the argument already said.
  if (args.referenceId === "") return { documents: 0, complete: true };

  const referencing = args.index.whereReferencing(args.referenceId);

  // Which collections hold a reference at all, then the documents in EACH.
  // The grouped read takes one column, so the pair is asked as two questions:
  // grouping by the id across every collection at once is the fold described
  // above, and grouping by collection alone counts collections, not documents.
  const collections = await args.read({
    where: referencing,
    groupBy: COLLECTION_COLUMN,
  });

  let documents = 0;
  let truncated = collections.truncated;
  let placeable = true;
  for (const entity of collections.buckets) {
    // A row naming no collection is a document this cannot place, and a count
    // that dropped it would be a floor presenting itself as exact.
    if (entity === null) {
      placeable = false;
      continue;
    }
    const inCollection = await args.read({
      where: { ...referencing, [COLLECTION_COLUMN]: { equals: entity } },
      groupBy: DOCUMENT_COLUMN,
    });
    documents += inCollection.buckets.length;
    truncated ||= inCollection.truncated;
  }

  // Four conditions in one expression, and no ordering between them can drop
  // one: a read reached its cap, a row could not be placed in a collection,
  // some document in the index was never readable, or some scope was never
  // walked. The first two are about this component; the other two were
  // resolved once for the whole screen.
  return {
    documents,
    complete: !truncated && placeable && indexIsWhole(args.health),
  };
}
