import { siblingStoredPath } from "../../storage/stored-path";

import { copyPathsOf } from "./copies/copy-rules";
import { urlOnlySizeHere, type SizeLocator } from "./size-location";

/**
 * Which files a media item has in storage, worked out from its record.
 *
 * One answer for every question about it: what a delete removes, and which
 * stored files a search for left-behind ones must treat as still in use.
 */

/** A stored variant as the `sizes` column holds it, as far as this reads it. */
type StoredVariant = { path?: unknown; url?: unknown } | null | undefined;

/** `sizes` as an object, from the column or its JSON-string form. */
function parseSizes(sizes: unknown): Record<string, StoredVariant> | null {
  if (typeof sizes === "string") {
    try {
      return JSON.parse(sizes) as Record<string, StoredVariant>;
    } catch {
      return null;
    }
  }
  return sizes && typeof sizes === "object"
    ? (sizes as Record<string, StoredVariant>)
    : null;
}

/** The stored path of every image size in a `sizes` value. */
export function variantPaths(sizes: unknown): string[] {
  return Object.values(parseSizes(sizes) ?? {}).flatMap(variant =>
    variant && typeof variant.path === "string" ? [variant.path] : []
  );
}

/** The URL of every image size in a `sizes` value that names no path. */
function urlOnlySizes(sizes: unknown): string[] {
  return Object.values(parseSizes(sizes) ?? {}).flatMap(variant => {
    if (!variant || typeof variant.url !== "string" || variant.url === "") {
      return [];
    }
    const named = typeof variant.path === "string" && variant.path !== "";
    return named ? [] : [variant.url];
  });
}

/** What a media record holds about where its files went. */
export interface MediaFilesRecord {
  filename: string;
  /** Which resized copies the original can have, each stored beside it. */
  mimeType: string;
  url: string;
  thumbnailUrl?: string | null;
  sizes?: unknown;
}

/**
 * A record naming one stored file and nothing made from it: no thumbnail, no
 * size and no copy. For a removal that already lists each file it removes,
 * as a replaced item's old files are listed one by one.
 */
export function singleStoredFile(path: string, url: string): MediaFilesRecord {
  return { filename: path, mimeType: "", url };
}

/** The files stored for an item, as far as its record shows them. */
export interface StoredFiles {
  /** Every stored path the record shows, each once. */
  paths: string[];
  /** A thumbnail, by its URL, whose stored location the record does not show. */
  unlocated: string[];
  /**
   * Image sizes, by URL, recorded without a path and not shown to be files of
   * the storage given (`urlOnlySizeHere`): its path cannot be worked out, or
   * another storage serves it, or no storage was given. Their only record is
   * the URL, so a delete names each rather than removing anything for it.
   */
  notHere: string[];
}

/**
 * Every file stored for an item: its original, every image size, the
 * thumbnail made at upload, and every resized copy it can have. A copy's key
 * is derived from the original's, so each one it can have is listed whether
 * or not it was ever asked for; a delete of one never made counts as done. The record holds only that thumbnail's URL, so
 * its path is worked out from what the record holds about the original; a
 * thumbnail that is one of the sizes is already among them. A thumbnail whose
 * location the record does not show is returned apart, by its URL, so that
 * nothing is removed in its place.
 *
 * A size recorded by its URL alone is located as `nextly media remove-sizes`
 * locates it, on `storage`, the storage configured now: its stored path,
 * where that storage is shown to serve it at that URL. Without a storage,
 * none is, so a caller asking only what a record refers to by path reads
 * what it read before such sizes were located.
 */
export function storedFilesOf(
  media: MediaFilesRecord,
  storage?: SizeLocator
): StoredFiles {
  const paths = [
    media.filename,
    ...variantPaths(media.sizes),
    ...copyPathsOf(media),
  ];
  const notHere: string[] = [];
  for (const url of urlOnlySizes(media.sizes)) {
    const path = urlOnlySizeHere(url, media, storage);
    if (path === undefined) notHere.push(url);
    else paths.push(path);
  }
  const sizeUrls = new Set(
    Object.values(parseSizes(media.sizes) ?? {}).map(variant => variant?.url)
  );
  const unlocated: string[] = [];
  if (media.thumbnailUrl && !sizeUrls.has(media.thumbnailUrl)) {
    const thumbnail = siblingStoredPath(
      { path: media.filename, url: media.url },
      media.thumbnailUrl
    );
    if (thumbnail) paths.push(thumbnail);
    else unlocated.push(media.thumbnailUrl);
  }
  return { paths: [...new Set(paths.filter(Boolean))], unlocated, notHere };
}
