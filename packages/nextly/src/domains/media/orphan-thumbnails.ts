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
 * A stored path with each run of slashes written once, a key without a
 * leading one, and a URL without its query and fragment. The storage puts a collection's files under `<prefix>/<key>`,
 * so a prefix written with a slash at its end is stored as `media//...`, and
 * one written with a slash at its start as `/media/...`, where keys are kept
 * as given (S3). Local disk lists its files relative to its folder, with
 * single separators, so it reads both back as `media/...` while the records
 * keep the spelling they were stored under. Paths are compared in this form:
 * it can only make more files count as referenced, never fewer.
 */
export function canonicalStoredPath(path: string): string {
  const scheme = /^https?:\/\//.exec(path)?.[0];
  if (scheme) {
    // A URL without its query and fragment: a storage can list a file by a
    // signed URL that a record names without them. A key keeps a `?`,
    // which S3 allows in one.
    const located = path.slice(scheme.length).replace(/[?#].*$/, "");
    return scheme + located.replace(/\/{2,}/g, "/");
  }
  return path.replace(/\/{2,}/g, "/").replace(/^\//, "");
}

/** A collection prefix as the folder the storage puts its files in. */
function folderOf(prefix = ""): string {
  return canonicalStoredPath(prefix).replace(/^\/+|\/+$/g, "");
}

/**
 * Whether the media collection's place in its storage is its own: it has a
 * prefix, and no other collection shares it, with the same prefix, one
 * inside it, one around it, or none (a collection with no prefix stores at
 * the root, and an upload to it can name any folder, media's among them).
 * Other collections are compared by prefix whatever storage they use: two
 * storage plugins on one bucket are two adapters, and nothing shows they are
 * the same place. Only then does a file's place
 * show it is media's. Without one, media shares the storage's root with every
 * other upload to it, any of which can store a file of the same form, named
 * as a person named it.
 */
export function mediaPlaceIsExclusive(
  prefix: string | undefined,
  otherPrefixes: readonly (string | undefined)[]
): boolean {
  return (
    folderOf(prefix) !== "" &&
    !otherPrefixes.some(other => sharesMediaPlace(prefix, other))
  );
}

/**
 * The collections among `others` that share media's place: the ones that
 * keep media's prefix from being its own, by the same test as
 * {@link mediaPlaceIsExclusive}. Named to the site, since a prefix for media
 * cannot help while one of them shares it.
 */
export function collectionsSharingMediaPlace(
  prefix: string | undefined,
  others: ReadonlyArray<{ slug: string; prefix?: string }>
): string[] {
  return others
    .filter(other => sharesMediaPlace(prefix, other.prefix))
    .map(other => other.slug);
}

/**
 * Whether a collection with prefix `other` shares media's place: its folder
 * is media's, or holds it, or sits in it; or its prefix begins media's, since
 * the storage joins a prefix and an upload's folder as written, so `med` with
 * the folder `ia` stores under `media`.
 */
function sharesMediaPlace(
  prefix: string | undefined,
  other: string | undefined
): boolean {
  const media = folderOf(prefix);
  const theirs = folderOf(other);
  return overlaps(media, theirs) || media.startsWith(theirs);
}

/** Whether two folders are one, or one holds the other; the root holds all. */
function overlaps(a: string, b: string): boolean {
  if (a === "" || b === "") return true;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * Whether a stored file is where media uploads put an upload-time thumbnail,
 * in the form they give it: in the media collection's configured folder,
 * which the storage applies to each upload, and nowhere else, so another
 * collection's folder holds no candidates. UploadThing keeps no folders and
 * its keys carry no name, so there a file is judged by the name it was
 * uploaded under.
 */
export function isMediaThumbnail(
  entry: StoredFileEntry,
  prefix = "",
  /**
   * Whether the storage keeps a key as written (S3), where `/media/...` and
   * `media//...` are other keys than the `media/...` an upload under the
   * prefix `media` makes, and may be anything's. Elsewhere a filesystem, or
   * a URL's path, reads every spelling as one.
   */
  keysAsWritten = false
): boolean {
  if (entry.name !== undefined) return NAMED.test(entry.name);
  if (keysAsWritten) return isKeyedUnder(locationOf(entry.path), prefix);
  const location = canonicalStoredPath(locationOf(entry.path));
  const folder = folderOf(prefix);
  if (folder !== "" && !location.startsWith(`${folder}/`)) return false;
  const below = folder === "" ? location : location.slice(folder.length + 1);
  return KEYED.test(below) || NAMED.test(below);
}

/**
 * Whether `key` is in the form an upload under `prefix` gives a thumbnail,
 * spelled as the storage writes it: the prefix as configured, then `/`,
 * then the thumbnail's own key (`MediaStorage.upload`, `generateKey`).
 */
function isKeyedUnder(key: string, prefix: string): boolean {
  if (prefix === "") return KEYED.test(key) || NAMED.test(key);
  if (!key.startsWith(`${prefix}/`)) return false;
  const below = key.slice(prefix.length + 1);
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

/** `paths` in the form they are compared in. */
function canonicalSet(paths: ReadonlySet<string>): Set<string> {
  return new Set([...paths].map(canonicalStoredPath));
}

export type OrphanSearch =
  | { listable: false }
  | {
      listable: true;
      /** Left-behind thumbnails, by stored path. */
      orphans: string[];
      /**
       * Unreferenced thumbnails nothing shows are media's: known only by the
       * name they were uploaded under, on a storage that keeps no folders
       * (UploadThing), or found where media's place is not its own. Another
       * upload can give a file the same name or form, so these are for the
       * site to check, and are never removed.
       */
      unconfirmed: Array<{ path: string; name?: string }>;
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
  options: {
    referenced: ReadonlySet<string>;
    prefix?: string;
    /** Whether media's place is its own ({@link mediaPlaceIsExclusive}). */
    exclusive: boolean;
    now?: Date;
  }
): Promise<OrphanSearch> {
  if (!adapter.list) return { listable: false };
  const now = (options.now ?? new Date()).getTime();
  const referenced = canonicalSet(options.referenced);
  const orphans: string[] = [];
  const unconfirmed: Array<{ path: string; name?: string }> = [];
  let tooRecent = 0;
  // Local disk reads every spelling of a path as one, and Vercel Blob
  // writes a prefix's trailing slash once (`media/` stores `media/...`);
  // any other storage, a custom one among them, may keep keys as written.
  const type = adapter.getType();
  const keysAsWritten = type !== "local" && type !== "vercel-blob";
  for await (const entry of adapter.list()) {
    if (!isMediaThumbnail(entry, options.prefix, keysAsWritten)) continue;
    if (referenced.has(canonicalStoredPath(entry.path))) continue;
    const stored = entry.lastModified?.getTime();
    // A time that is not a date (`new Date(NaN)`) is no time at all.
    if (
      stored === undefined ||
      !Number.isFinite(stored) ||
      now - stored < ORPHAN_MIN_AGE_MS
    ) {
      tooRecent++;
      continue;
    }
    if (entry.name !== undefined || !options.exclusive) {
      unconfirmed.push({ path: entry.path, name: entry.name });
    } else {
      orphans.push(entry.path);
    }
  }
  return { listable: true, orphans, unconfirmed, tooRecent };
}

/** What the media table refers to, as a delete of each item would read it. */
export interface MediaReferences {
  /** Every stored path an item refers to. */
  paths: ReadonlySet<string>;
  /**
   * Thumbnails, by URL, whose stored location the record does not show
   * (`storedFilesOf`): one of the listed files may be such a thumbnail, still
   * in use, under a path nothing here can match.
   */
  unlocated: readonly string[];
}

export interface OrphanRemoval {
  removed: string[];
  /** Referred to again by the time it would have been removed. */
  kept: string[];
  /** With what the storage threw, which can quote a signed URL. */
  failed: Array<{ path: string; error: unknown }>;
  /**
   * Not tried: whether an item refers to the first of these could not be
   * said just before its removal, so none of them was removed.
   */
  stopped: string[];
}

/**
 * Of `paths`, the ones a media item refers to now, or `null` when that
 * cannot be said, as when the media table cannot be read.
 */
export type ReferencedNow = (
  paths: readonly string[]
) => Promise<ReadonlySet<string> | null>;

/** How many listed files are asked about at once, just before their removal. */
const RECHECK_BATCH = 50;

/**
 * Removes each of `orphans` that is still unreferenced just before its
 * removal, asked of `referencedNow` then, not at the listing: an item can
 * come to refer to a listed file in between, as an upload or an import
 * commits. Asked for a batch of {@link RECHECK_BATCH} files at a time, in
 * one search, rather than once per file. Stops, and removes no more, once an
 * ask cannot be answered. An item that comes to refer to a file while its
 * batch is being removed is not seen; nothing short of a lock on references
 * closes that.
 */
export async function removeOrphanThumbnails(
  adapter: IStorageAdapter,
  orphans: readonly string[],
  referencedNow: ReferencedNow
): Promise<OrphanRemoval> {
  const result: OrphanRemoval = {
    removed: [],
    kept: [],
    failed: [],
    stopped: [],
  };
  for (let start = 0; start < orphans.length; start += RECHECK_BATCH) {
    const batch = orphans.slice(start, start + RECHECK_BATCH);
    const referenced = await referencedNow(batch);
    if (referenced === null) {
      result.stopped = orphans.slice(start);
      break;
    }
    for (const path of batch) {
      if (referenced.has(path)) {
        result.kept.push(path);
        continue;
      }
      try {
        await adapter.delete(path);
        result.removed.push(path);
      } catch (error) {
        result.failed.push({ path, error });
      }
    }
  }
  return result;
}
