/**
 * Removing the image sizes stored before Nextly stopped making them.
 *
 * An item uploaded before then holds its sizes in the media table's `sizes`
 * column: one stored file per size, named by its path. That column is the only
 * record of where those files are, so they are removed while it still says,
 * and only then can the column go. Dropping the column first would leave every
 * size file in storage, still publicly served, with nothing pointing at it.
 *
 * `nextly media remove-sizes` runs this. It lists what it would do by default
 * and changes nothing until it is run with `--apply`. Only the files an item's
 * `sizes` names are removed, and of those, never one any media item still uses
 * as its original or its thumbnail: an item whose thumbnail is one of its
 * sizes keeps that file. Each item's `sizes` is cleared only once all of its
 * size files are gone, so a run that stops part-way, or a file the storage
 * refuses, leaves that item as it was for the next run.
 *
 * Three things leave an item as it is, named, for the run to exit non-zero:
 * a size whose file is on another storage than the one configured now (its
 * path means nothing to this one), a delete that fails for any reason but the
 * file being definitely gone, and a check of what items use, asked again just
 * before the removal, that cannot be answered.
 *
 * @module domains/media/retired-image-sizes
 */
import { isTransientError, withRetry } from "../../storage/retry";
import { siblingStoredPath } from "../../storage/stored-path";

import {
  canonicalStoredPath,
  RECHECK_BATCH,
  type ReferencedNow,
} from "./orphan-thumbnails";
import { errorForLog, storedPathForLog } from "./remove-stored-files";
import {
  DROP_SIZES_COMMAND,
  REMOVE_SIZES_COMMAND,
  RETIRED_IMAGE_SIZES_TABLE,
  RETIRED_SIZES_COLUMN,
} from "./retired-image-sizes-constants";

/** One size as the column holds it, as far as finding its file goes. */
interface StoredSize {
  name: string;
  path?: string;
  url?: string;
}

/** What a `sizes` value holds: its sizes, or that it cannot be read. */
type StoredSizes =
  | { readable: true; sizes: StoredSize[] }
  | { readable: false };

const NONE: StoredSizes = { readable: true, sizes: [] };

/** Whether a field of a size record is absent or a name of its file. */
function absentOrText(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value !== "");
}

/**
 * A size entry as a size record: an object naming its file by a non-empty
 * text `path`, `url` or both, and nothing of another kind under either. Any
 * other entry, a bare path, a number, null, a list or an object naming no
 * file, is not one, and undefined: it may name a file or say nothing of one,
 * and nothing tells which.
 */
function sizeEntry(name: string, value: unknown): StoredSize | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const { path, url } = value as { path?: unknown; url?: unknown };
  if (!absentOrText(path) || !absentOrText(url)) return undefined;
  if (path === undefined && url === undefined) return undefined;
  return {
    name,
    ...(path === undefined ? {} : { path }),
    ...(url === undefined ? {} : { url }),
  };
}

/**
 * The sizes a `sizes` value holds, from the column as each dialect returns it:
 * an object on PostgreSQL and MySQL, a JSON string on SQLite.
 *
 * Unreadable when it is text that is not JSON, JSON that is not an object of
 * sizes, or an object with any entry that is not a size record
 * (`sizeEntry`). Such a value may still name files, so it is never read as
 * empty, nor read for its other entries alone: nothing can show that clearing
 * it loses nothing.
 */
function readStoredSizes(value: unknown): StoredSizes {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return { readable: false };
    }
  }
  if (parsed === null || parsed === undefined) return NONE;
  if (Array.isArray(parsed)) {
    return parsed.length === 0 ? NONE : { readable: false };
  }
  if (typeof parsed !== "object") return { readable: false };
  const sizes: StoredSize[] = [];
  for (const [name, entry] of Object.entries(parsed)) {
    const size = sizeEntry(name, entry);
    if (size === undefined) return { readable: false };
    sizes.push(size);
  }
  return { readable: true, sizes };
}

/**
 * Whether an item still holds sizes: any size at all, or a value that cannot
 * be read. An empty object, an empty list and SQL NULL hold none.
 */
export function holdsStoredSizes(value: unknown): boolean {
  const read = readStoredSizes(value);
  return !read.readable || read.sizes.length > 0;
}

/** A media row as the removal reads it. */
export interface MediaSizesRow {
  id: string;
  filename: string;
  url: string;
  thumbnailUrl?: string | null;
  sizes?: unknown;
}

/** Where the removal reads media rows and clears their sizes. */
export interface RetiredSizesStore {
  /** Every media row, a page at a time, each with its stored `sizes`. */
  rows(): AsyncIterable<readonly MediaSizesRow[]>;
  /** Sets one item's `sizes` to NULL. */
  clearSizes(id: string): Promise<void>;
}

/**
 * The storage surface the removal uses: the media storage configured now.
 * `exists` is not part of it: two adapters answer `false` for any failure to
 * ask, which cannot tell a removed file from an unreachable one.
 */
export interface SizeFileStorage {
  delete(filePath: string): Promise<void>;
  /** Where this storage serves a stored path, to tell its files from another's. */
  getPublicUrl(filePath: string): string;
  getType(): string;
}

/** A size whose file stays, and why. */
interface KeptSize {
  name: string;
  path: string;
  /** `thumbnail`: the item's own thumbnail; `in-use`: another reference. */
  reason: "thumbnail" | "in-use";
}

/** What the removal does with one item that holds sizes. */
interface ItemPlan {
  id: string;
  filename: string;
  /** The size files to remove. */
  remove: Array<{ name: string; path: string }>;
  /** The size files that stay because something still uses them. */
  keep: KeptSize[];
  /**
   * Sizes whose stored file cannot be located from the record, or a value
   * that cannot be read. Either leaves the item's `sizes` as it is.
   */
  unlocated: string[];
  /**
   * Sizes whose file was stored on another storage than the one configured
   * now, by where it is served. Leaves the item's `sizes` as it is: a path
   * of another storage, handed to this one, would delete nothing there, or
   * this storage's file of the same name, and the record would be cleared.
   */
  elsewhere: Array<{ name: string; url: string }>;
}

/** The files media items use as originals or thumbnails, across the table. */
interface InUse {
  paths: Set<string>;
  urls: Set<string>;
  /** Last segments of thumbnails whose stored path cannot be worked out. */
  names: Set<string>;
}

/** A URL or path's last segment, without its query. */
function lastSegment(pathOrUrl: string): string {
  const located = canonicalStoredPath(pathOrUrl).replace(/[?#].*$/, "");
  return located.slice(located.lastIndexOf("/") + 1);
}

/** A URL as the in-use set compares it: without its query and fragment. */
function urlKey(url: string): string {
  return canonicalStoredPath(url).replace(/[?#].*$/, "");
}

/** Records the original and the thumbnail one row uses. */
function addInUse(inUse: InUse, row: MediaSizesRow): void {
  if (row.filename) inUse.paths.add(canonicalStoredPath(row.filename));
  if (row.url) inUse.urls.add(urlKey(row.url));
  if (!row.thumbnailUrl) return;
  inUse.urls.add(urlKey(row.thumbnailUrl));
  const thumbnail = siblingStoredPath(
    { path: row.filename, url: row.url },
    row.thumbnailUrl
  );
  if (thumbnail) inUse.paths.add(canonicalStoredPath(thumbnail));
  else inUse.names.add(lastSegment(row.thumbnailUrl));
}

/** The stored path of a size: its own, or one worked out from its URL. */
function pathOfSize(size: StoredSize, row: MediaSizesRow): string | undefined {
  if (size.path) return size.path;
  if (!size.url) return undefined;
  return siblingStoredPath({ path: row.filename, url: row.url }, size.url);
}

/** Whether a size is the item's own thumbnail. */
function isOwnThumbnail(
  size: StoredSize,
  path: string,
  row: MediaSizesRow
): boolean {
  if (!row.thumbnailUrl) return false;
  if (size.url && urlKey(size.url) === urlKey(row.thumbnailUrl)) return true;
  const thumbnail = siblingStoredPath(
    { path: row.filename, url: row.url },
    row.thumbnailUrl
  );
  return (
    thumbnail !== undefined &&
    canonicalStoredPath(thumbnail) === canonicalStoredPath(path)
  );
}

/** Whether any media item uses a size's file as an original or a thumbnail. */
function isInUse(inUse: InUse, size: StoredSize, path: string): boolean {
  return (
    inUse.paths.has(canonicalStoredPath(path)) ||
    (size.url !== undefined && inUse.urls.has(urlKey(size.url))) ||
    inUse.urls.has(urlKey(path)) ||
    inUse.names.has(lastSegment(path))
  );
}

/**
 * Where a URL serves its file: its origin, or none for a URL relative to the
 * site, and its path, percent-encoded alike either way.
 */
function servedAt(url: string): { origin: string | null; path: string } {
  const key = urlKey(url);
  if (/^https?:\/\//i.test(key)) {
    const parsed = new URL(key);
    return { origin: parsed.origin, path: parsed.pathname };
  }
  return { origin: null, path: new URL(key, "http://site.invalid").pathname };
}

/**
 * Whether a URL a record holds is where the storage configured now serves
 * `path`: the same path, and the same origin, or both relative to the site.
 * One relative and one absolute match only on local disk, which is served
 * from the site under either spelling. On any other storage a URL relative to
 * the site is a file local disk wrote, and the same path under the storage's
 * own host is another file, so it is not this storage's.
 */
function servedHere(
  url: string,
  path: string,
  storage: SizeFileStorage
): boolean {
  const recorded = servedAt(url);
  const here = servedAt(storage.getPublicUrl(path));
  if (recorded.path !== here.path) return false;
  if (recorded.origin === here.origin) return true;
  const oneRelative = recorded.origin === null || here.origin === null;
  return oneRelative && storage.getType() === "local";
}

/**
 * Whether a size's file is on the storage configured now: by the size's own
 * URL, or, for a size recorded by path alone, by the item's original, which
 * was stored with it.
 */
function onThisStorage(
  size: StoredSize,
  path: string,
  row: MediaSizesRow,
  storage: SizeFileStorage
): boolean {
  if (size.url) return servedHere(size.url, path, storage);
  return servedHere(row.url, row.filename, storage);
}

/** One item's plan, judged against everything every item uses. */
function planItem(
  row: MediaSizesRow,
  inUse: InUse,
  storage: SizeFileStorage
): ItemPlan {
  const plan: ItemPlan = {
    id: row.id,
    filename: row.filename,
    remove: [],
    keep: [],
    unlocated: [],
    elsewhere: [],
  };
  const read = readStoredSizes(row.sizes);
  if (!read.readable) {
    plan.unlocated.push("(its stored sizes cannot be read)");
    return plan;
  }
  const planned = new Set<string>();
  for (const size of read.sizes) {
    planSize(plan, size, { row, inUse, storage, planned });
  }
  return plan;
}

/** What one size of an item is judged against. */
interface SizeContext {
  row: MediaSizesRow;
  inUse: InUse;
  storage: SizeFileStorage;
  /** The stored keys already planned for removal, exactly as stored. */
  planned: Set<string>;
}

/** Puts one size into its item's plan: removed, kept, or holding the item. */
function planSize(plan: ItemPlan, size: StoredSize, at: SizeContext): void {
  const { row } = at;
  const path = pathOfSize(size, row);
  if (path === undefined) {
    // Every size record names its file (`sizeEntry`); one named by a URL
    // whose stored path cannot be worked out holds the item.
    plan.unlocated.push(size.name);
    return;
  }
  if (isOwnThumbnail(size, path, row)) {
    plan.keep.push({ name: size.name, path, reason: "thumbnail" });
  } else if (isInUse(at.inUse, size, path)) {
    plan.keep.push({ name: size.name, path, reason: "in-use" });
  } else if (!onThisStorage(size, path, row, at.storage)) {
    plan.elsewhere.push({ name: size.name, url: size.url ?? row.url });
  } else if (!at.planned.has(path)) {
    // By the key exactly as stored: an object storage keeps `media//x.webp`
    // and `media/x.webp` as two objects, and one taken for the other would
    // stay with nothing recording it once the item is cleared. The checks
    // above compare canonically, which can only keep more.
    at.planned.add(path);
    plan.remove.push({ name: size.name, path });
  }
}

/**
 * What the removal would do, from one read of the whole media table: which
 * items hold sizes, and for each, which size files go and which stay.
 *
 * The whole table is read before anything is judged, because a file one item
 * names as a size can be another item's original or thumbnail: an import can
 * copy a record, and a content-addressed storage gives one file one key.
 */
async function planSizeRemoval(
  store: Pick<RetiredSizesStore, "rows">,
  storage: SizeFileStorage
): Promise<ItemPlan[]> {
  const inUse: InUse = { paths: new Set(), urls: new Set(), names: new Set() };
  const holding: MediaSizesRow[] = [];
  for await (const page of store.rows()) {
    for (const row of page) {
      addInUse(inUse, row);
      if (holdsStoredSizes(row.sizes)) holding.push(row);
    }
  }
  return holding.map(row => planItem(row, inUse, storage));
}

/** What the database objects left to drop hold, for the listing. */
export interface RetiredObjects {
  /** Whether the media table still has its `sizes` column. */
  column: boolean;
  /**
   * The `image_sizes` table's rows, or null when there is no table of that
   * name shown to be the one Nextly created.
   */
  tableRows: number | null;
  /**
   * Why a table named `image_sizes` that is there is not shown to be the one
   * Nextly created, so is never dropped; null when there is none, or it is.
   */
  keptTable: string | null;
}

/**
 * The line naming what the drop removes, once no item holds sizes, or, with
 * `now`, as what it removes from here.
 */
function retiredObjectsLine(
  objects: RetiredObjects,
  now = false
): string | null {
  const parts: string[] = [];
  if (objects.column) {
    parts.push(`the \`${RETIRED_SIZES_COLUMN}\` column of the \`media\` table`);
  }
  if (objects.tableRows !== null) {
    parts.push(
      `the \`${RETIRED_IMAGE_SIZES_TABLE}\` table (${objects.tableRows} ${objects.tableRows === 1 ? "row" : "rows"}, the size definitions)`
    );
  }
  if (parts.length === 0) return null;
  return now
    ? `Now \`${DROP_SIZES_COMMAND}\` drops ${parts.join(" and ")}.`
    : `Once no item holds sizes, \`${DROP_SIZES_COMMAND}\` drops ${parts.join(" and ")}.`;
}

/** How a size file is named in the output: never with a query or credentials. */
function shown(path: string): string {
  return storedPathForLog(path);
}

function keptReason(kept: KeptSize): string {
  return kept.reason === "thumbnail"
    ? "the item's thumbnail"
    : "a media item uses it as an original or a thumbnail";
}

function itemHeading(plan: ItemPlan): string {
  return `media ${plan.id} (${shown(plan.filename)})`;
}

/** What the run did, for its summary and exit status. */
export interface SizeRemovalReport {
  itemsCleared: number;
  filesRemoved: number;
  filesKept: number;
  /** Items left as they were, each with what stopped it. */
  itemsLeft: Array<{ id: string; reasons: string[] }>;
}

/**
 * What leaves an item's stored sizes as they are before anything of it is
 * removed: a size whose file cannot be located, or one on another storage.
 */
function blockers(plan: ItemPlan, storageType: string): string[] {
  const reasons: string[] = [];
  if (plan.unlocated.length > 0) {
    reasons.push(
      `the stored file of ${plan.unlocated.join(", ")} cannot be located from the record`
    );
  }
  if (plan.elsewhere.length > 0) {
    const where = [
      ...new Set(plan.elsewhere.map(size => storedPathForLog(size.url))),
    ];
    reasons.push(
      `the file of ${plan.elsewhere.map(size => `"${size.name}"`).join(", ")} is not on the media storage configured now (${storageType}), but at ${where.join(", ")}; run this with the storage it was uploaded to configured`
    );
  }
  return reasons;
}

/** Lists what an `--apply` run would do, changing nothing. */
function sayPlan(
  plans: readonly ItemPlan[],
  objects: RetiredObjects,
  storage: SizeFileStorage,
  say: (line: string) => void
): void {
  say("Dry run: nothing is changed.");
  let removing = 0;
  let keeping = 0;
  let clearing = 0;
  for (const plan of plans) {
    say(itemHeading(plan));
    for (const file of plan.remove) {
      say(`  remove ${shown(file.path)} (size "${file.name}")`);
    }
    for (const kept of plan.keep) {
      say(
        `  keep   ${shown(kept.path)} (size "${kept.name}": ${keptReason(kept)})`
      );
    }
    const reasons = blockers(plan, storage.getType());
    if (reasons.length > 0) {
      for (const reason of reasons) {
        say(`  leave  its stored sizes as they are: ${reason}`);
      }
    } else {
      say("  clear  its stored sizes");
      clearing += 1;
    }
    removing += plan.remove.length;
    keeping += plan.keep.length;
  }
  say(
    `Would remove ${removing} ${removing === 1 ? "file" : "files"} from storage, keep ${keeping}, and clear the stored sizes of ${clearing} of ${plans.length} ${plans.length === 1 ? "item" : "items"}.`
  );
  const drops = retiredObjectsLine(objects);
  if (drops) say(drops);
  say(
    "Back up the database and the media storage first, then run again with --apply."
  );
}

/**
 * Whether a storage's error says the file is not there, and nothing else:
 * local disk's ENOENT, S3's NoSuchKey, Vercel Blob's not-found error. Each
 * names the file. A bare 404, or an error named only `NotFound`, does not: a
 * bucket that does not exist (S3's NoSuchBucket is a 404) or a storage reached
 * at the wrong address answers so too, while the file may still be served
 * from where it is. Those, a refusal, an outage and any unknown shape say
 * nothing about the file.
 */
function isDefinitelyNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, name } = error as { code?: unknown; name?: unknown };
  return (
    code === "ENOENT" || name === "NoSuchKey" || name === "BlobNotFoundError"
  );
}

/**
 * Removes one size file, retrying a transient failure. A delete of a file
 * already gone succeeds on every adapter but one that says so in its error,
 * and only that error counts as removed: whether the file is still there is
 * never asked afterwards, since two adapters answer that `false` for any
 * failure to ask.
 */
async function removeSizeFile(
  storage: SizeFileStorage,
  path: string
): Promise<unknown> {
  try {
    await withRetry(() => storage.delete(path), {
      maxAttempts: 3,
      baseDelayMs: 500,
      shouldRetry: isTransientError,
    });
    return null;
  } catch (error) {
    return isDefinitelyNotFound(error) ? null : error;
  }
}

/**
 * Carries out one item's plan, saying what happened to each file. A file in
 * `usedNow`, which a media item came to use as its original or thumbnail
 * after the listing, is kept.
 */
async function applyItem(
  plan: ItemPlan,
  usedNow: ReadonlySet<string>,
  storage: SizeFileStorage,
  store: Pick<RetiredSizesStore, "clearSizes">,
  say: (line: string) => void,
  report: SizeRemovalReport
): Promise<void> {
  say(itemHeading(plan));
  // Nothing of an item is removed when one of its sizes cannot be located or
  // is elsewhere: its `sizes` stays, and with it the record of every file.
  const reasons = blockers(plan, storage.getType());
  if (reasons.length === 0) {
    for (const file of plan.remove) {
      if (usedNow.has(file.path)) {
        report.filesKept += 1;
        say(
          `  kept    ${shown(file.path)} (a media item uses it now as an original or a thumbnail)`
        );
        continue;
      }
      const failure = await removeSizeFile(storage, file.path);
      if (failure === null) {
        report.filesRemoved += 1;
        say(`  removed ${shown(file.path)}`);
      } else {
        reasons.push(
          `could not remove ${shown(file.path)}: ${errorForLog(failure)}`
        );
      }
    }
  }
  for (const kept of plan.keep) {
    report.filesKept += 1;
    say(`  kept    ${shown(kept.path)} (${keptReason(kept)})`);
  }
  if (reasons.length > 0) {
    leaveItem(plan, reasons, say, report);
    return;
  }
  await store.clearSizes(plan.id);
  report.itemsCleared += 1;
  say("  cleared its stored sizes");
}

/** Says why an item is left as it was, and records it. */
function leaveItem(
  plan: ItemPlan,
  reasons: string[],
  say: (line: string) => void,
  report: SizeRemovalReport
): void {
  for (const reason of reasons) say(`  ${reason}`);
  say("  its stored sizes are kept, so a later run can finish it");
  report.itemsLeft.push({ id: plan.id, reasons });
}

/**
 * The plans in batches of about {@link RECHECK_BATCH} files to remove, the
 * number the orphan removal asks about at once: each batch is checked once,
 * just before its files go, rather than each file or the whole run.
 */
function inBatches(plans: readonly ItemPlan[]): ItemPlan[][] {
  const batches: ItemPlan[][] = [];
  let current: ItemPlan[] = [];
  let files = 0;
  for (const plan of plans) {
    current.push(plan);
    files += plan.remove.length;
    if (files >= RECHECK_BATCH) {
      batches.push(current);
      current = [];
      files = 0;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Lists, and with `apply` removes, the size files stored for media items, then
 * clears each item's `sizes` once its files are gone. Says what it does
 * through `say` and returns the exit status: 1 when any item was left as it
 * was, 0 otherwise.
 *
 * The listing reads the whole table once. An upload or an import can then
 * make a listed file an item's original or thumbnail before it is removed, so
 * `referencedNow`, the question `nextly media orphans` asks just before its
 * removals, is asked again for each batch's files just before they go; a file
 * in use by then is kept, and an ask that cannot be answered stops the run,
 * leaving every item not yet done as it was.
 */
export async function removeStoredImageSizes(options: {
  store: RetiredSizesStore;
  storage: SizeFileStorage;
  objects: RetiredObjects;
  apply: boolean;
  /** Which of a batch of files an item uses now, asked just before they go. */
  referencedNow: ReferencedNow;
  say: (line: string) => void;
}): Promise<{ code: number; report: SizeRemovalReport }> {
  const { store, storage, objects, apply, say } = options;
  const report: SizeRemovalReport = {
    itemsCleared: 0,
    filesRemoved: 0,
    filesKept: 0,
    itemsLeft: [],
  };
  const plans = await planSizeRemoval(store, storage);
  if (plans.length === 0) {
    say("No media item holds image sizes: there are no size files to remove.");
    const drops = retiredObjectsLine(objects, true);
    if (drops) say(drops);
    return { code: 0, report };
  }
  if (!apply) {
    sayPlan(plans, objects, storage, say);
    return { code: 0, report };
  }
  await applyPlans(plans, {
    storage,
    store,
    referencedNow: options.referencedNow,
    say,
    report,
  });
  return { code: sayApplied(report, objects, say), report };
}

/** What carrying out the plans works with, and records into. */
interface ApplyContext {
  storage: SizeFileStorage;
  store: Pick<RetiredSizesStore, "clearSizes">;
  referencedNow: ReferencedNow;
  say: (line: string) => void;
  report: SizeRemovalReport;
}

/**
 * Carries out the plans a batch at a time, asking `referencedNow` about each
 * batch's files just before they go; an ask that cannot be answered leaves
 * that batch's items, and every later one, as they were.
 */
async function applyPlans(
  plans: readonly ItemPlan[],
  { storage, store, referencedNow, say, report }: ApplyContext
): Promise<void> {
  const batches = inBatches(plans);
  for (const [at, batch] of batches.entries()) {
    const paths = batch.flatMap(plan => plan.remove.map(file => file.path));
    const usedNow =
      paths.length === 0 ? new Set<string>() : await referencedNow(paths);
    if (usedNow === null) {
      const reason =
        "whether a media item uses its size files now could not be checked just before their removal";
      for (const plan of batches.slice(at).flat()) {
        say(itemHeading(plan));
        leaveItem(plan, [reason], say, report);
      }
      return;
    }
    for (const plan of batch) {
      await applyItem(plan, usedNow, storage, store, say, report);
    }
  }
}

/** Says what an `--apply` run did, and answers its exit status. */
function sayApplied(
  report: SizeRemovalReport,
  objects: RetiredObjects,
  say: (line: string) => void
): number {
  say(
    `Removed ${report.filesRemoved} ${report.filesRemoved === 1 ? "file" : "files"} and cleared the stored sizes of ${report.itemsCleared} ${report.itemsCleared === 1 ? "item" : "items"}; kept ${report.filesKept} ${report.filesKept === 1 ? "file" : "files"} still in use.`
  );
  const left = report.itemsLeft.length;
  if (left > 0) {
    say(
      `${left} ${left === 1 ? "item was" : "items were"} left as ${left === 1 ? "it was" : "they were"}: ${report.itemsLeft.map(item => item.id).join(", ")}. Run the command again once the cause is fixed.`
    );
    return 1;
  }
  const drops = retiredObjectsLine(objects, true);
  if (drops) say(drops);
  return 0;
}

/**
 * The startup notice while the retired column or table is still there: what
 * is left, and the steps that remove it, in the order a deployment takes them.
 */
export function formatRetiredImageSizesNotice(state: RetiredObjects): string {
  const lines = [
    "[nextly] Your database still has image sizes from before Nextly stopped making them.",
    "",
  ];
  if (state.column) {
    lines.push(
      `  media.${RETIRED_SIZES_COLUMN}: the column that records where each older item's size files are`
    );
  }
  if (state.tableRows !== null) {
    lines.push(
      `  ${RETIRED_IMAGE_SIZES_TABLE}: ${state.tableRows} ${state.tableRows === 1 ? "row" : "rows"} (size definitions nothing reads)`
    );
  }
  lines.push(
    "",
    "  Once this release is serving every request, back up the database and the media storage, then:",
    `  1. \`${REMOVE_SIZES_COMMAND}\` lists the size files; with --apply it removes them and clears each item's sizes.`,
    `  2. \`${DROP_SIZES_COMMAND}\` then drops the column and the table. It drops nothing while any item still names size files.`,
    "  `nextly migrate` never drops them. Until then the site keeps working; nothing reads them."
  );
  return lines.join("\n");
}
