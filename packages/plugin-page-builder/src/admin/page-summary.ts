/**
 * What a blocks document holds, read once for every surface that reports it.
 *
 * Two surfaces answer this question and they must not disagree: the published
 * {@link BlocksSummary}, which a host can still address by component path, and
 * the entry screen's own card. A second traversal would drift in the direction
 * nobody tests — the two would agree on the documents in the tests and differ on
 * a nesting shape neither was written against.
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

/**
 * Every block type in the tree with how many times it appears, in tree order.
 *
 * @param nodes - the document's top-level nodes
 * @returns a count per block type
 */
export function countByType(nodes: readonly BlockNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (list: readonly BlockNode[]): void => {
    for (const node of list) {
      if (!node || typeof node.type !== "string") continue;
      counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
      // Children live under named slots, so a container's contents are counted
      // too rather than the summary reporting only the top level.
      for (const slot of Object.values(node.slots ?? {})) {
        if (Array.isArray(slot)) visit(slot);
      }
    }
  };
  visit(nodes);
  return counts;
}

/**
 * How many blocks the document holds in total.
 *
 * @param counts - the per-type counts from {@link countByType}
 * @returns the total number of blocks
 */
export function totalBlocks(counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}
