/**
 * The stored path of a file uploaded through the same adapter as a media
 * item's original, from the file's URL and what the record holds about the
 * original: its stored path, and the URL the adapter made from it.
 *
 * A media record keeps the original's path and URL but only the URL of the
 * thumbnail made at upload, which has a key of its own. Every adapter in this
 * repository makes a URL as a fixed prefix plus the stored path, with nothing
 * encoded: local disk `<baseUrl>/<path>`, S3 `<publicUrl or bucket URL>/<path>`,
 * and Vercel Blob, whose stored path is the blob's whole URL, an empty prefix.
 * Both files went through the same adapter in the same upload, so the prefix
 * the original shows is the thumbnail's too.
 *
 * Where the record does not show that relation (an original whose URL does
 * not end with its path, or a URL that does not start with the prefix),
 * undefined: nothing is guessed, since deleting at a guessed path removes the
 * wrong file or none.
 */
export function siblingStoredPath(
  original: { path: string; url: string },
  url: string
): string | undefined {
  const { path, url: originalUrl } = original;
  if (!path || !originalUrl.endsWith(path)) return undefined;
  const prefix = originalUrl.slice(0, originalUrl.length - path.length);
  if (!url.startsWith(prefix) || url.length === prefix.length) return undefined;
  return url.slice(prefix.length);
}
