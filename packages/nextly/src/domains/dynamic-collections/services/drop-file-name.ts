/**
 * How the Schema Builder names and heads the file that deletes collections:
 * the one spelling the writer uses and the old-Builder reading checks a file
 * against, so the two cannot drift apart.
 *
 * @module domains/dynamic-collections/services/drop-file-name
 */
import { createHash } from "node:crypto";

/**
 * What a drop file's name says it drops: the collection, or for several, how
 * many and a digest of which. A name listing every slug grows with the
 * selection, and past the filesystem's limit on one name the file cannot be
 * written at all.
 */
export function dropFileLabel(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  const digest = createHash("sha256")
    .update(names.join(","))
    .digest("hex")
    .slice(0, 12);
  return `${String(names.length)}_collections_${digest}`;
}

/** The first line of a drop file, naming each collection it deletes. */
export function dropFileHeader(names: readonly string[]): string {
  return `-- Drop dynamic collection${names.length === 1 ? "" : "s"}: ${names.join(", ")}`;
}
