/**
 * Which kind of file a MIME type is, as the media library shows it and
 * narrows to it: said once, for the admin's badge and for the query that
 * pages the library by kind, so an item is counted under the kind it is
 * shown as.
 *
 * Imports nothing, so the admin reaches it through `nextly/media-categories`
 * and takes nothing more. Not a public API; it may change without notice.
 *
 * @module domains/media/media-categories
 */

/** The kinds of file the media library names. */
export type MediaCategory = "image" | "video" | "audio" | "document" | "other";

/** The kinds a MIME type's first part names: `image/png` is an image. */
export const MEDIA_TYPE_PREFIXES = {
  image: "image/",
  video: "video/",
  audio: "audio/",
} as const satisfies Partial<Record<MediaCategory, string>>;

/**
 * What makes a file a document: a PDF, an office file (Word's own type and
 * the vendor `application/vnd.` types) and any text. What no kind names is
 * `other`.
 */
export const DOCUMENT_MIME_TYPES: {
  readonly exact: readonly string[];
  readonly prefixes: readonly string[];
} = {
  exact: ["application/pdf"],
  prefixes: ["application/vnd.", "application/msword", "text/"],
};

/** The kind of file a MIME type is; a missing or blank one is `other`. */
export function mediaCategoryOf(
  mimeType: string | null | undefined
): MediaCategory {
  if (!mimeType || mimeType.trim() === "") return "other";
  for (const [category, prefix] of Object.entries(MEDIA_TYPE_PREFIXES)) {
    if (mimeType.startsWith(prefix)) return category as MediaCategory;
  }
  if (
    DOCUMENT_MIME_TYPES.exact.includes(mimeType) ||
    DOCUMENT_MIME_TYPES.prefixes.some(prefix => mimeType.startsWith(prefix))
  ) {
    return "document";
  }
  return "other";
}
