/**
 * Upload Validation — Blocked Extensions
 *
 * SVG is intentionally NOT in this list — it's allowed but sanitized
 * via DOMPurify (see `sanitize-svg.ts`).
 *
 * @module services/upload-validation/extensions
 */

/**
 * Extensions (lowercase, no leading dot) that are unconditionally rejected
 * regardless of claimed MIME. Hard-coded — not configurable.
 */
export const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  "html",
  "htm",
  "xhtml",
  "xht",
  "shtml",
  "xml",
  "php",
  "php3",
  "php4",
  "php5",
  "phtml",
  "asp",
  "aspx",
  "jsp",
  "jspx",
  "js",
  "mjs",
  "cjs",
  "exe",
  "dll",
  "sh",
  "bat",
  "cmd",
  "com",
  "scr",
  "vbs",
  "msi",
  "pif",
  "cpl",
  "hta",
]);

/**
 * Lowercased extension from a filename, or `""` if none.
 *
 * @example
 * getExtension("photo.JPG") // "jpg"
 * getExtension("archive.tar.gz") // "gz"
 */
export function getExtension(filename: string): string {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0 || dot === lower.length - 1) return "";
  return lower.slice(dot + 1);
}

export function isBlockedExtension(filename: string): boolean {
  const ext = getExtension(filename);
  return ext.length > 0 && BLOCKED_EXTENSIONS.has(ext);
}
