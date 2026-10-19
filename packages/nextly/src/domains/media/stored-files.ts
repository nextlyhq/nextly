import { siblingStoredPath } from "../../storage/stored-path";

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

/** What a media record holds about where its files went. */
export interface MediaFilesRecord {
  filename: string;
  url: string;
  thumbnailUrl?: string | null;
  sizes?: unknown;
}

/**
 * Every file stored for an item: its original, every image size, and the
 * thumbnail made at upload. The record holds only that thumbnail's URL, so
 * its path is worked out from what the record holds about the original; a
 * thumbnail that is one of the sizes is already among them. A thumbnail whose
 * location the record does not show is returned apart, by its URL, so that
 * nothing is removed in its place.
 */
export function storedFilesOf(media: MediaFilesRecord): {
  paths: string[];
  unlocated: string[];
} {
  const paths = [media.filename, ...variantPaths(media.sizes)];
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
  return { paths: [...new Set(paths.filter(Boolean))], unlocated };
}
