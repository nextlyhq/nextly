import type { IStorageAdapter, StoredFileEntry } from "../../storage/types";

/**
 * Upload-time thumbnails that no media item refers to any more, as deletes
 * before every stored file was removed left them, still publicly served.
 */

/**
 * How long an unreferenced thumbnail must have been stored before it counts
 * as left behind. An upload or a regeneration stores its thumbnail before its
 * record refers to it, so a newer one may belong to one still in progress.
 */
export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

/**
 * The forms media uploads give an upload-time thumbnail, below the media
 * collection's prefix: `YYYY/MM/<uuid>-thumb_<name>` on local disk and S3,
 * and `thumb_<name>` on Vercel Blob, whose pathname is the file's name.
 */
const KEYED =
  /^\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-thumb_[^/]+$/i;
const NAMED = /^thumb_[^/]+$/;

/**
 * Whether a stored file is where media uploads put an upload-time thumbnail,
 * in the form they give it: below the media collection's configured prefix,
 * which the storage applies as each upload's folder, and nowhere else, so
 * another collection's files are never candidates. UploadThing keeps no
 * folders and its keys carry no name, so there a file is judged by the name
 * it was uploaded under.
 */
export function isMediaThumbnail(entry: StoredFileEntry, prefix = ""): boolean {
  if (entry.name !== undefined) return NAMED.test(entry.name);
  const location = locationOf(entry.path);
  if (!location.startsWith(prefix)) return false;
  const below = location.slice(prefix.length);
  return KEYED.test(below) || NAMED.test(below);
}

/** A stored path as a location: a key as it is, a URL by its own path. */
function locationOf(path: string): string {
  if (!/^https?:\/\//.test(path)) return path;
  try {
    return decodeURIComponent(new URL(path).pathname.replace(/^\/+/, ""));
  } catch {
    return path;
  }
}

export type OrphanSearch =
  | { listable: false }
  | {
      listable: true;
      /** Left-behind thumbnails, by stored path. */
      orphans: string[];
      /**
       * Unreferenced thumbnails known only by the name they were uploaded
       * under, on a storage that keeps no folders (UploadThing). Another
       * uploader to the same storage can give a file that name, so nothing
       * shows these are media's: they are for the site to check, and are
       * never removed.
       */
      unconfirmed: Array<{ path: string; name: string }>;
      /** Unreferenced thumbnails too recent, or of unknown age, to be sure of. */
      tooRecent: number;
    };

/**
 * The upload-time thumbnails in `adapter` that no media item refers to and
 * that were stored more than {@link ORPHAN_MIN_AGE_MS} ago. Changes nothing.
 * A file whose age the storage does not say counts as too recent: an upload
 * in progress must never be taken for a leftover.
 */
export async function findOrphanThumbnails(
  adapter: IStorageAdapter,
  options: { referenced: ReadonlySet<string>; prefix?: string; now?: Date }
): Promise<OrphanSearch> {
  if (!adapter.list) return { listable: false };
  const now = (options.now ?? new Date()).getTime();
  const orphans: string[] = [];
  const unconfirmed: Array<{ path: string; name: string }> = [];
  let tooRecent = 0;
  for await (const entry of adapter.list()) {
    if (!isMediaThumbnail(entry, options.prefix)) continue;
    if (options.referenced.has(entry.path)) continue;
    const stored = entry.lastModified?.getTime();
    if (stored === undefined || now - stored < ORPHAN_MIN_AGE_MS) {
      tooRecent++;
      continue;
    }
    if (entry.name !== undefined) {
      unconfirmed.push({ path: entry.path, name: entry.name });
    } else {
      orphans.push(entry.path);
    }
  }
  return { listable: true, orphans, unconfirmed, tooRecent };
}

export interface OrphanRemoval {
  removed: string[];
  /** Referred to again by the time it would have been removed. */
  kept: string[];
  failed: Array<{ path: string; reason: string }>;
}

/**
 * Removes each of `orphans` that is still unreferenced just before its own
 * removal, asked of `referencedNow` then, not at the listing: an item can
 * come to refer to a listed file in between.
 */
export async function removeOrphanThumbnails(
  adapter: IStorageAdapter,
  orphans: readonly string[],
  referencedNow: () => Promise<ReadonlySet<string>>
): Promise<OrphanRemoval> {
  const result: OrphanRemoval = { removed: [], kept: [], failed: [] };
  for (const path of orphans) {
    if ((await referencedNow()).has(path)) {
      result.kept.push(path);
      continue;
    }
    try {
      await adapter.delete(path);
      result.removed.push(path);
    } catch (error) {
      result.failed.push({
        path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
