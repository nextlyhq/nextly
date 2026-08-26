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

import { classUsageOf } from "./class-usage";
import { walkPages } from "./paged-walk";
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
  /**
   * Write the given fields to the LIVE row named by `id`.
   *
   * "Live row" is the load-bearing part, and an implementation that forwards
   * straight to a collection update does not satisfy it. On a `status: true`
   * collection with drafts, an update that omits `status` is stored as a
   * WORKING DRAFT and the published row is left untouched — so a plain forward
   * would accumulate this field onto an author's pending edit, leave the stale
   * published record exactly as it was, and report a repair that never reached
   * the row the rebuild had read.
   *
   * It must also not promote or overwrite a draft that is already there. An
   * author's unpublished work is not this walk's to touch; the field being
   * repaired is bookkeeping the author never wrote.
   *
   * Declared here rather than assumed because this is a PORT — the caller
   * supplies it, so the requirement has to travel with the type or it travels
   * nowhere.
   */
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
  /**
   * Pages whose usage could not be determined, and which therefore still have
   * no trustworthy record.
   *
   * Reported rather than folded into `scanned`, because the two mean opposite
   * things to a caller deciding whether a class is safe to delete: a scanned
   * page answered, and one of these did not. A rebuild that hid them would
   * report a clean sweep over pages it could not read.
   */
  undetermined: number;
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

/** What one page's inspection concluded. */
type PageVerdict = "undetermined" | "repaired" | "agreed";

/** Bring one page's record into agreement with its document, if it can. */
async function repairPage(
  item: StoredPage,
  collection: string,
  args: { store: PageUsageStore; limits?: DocumentLimits }
): Promise<PageVerdict> {
  const usage = classUsageOf(item.content, args.limits);
  if (!usage.complete) {
    // The document could not be read to the end, so the list is a PREFIX of the
    // answer rather than the answer. Writing it would licence exactly the
    // deletion the record exists to prevent, and writing an empty one would be
    // worse. Reported instead, so the run says which pages it could not
    // determine rather than reading as a clean sweep over them.
    return "undetermined";
  }
  if (recordMatches(item.usedClasses, usage.ids)) return "agreed";
  await args.store.update({
    collection,
    id: item.id,
    // Only this field. A rebuild that sent the whole row back would rewrite a
    // page from what THIS walk happened to read, discarding any edit made
    // between the read and the write.
    data: { usedClasses: usage.ids },
  });
  return "repaired";
}

/**
 * Inspect one query's worth of rows, repairing what disagrees.
 *
 * A row this cannot read an id out of is SKIPPED rather than counted. Persisted
 * data reaches here unvalidated, and losing the whole rebuild over one
 * unreadable row would leave every later page stale — and the later pages are
 * the ones nobody knows to look at.
 */
async function scanOnePage(
  items: readonly unknown[],
  collection: string,
  args: { store: PageUsageStore; limits?: DocumentLimits }
): Promise<{ scanned: number; repaired: number; undetermined: number }> {
  let scanned = 0;
  let repaired = 0;
  let undetermined = 0;
  for (const item of items) {
    if (!isStoredPage(item)) continue;
    scanned += 1;
    const verdict = await repairPage(item, collection, args);
    if (verdict === "undetermined") undetermined += 1;
    if (verdict === "repaired") repaired += 1;
  }
  return { scanned, repaired, undetermined };
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
  let undetermined = 0;
  await walkPages({
    maxPages: MAX_PAGES,
    describe: `${collection}.usedClasses`,
    fetchPage: page =>
      args.store.find({ collection, limit: PAGE_SIZE, page, sort: "id" }),
    onPage: async items => {
      const tally = await scanOnePage(items, collection, args);
      scanned += tally.scanned;
      repaired += tally.repaired;
      undetermined += tally.undetermined;
    },
  });

  return { scanned, repaired, undetermined };
}
