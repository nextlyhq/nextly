/**
 * Upload Validation — Filename Hygiene
 *
 * Defends against null-byte truncation (`photo.jpg\0.html`), path
 * traversal (`../etc/passwd`), and other filesystem-level surprises.
 *
 * @module services/upload-validation/filename
 */

export type FilenameValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "empty"
        | "too-long"
        | "null-byte"
        | "path-separator"
        | "all-dots";
    };

const MAX_FILENAME_LENGTH = 255;

/**
 * @example
 * validateFilename("photo.jpg") // { ok: true }
 * validateFilename("../etc/passwd") // { ok: false, reason: "path-separator" }
 * validateFilename("photo.jpg\0.html") // { ok: false, reason: "null-byte" }
 */
export function validateFilename(filename: string): FilenameValidationResult {
  if (!filename || filename.length === 0) return { ok: false, reason: "empty" };
  if (filename.length > MAX_FILENAME_LENGTH)
    return { ok: false, reason: "too-long" };
  if (filename.includes("\0")) return { ok: false, reason: "null-byte" };
  if (filename.includes("/") || filename.includes("\\"))
    return { ok: false, reason: "path-separator" };
  if (/^\.+$/.test(filename)) return { ok: false, reason: "all-dots" };
  return { ok: true };
}
