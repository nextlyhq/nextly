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
import { and, like, notInArray, type Column, type SQL } from "drizzle-orm";

/** Core audit kinds containing a dot. */
export const CORE_DOTTED_AUDIT_KINDS: ReadonlySet<string> = new Set([
  "file.downloaded",
]);

/**
 * The rows of a plugin's kinds, as a filter on the audit log's `kind`
 * column: a dot in the name, and none of {@link CORE_DOTTED_AUDIT_KINDS}.
 * Written once so the writer and every erasure tell the two apart alike: a
 * core row's metadata is kept through an erasure, a plugin row's is not.
 */
export function pluginAuditKinds(kind: Column): SQL {
  return and(
    like(kind, "%.%"),
    notInArray(kind, [...CORE_DOTTED_AUDIT_KINDS])
  ) as SQL;
}
