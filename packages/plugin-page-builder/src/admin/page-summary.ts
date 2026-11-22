/**
 * What a blocks document holds, read once for every surface that reports it:
 * the entry screen's card and the page's sections both ask here, so they read
 * the stored shape the same way.
 *
 * Pure, and deliberately DOM-free: what counts as a block is a question about
 * the stored shape, so it stays testable without rendering anything.
 *
 * @module @nextlyhq/plugin-page-builder/admin/page-summary
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";

/**
 * The nodes a form value holds, for a value that may not hold any.
 *
 * A blocks field renders inside a create form and inside previews, where the
 * value is legitimately `undefined` rather than malformed, and a stored row can
 * predate the validators that would have refused it. Both read as "no nodes"
 * here, because the reading an author needs is the same either way and neither
 * is worth throwing over.
 *
 * @param value - the form's current value for a blocks field
 * @returns the document's top-level nodes, or an empty list
 */
export function documentNodes(value: unknown): readonly BlockNode[] {
  if (typeof value !== "object" || value === null) return [];
  const nodes = (value as { nodes?: unknown }).nodes;
  return Array.isArray(nodes) ? (nodes as readonly BlockNode[]) : [];
}
