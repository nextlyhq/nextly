/**
 * Recomputing the class-usage index from the documents it describes.
 *
 * The index is a CACHE of something derivable, and that is the only reason it
 * is allowed to exist: the answer is always recoverable by walking the
 * documents again. This is that walk. Without it the index would be a second
 * source of truth with no way back to the first, which is a number nobody can
 * check.
 *
 * ## What it is for
 *
 * Documents written before the index existed have no rows at all. A write that
 * bypassed maintenance — a direct database edit, a restore, an import — leaves
 * rows that disagree with the document they claim to describe. And maintenance
 * runs after the document commits, so a failure there leaves the document saved
 * and its rows stale. None of those is visible from the rows themselves, which
 * is precisely why the repair has to exist rather than be inferred.
 *
 * ## Why a rebuild is not subject to the write path's race
 *
 * Reconciliation is only sound when its caller serialises per subject, because
 * two concurrent writers can each plan to remove the other's rows. A rebuild
 * visits each subject once, in one pass, so no second writer exists within it —
 * the property the write path will have to arrange is one this caller has for
 * free. It is worth stating rather than leaving to be noticed, because it is
 * the reason the same reconciliation is safe here and not there.
 *
 * ## Why it stops at the first failure
 *
 * Swallowing a failure and continuing would report a completed rebuild that
 * repaired nothing, which is the report that stops anyone looking. Stopping is
 * affordable BECAUSE reconciliation is idempotent: a rerun writes the same
 * rows, so a run that stopped halfway costs a rerun and nothing else.
 *
 * @module class-usage-index-rebuild
 */
import type { DocumentLimits } from "@nextlyhq/blocks-engine";
import { isPlainRecord } from "@nextlyhq/blocks-engine";

import {
  maintainClassUsage,
  type ClassUsageIndexStore,
} from "./class-usage-maintenance";
import { walkPages } from "./paged-walk";

/** How many documents one query asks for. */
const PAGE_SIZE = 100;

/**
 * A guard against a store whose paging never reports an end.
 *
 * Sized so that reaching it means the response is wrong rather than the site is
 * large, and counted in PAGES REQUESTED rather than documents read: a store
 * answering `hasNext` forever with an empty page never grows the count, so a
 * document-count bound would spin without end.
 */
const MAX_PAGES = 10_000;

/**
 * Reading the documents to rebuild from.
 *
 * Declared structurally rather than as the generated Direct API types, for the
 * reason `ClassUsageIndexStore` is: those describe the HOST app's collections,
 * which may not have been generated when this plugin is wired.
 */
export interface ClassUsageDocumentStore {
  find(args: {
    collection: string;
    limit: number;
    page: number;
    sort: string;
  }): Promise<{ items: unknown[]; meta: { hasNext: boolean } }>;
}

/** What a rebuild did, in numbers that mean different things. */
export interface ClassUsageRebuildReport {
  /** Documents read. Zero means the walk found none, NOT that none needed repair. */
  scanned: number;
  /** Documents whose rows disagreed with them and were rewritten. */
  repaired: number;
  /**
   * Documents that could not be read whole, and whose count is therefore not
   * trustworthy.
   *
   * Reported separately rather than folded into `scanned`, because the two mean
   * opposite things to a caller deciding whether a class is safe to delete: a
   * scanned document answered, and one of these did not.
   */
  undetermined: number;
}

/** Whether a stored item is something a document can be read out of. */
function isStoredDocument(
  value: unknown
): value is Record<string, unknown> & { id: string } {
  return (
    isPlainRecord(value) && typeof (value as { id?: unknown }).id === "string"
  );
}

/** What one query's worth of documents contributed. */
interface PageTally {
  scanned: number;
  repaired: number;
  undetermined: number;
}

/**
 * Bring one query's worth of documents into agreement with their rows.
 *
 * An item this cannot read an id out of is SKIPPED rather than counted.
 * Persisted data arrives unvalidated, and losing the whole rebuild over one
 * unreadable row would leave every later document stale — and the later ones
 * are the ones nobody knows to look at.
 */
async function rebuildOnePage(
  items: readonly unknown[],
  args: {
    index: ClassUsageIndexStore;
    collection: string;
    field: string;
    locale?: string;
    limits?: DocumentLimits;
  }
): Promise<PageTally> {
  let scanned = 0;
  let repaired = 0;
  let undetermined = 0;

  for (const item of items) {
    if (!isStoredDocument(item)) continue;
    scanned += 1;

    const report = await maintainClassUsage({
      store: args.index,
      subject: {
        scope: "collection",
        entity: args.collection,
        entityKey: item.id,
        field: args.field,
        locale: args.locale ?? "",
      },
      document: item[args.field],
      limits: args.limits,
    });

    if (report.undetermined) undetermined += 1;
    // Repaired means the rows CHANGED, which is a different question from
    // whether the document was read. A document already in agreement issues no
    // writes and is scanned without being repaired.
    if (report.inserted > 0 || report.removed > 0) repaired += 1;
  }

  return { scanned, repaired, undetermined };
}

/**
 * Rebuild the index for one collection's blocks field.
 *
 * Ordered by `id` rather than by anything this walk can change. Offset paging
 * reads position N of an ordered set, so ordering by a MUTABLE key while
 * writing during the walk reshuffles rows between queries and skips some —
 * and `updatedAt`, the obvious ordering for a maintenance pass, is exactly the
 * key a write moves. An id is stable under the writes this makes.
 *
 * A document created or deleted by somebody else DURING the walk can still
 * shift one, and that is accepted rather than locked against: reconciliation is
 * idempotent, so a document missed by one rebuild is corrected by its next save
 * or its next rebuild, and holding every document still would cost more than
 * the thing it prevents.
 */
export async function rebuildClassUsageIndex(args: {
  documents: ClassUsageDocumentStore;
  index: ClassUsageIndexStore;
  /** The collection whose documents are walked. */
  collection: string;
  /** The blocks field on those documents. */
  field: string;
  /** Which locale's documents these are, empty when the field is not localized. */
  locale?: string;
  /**
   * The bounds the documents are rendered under, when not the engine defaults.
   *
   * The SAME value the plugin and the renderer are given. A rebuild deriving
   * under different bounds than the renderer would record a class applied to a
   * node the page draws as absent, and a usage-based delete reads that absence
   * as "not used".
   */
  limits?: DocumentLimits;
}): Promise<ClassUsageRebuildReport> {
  let scanned = 0;
  let repaired = 0;
  let undetermined = 0;

  await walkPages({
    maxPages: MAX_PAGES,
    describe: `${args.collection}.${args.field}`,
    fetchPage: page =>
      args.documents.find({
        collection: args.collection,
        limit: PAGE_SIZE,
        page,
        sort: "id",
      }),
    onPage: async items => {
      const tally = await rebuildOnePage(items, args);
      scanned += tally.scanned;
      repaired += tally.repaired;
      undetermined += tally.undetermined;
    },
  });

  return { scanned, repaired, undetermined };
}
