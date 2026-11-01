/**
 * Where an image size an item stored before sizes were removed has its file,
 * from what its record holds: the one answer `nextly media remove-sizes` and
 * a delete of the item both use, so a size goes, or stays named, the same
 * way through either.
 *
 * @module domains/media/size-location
 */
import { siblingStoredPath } from "../../storage/stored-path";

import { canonicalStoredPath } from "./orphan-thumbnails";

/** What locating a size asks of the storage configured now. */
export interface SizeLocator {
  /** Where this storage serves a stored path, to tell its files from another's. */
  getPublicUrl(filePath: string): string;
  getType(): string;
}

/** A size's record, as far as finding its file goes. */
export interface SizeRecord {
  path?: string;
  url?: string;
}

/**
 * The stored path of a size: its own, or the one worked out from its URL
 * beside the item's original (`siblingStoredPath`). Undefined when the
 * record shows neither.
 */
export function pathOfSize(
  size: SizeRecord,
  original: { filename: string; url: string }
): string | undefined {
  if (size.path) return size.path;
  if (!size.url) return undefined;
  return siblingStoredPath(
    { path: original.filename, url: original.url },
    size.url
  );
}

/**
 * Where a URL serves its file: its origin, or none for a URL relative to the
 * site, and its path, percent-encoded alike either way.
 */
function servedAt(url: string): { origin: string | null; path: string } {
  const key = canonicalStoredPath(url).replace(/[?#].*$/, "");
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
export function servedHere(
  url: string,
  path: string,
  storage: SizeLocator
): boolean {
  const recorded = servedAt(url);
  const here = servedAt(storage.getPublicUrl(path));
  if (recorded.path !== here.path) return false;
  if (recorded.origin === here.origin) return true;
  const oneRelative = recorded.origin === null || here.origin === null;
  return oneRelative && storage.getType() === "local";
}

/**
 * The stored path of a size recorded by its URL alone, where that URL is
 * shown to be the storage configured now serving it; undefined otherwise:
 * no storage given, a path the record does not show, or a file another
 * storage serves, whose key handed to this one would remove nothing there,
 * or this storage's file of the same name.
 */
export function urlOnlySizeHere(
  url: string,
  original: { filename: string; url: string },
  storage: SizeLocator | undefined
): string | undefined {
  if (storage === undefined) return undefined;
  const path = pathOfSize({ url }, original);
  return path !== undefined && servedHere(url, path, storage)
    ? path
    : undefined;
}
