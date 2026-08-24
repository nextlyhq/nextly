/**
 * Rebuilding every page's record of which named classes it references.
 *
 * The stored `usedClasses` list is a CACHE of something derivable, and that is
 * the only reason it is allowed to exist: the answer is always recoverable by
 * walking the documents again. This is that walk. Without it the record would
 * be a second source of truth, and a second source of truth with no way back to
 * the first is just a number nobody can check.
 *
 * ## When it is needed
 *
 * Pages written before the field existed carry no record at all. A write that
 * bypassed the hook — a direct database edit, a restore, an import — leaves one
 * that disagrees with its document. Neither is visible from the record itself,
 * which is precisely why the repair has to be available rather than inferred.
 *
 * ## Why writes are skipped when nothing changed
 *
 * Repairing a record is not editing a page, and a rebuild that wrote to every
 * row would say it was. Every page's `updatedAt` would jump to the moment the
 * rebuild ran, so "recently edited" would list the whole site, ordering by it
 * would be meaningless, and anything downstream that watches for changes —
 * caches, webhooks, revalidation — would fire for every page at once. The
 * comparison that avoids that is cheap and exact, because `classIdsUsedBy`
 * returns a sorted list with no repeats: two runs over one document produce
 * equal arrays, so equality is a direct answer rather than set arithmetic.
 *
 * ## Why it stops at the first failure
 *
 * A failed write here is not per-row bad data — `classIdsUsedBy` is total, so a
 * malformed document produces a list rather than an error, and what remains is
 * the store being unreachable, unauthorised, or refusing the write. Swallowing
 * those and continuing would report a completed rebuild that repaired nothing,
 * which is the report that stops anyone looking.
 *
 * Stopping is affordable BECAUSE the record is idempotent: a rerun writes the
 * same lists, so a run that stopped halfway costs a rerun and nothing else.
 * That is the same property that makes the record repairable at all.
 *
 * @module class-usage-rebuild
 */
import type { DocumentLimits } from "@nextlyhq/blocks-engine";

import { classIdsUsedBy } from "./class-usage";
import { readStoredJson } from "./stored-json";

/** How many pages one query asks for. */
const PAGE_SIZE = 100;

/**
 * A guard against a store whose paging never reports an end.
 *
 * `hasNext` comes from the store, and a walk that trusts it completely is one
 * malformed response away from running forever. Sized so that reaching it means
 * the response is wrong rather than the site is large.
 *
 * Reaching it is REPORTED rather than absorbed. A guard that silently ends the
 * walk turns "I could not finish" into a report indistinguishable from "there
 * was nothing more", and the pages past it keep whatever stale records they
 * hold while a completed rebuild says otherwise.
 */
const MAX_PAGES = 10_000;

/** What one page looks like to this walk: an id, and a document to read. */
interface StoredPage {
  id: string;
  content?: unknown;
  usedClasses?: unknown;
}

/**
 * The store operations this needs, declared structurally.
 *
 * Not the generated Direct API types: those describe the HOST app's
 * collections, which may not have been generated when this plugin is wired, and
 * the pages collection is this plugin's own to know. The same reason
 * `SiteStyleReader` is declared this way.
 */
export interface PageUsageStore {
  find(args: {
    collection: string;
    limit: number;
    page: number;
    sort: string;
  }): Promise<{ items: unknown[]; meta: { hasNext: boolean } }>;
  update(args: {
    collection: string;
    id: string;
    data: Record<string, unknown>;
  }): Promise<unknown>;
}

/** What a rebuild did, in the two numbers that mean different things. */
export interface RebuildReport {
  /** Pages read. Zero means the walk found nothing, NOT that nothing needed repair. */
  scanned: number;
  /** Pages whose stored record disagreed with their document and was rewritten. */
  repaired: number;
}

/** Whether a value is the shape this walk can read a page out of. */
function isStoredPage(value: unknown): value is StoredPage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

/**
 * Whether a stored record already says what the document says.
 *
 * A stored value that is not an array of strings is not a disagreement to be
 * compared, it is an absent record — the field is `json`, so anything can be
 * sitting there, including the `undefined` of a page written before the field
 * existed. Those are the rows the rebuild is for, so they answer false.
 */
function recordMatches(stored: unknown, derived: readonly string[]): boolean {
  // Read through the same seam the document is read through, because this
  // column is `json` for the same reason and comes back in the same two shapes.
  // Comparing the raw value would find no array on a dialect that stores it as
  // text, report every record as absent, and rewrite EVERY page on every
  // rebuild — moving `updatedAt` site-wide and firing whatever watches for
  // edits, which is the cost this comparison exists to avoid.
  const record = readStoredJson(stored);
  if (!Array.isArray(record)) return false;
  if (record.length !== derived.length) return false;
  return record.every((value, index) => value === derived[index]);
}

/**
 * Recompute every page's `usedClasses` from its document, writing only the ones
 * that disagree.
 *
 * Ordered by `id` rather than by anything the walk can change. Offset paging
 * reads position N of an ordered set, so ordering by a MUTABLE key while
 * writing during the walk reshuffles rows between queries and skips some of
 * them — and `updatedAt`, the obvious ordering for a maintenance pass, is
 * exactly the key each write moves. An id is stable under the writes this
 * makes, so a row cannot move out from under the walk because of it.
 *
 * A page created or deleted by somebody else DURING the walk can still shift
 * one, and that is accepted rather than locked against: the record is
 * idempotent, so a page missed by one rebuild is corrected by its next save or
 * its next rebuild, and holding every page still to avoid it would cost more
 * than the thing it prevents.
 */
export async function rebuildClassUsage(args: {
  store: PageUsageStore;
  collection?: string;
  /**
   * The limits pages are rendered under, when they are not the defaults.
   *
   * The same value the plugin and `PageRenderer` are given. A rebuild deriving
   * under different bounds than the write hook would rewrite every page to a
   * list the hook then disagrees with, and the two would take turns correcting
   * each other on every save.
   */
  limits?: DocumentLimits;
}): Promise<RebuildReport> {
  const collection = args.collection ?? "pages";
  let scanned = 0;
  let repaired = 0;
  let reachedTheEnd = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await args.store.find({
      collection,
      limit: PAGE_SIZE,
      page,
      sort: "id",
    });

    for (const item of result.items) {
      if (!isStoredPage(item)) continue;
      scanned++;
      const derived = classIdsUsedBy(item.content, args.limits);
      if (recordMatches(item.usedClasses, derived)) continue;
      await args.store.update({
        collection,
        id: item.id,
        // Only this field. A rebuild that sent the whole row back would rewrite
        // a page from what THIS walk happened to read, discarding any edit made
        // between the read and the write.
        data: { usedClasses: derived },
      });
      repaired++;
    }

    if (!result.meta.hasNext) {
      reachedTheEnd = true;
      break;
    }
  }

  if (!reachedTheEnd) {
    // The loop ended because its own guard ran out, not because the store said
    // there was nothing left — so pages after this point were never read, and
    // whatever stale records they hold are still there.
    //
    // Thrown rather than returned as a flag on the report. A `RebuildReport`
    // reads as a completed pass, and the two numbers on it are the same numbers
    // a genuinely complete run would produce; a caller doing the obvious thing
    // with the result would record a successful rebuild over a site it had only
    // partly scanned. The whole point of the report is to say the records can
    // now be trusted, and after this they cannot.
    throw new Error(
      `Class-usage rebuild stopped after ${MAX_PAGES} pages of ${PAGE_SIZE} with more reported; ` +
        `${scanned} page(s) scanned and ${repaired} repaired, and the rest were not read.`
    );
  }

  return { scanned, repaired };
}
