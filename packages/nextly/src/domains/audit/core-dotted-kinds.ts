/**
 * The core audit kinds whose names contain a dot.
 *
 * A dot otherwise marks a plugin's kind (`<plugin slug>.<name>`), whose row
 * keeps its metadata only while both parties exist. These few are core's:
 * named the way the feature that writes them was agreed, written by core with
 * metadata core controls, and refused to any plugin that declares the same
 * name, so a plugin can never write a row that reads as one of them.
 *
 * @module domains/audit/core-dotted-kinds
 */

/** Core audit kinds containing a dot. */
export const CORE_DOTTED_AUDIT_KINDS: ReadonlySet<string> = new Set([
  "file.downloaded",
]);
