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
 * @module domains/media/retired-image-sizes
 */
import { isTransientError, withRetry } from "../../storage/retry";
import { siblingStoredPath } from "../../storage/stored-path";

import { canonicalStoredPath } from "./orphan-thumbnails";
import { errorForLog, storedPathForLog } from "./remove-stored-files";
import {
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

/** A size entry, read as an object with optional string `path` and `url`. */
function sizeEntry(name: string, value: unknown): StoredSize {
  if (!value || typeof value !== "object") return { name };
  const { path, url } = value as { path?: unknown; url?: unknown };
  return {
    name,
    ...(typeof path === "string" && path !== "" ? { path } : {}),
    ...(typeof url === "string" && url !== "" ? { url } : {}),
  };
}

/**
 * The sizes a `sizes` value holds, from the column as each dialect returns it:
 * an object on PostgreSQL and MySQL, a JSON string on SQLite.
 *
 * Unreadable when it is text that is not JSON, or JSON that is not an object
 * of sizes. Such a value may still name files, so it is never read as empty:
 * nothing can show that clearing it loses nothing.
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
  return {
    readable: true,
    sizes: Object.entries(parsed).map(([name, entry]) =>
      sizeEntry(name, entry)
    ),
  };
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

/** The storage surface the removal uses. */
export interface SizeFileStorage {
  delete(filePath: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
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

/** One item's plan, judged against everything every item uses. */
function planItem(row: MediaSizesRow, inUse: InUse): ItemPlan {
  const plan: ItemPlan = {
    id: row.id,
    filename: row.filename,
    remove: [],
    keep: [],
    unlocated: [],
  };
  const read = readStoredSizes(row.sizes);
  if (!read.readable) {
    plan.unlocated.push("(its stored sizes cannot be read)");
    return plan;
  }
  const planned = new Set<string>();
  for (const size of read.sizes) {
    const path = pathOfSize(size, row);
    if (path === undefined) {
      // A size with no file named and no URL had nothing stored for it.
      if (size.url) plan.unlocated.push(size.name);
      continue;
    }
    if (isOwnThumbnail(size, path, row)) {
      plan.keep.push({ name: size.name, path, reason: "thumbnail" });
    } else if (isInUse(inUse, size, path)) {
      plan.keep.push({ name: size.name, path, reason: "in-use" });
    } else if (!planned.has(canonicalStoredPath(path))) {
      planned.add(canonicalStoredPath(path));
      plan.remove.push({ name: size.name, path });
    }
  }
  return plan;
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
  store: Pick<RetiredSizesStore, "rows">
): Promise<ItemPlan[]> {
  const inUse: InUse = { paths: new Set(), urls: new Set(), names: new Set() };
  const holding: MediaSizesRow[] = [];
  for await (const page of store.rows()) {
    for (const row of page) {
      addInUse(inUse, row);
      if (holdsStoredSizes(row.sizes)) holding.push(row);
    }
  }
  return holding.map(row => planItem(row, inUse));
}

/** What the database objects left to drop hold, for the listing. */
export interface RetiredObjects {
  /** Whether the media table still has its `sizes` column. */
  column: boolean;
  /** The `image_sizes` table's rows, or null when there is no such table. */
  tableRows: number | null;
}

/** The line naming what `nextly migrate` drops once no item holds sizes. */
export function retiredObjectsLine(objects: RetiredObjects): string | null {
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
  return `Once no item holds sizes, \`nextly migrate\` drops ${parts.join(" and ")}.`;
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

/** Lists what an `--apply` run would do, changing nothing. */
function sayPlan(
  plans: readonly ItemPlan[],
  objects: RetiredObjects,
  say: (line: string) => void
): void {
  say("Dry run: nothing is changed.");
  let removing = 0;
  let keeping = 0;
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
    if (plan.unlocated.length > 0) {
      say(
        `  leave  its stored sizes as they are: the stored file of ${plan.unlocated.join(", ")} cannot be located from the record`
      );
    } else {
      say("  clear  its stored sizes");
    }
    removing += plan.remove.length;
    keeping += plan.keep.length;
  }
  const clearing = plans.filter(plan => plan.unlocated.length === 0).length;
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
 * Removes one size file, retrying a transient failure. A file the storage no
 * longer has counts as removed, so a run after a partial one goes on.
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
    try {
      if (!(await storage.exists(path))) return null;
    } catch {
      // Whether it is still there cannot be asked: the delete's own failure
      // is what is reported.
    }
    return error;
  }
}

/** Carries out one item's plan, saying what happened to each file. */
async function applyItem(
  plan: ItemPlan,
  storage: SizeFileStorage,
  store: Pick<RetiredSizesStore, "clearSizes">,
  say: (line: string) => void,
  report: SizeRemovalReport
): Promise<void> {
  say(itemHeading(plan));
  const reasons: string[] = [];
  if (plan.unlocated.length > 0) {
    reasons.push(
      `the stored file of ${plan.unlocated.join(", ")} cannot be located from the record`
    );
  }
  // Nothing of an item is removed when one of its sizes cannot be located:
  // its `sizes` stays, and with it the record of every file it names.
  if (reasons.length === 0) {
    for (const file of plan.remove) {
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
    for (const reason of reasons) say(`  ${reason}`);
    say("  its stored sizes are kept, so a later run can finish it");
    report.itemsLeft.push({ id: plan.id, reasons });
    return;
  }
  await store.clearSizes(plan.id);
  report.itemsCleared += 1;
  say("  cleared its stored sizes");
}

/**
 * Lists, and with `apply` removes, the size files stored for media items, then
 * clears each item's `sizes` once its files are gone. Says what it does
 * through `say` and returns the exit status: 1 when any item was left as it
 * was, 0 otherwise.
 */
export async function removeStoredImageSizes(options: {
  store: RetiredSizesStore;
  storage: SizeFileStorage;
  objects: RetiredObjects;
  apply: boolean;
  say: (line: string) => void;
}): Promise<{ code: number; report: SizeRemovalReport }> {
  const { store, storage, objects, apply, say } = options;
  const report: SizeRemovalReport = {
    itemsCleared: 0,
    filesRemoved: 0,
    filesKept: 0,
    itemsLeft: [],
  };
  const plans = await planSizeRemoval(store);
  if (plans.length === 0) {
    say("No media item holds image sizes: there are no size files to remove.");
    const drops = retiredObjectsLine(objects);
    if (drops) say(drops.replace(/^Once no item holds sizes, /, "Now "));
    return { code: 0, report };
  }
  if (!apply) {
    sayPlan(plans, objects, say);
    return { code: 0, report };
  }
  for (const plan of plans) {
    await applyItem(plan, storage, store, say, report);
  }
  say(
    `Removed ${report.filesRemoved} ${report.filesRemoved === 1 ? "file" : "files"} and cleared the stored sizes of ${report.itemsCleared} ${report.itemsCleared === 1 ? "item" : "items"}; kept ${report.filesKept} ${report.filesKept === 1 ? "file" : "files"} still in use.`
  );
  if (report.itemsLeft.length > 0) {
    say(
      `${report.itemsLeft.length} ${report.itemsLeft.length === 1 ? "item was" : "items were"} left as ${report.itemsLeft.length === 1 ? "it was" : "they were"}: ${report.itemsLeft.map(item => item.id).join(", ")}. Run the command again once the cause is fixed.`
    );
    return { code: 1, report };
  }
  const drops = retiredObjectsLine(objects);
  if (drops) say(drops.replace(/^Once no item holds sizes, /, "Now "));
  return { code: 0, report };
}

/**
 * The startup notice while the retired column or table is still there: what
 * is left, and the two steps that remove it.
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
    "  Back up the database and the media storage, then:",
    `  1. \`${REMOVE_SIZES_COMMAND}\` lists the size files; with --apply it removes them and clears each item's sizes.`,
    "  2. `nextly migrate` then drops the column and the table. It keeps both while any item still names size files.",
    "  Until then the site keeps working; nothing reads them."
  );
  return lines.join("\n");
}

/**
 * The warning `nextly migrate` gives when it keeps the column and table
 * because items still name size files.
 */
export function formatRetiredImageSizesKept(itemsWithSizes: number): string {
  return [
    `Kept the media table's \`${RETIRED_SIZES_COLUMN}\` column and the \`${RETIRED_IMAGE_SIZES_TABLE}\` table: ${itemsWithSizes} ${itemsWithSizes === 1 ? "item still names its" : "items still name their"} image size files, which dropping the column would leave in storage with nothing pointing at them.`,
    `Run \`${REMOVE_SIZES_COMMAND}\` (then again with --apply) to remove those files, then run \`nextly migrate\` again.`,
  ].join(" ");
}
