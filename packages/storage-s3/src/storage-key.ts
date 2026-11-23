/**
 * The key a new file is stored under in the bucket.
 *
 * One definition for both ways a file arrives: a server upload
 * (`S3StorageAdapter.upload`, given the collection's prefix as `folder`) and a
 * direct browser upload (the plugin's `getClientUploadUrl`, which builds the
 * key before signing it), so the two cannot disagree about the slash after
 * the prefix and store one collection's files in two places.
 *
 * @module storage-key
 */

/**
 * Sanitize a filename to prevent directory traversal and S3 key issues.
 *
 * Keeps only the basename, and replaces every character outside
 * `a-z A-Z 0-9 . _ -` with a hyphen.
 *
 * @param filename - Original filename
 * @returns Sanitized filename safe for S3 keys
 */
export function sanitizeFilename(filename: string): string {
  const basename = filename.split(/[/\\]/).pop() || filename;
  return basename.replace(/[^a-zA-Z0-9._-]/g, "-");
}

/**
 * The folder without its trailing slashes, so `"proofs"` and `"proofs/"` name
 * the same folder and a folder of only slashes names none.
 *
 * Trimmed by a loop rather than a pattern: the value is configuration, and a
 * loop has no backtracking for a long run of slashes to exploit.
 */
function folderName(folder: string | undefined): string {
  if (!folder) return "";
  let end = folder.length;
  while (end > 0 && folder[end - 1] === "/") end--;
  return folder.slice(0, end);
}

/**
 * Generate a unique storage key with a date-based layout.
 *
 * Creates keys in the format `{folder}/{year}/{month}/{uuid}-{sanitized-filename}`,
 * or `{year}/{month}/{uuid}-{sanitized-filename}` with no folder. The folder
 * may be written with or without a trailing slash; the key has exactly one.
 *
 * @param filename - Original filename (will be sanitized)
 * @param folder - Optional folder/prefix for organizing uploads
 * @returns Generated storage key
 */
export function generateStorageKey(filename: string, folder?: string): string {
  const sanitized = sanitizeFilename(filename);
  const uuid = crypto.randomUUID();
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  const name = folderName(folder);
  const datePath = name ? `${name}/${year}/${month}` : `${year}/${month}`;

  return `${datePath}/${uuid}-${sanitized}`;
}
