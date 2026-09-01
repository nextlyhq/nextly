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
import { walkNodes, type BlockNode } from "@nextlyhq/blocks-engine";

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
 * Every block type in the tree with how many times it appears.
 *
 * Walked by the ENGINE rather than by a traversal written here, and that is a
 * correctness choice rather than a tidiness one. The value being counted is
 * whatever is stored: `documentNodes` checks only that `nodes` is an array, so
 * this runs over a shape nothing has repaired.
 *
 * A hand-written recursion over `slots` fails on that input in two ways, both
 * measured. A deep enough tree exhausts the call stack — and it does so DURING
 * A RENDER, so it takes the screen down rather than reporting anything. And a
 * document containing a cycle never returns at all.
 *
 * `walkNodes` is iterative, it bounds itself by node count, and it reports a
 * cycle rather than following it, because the walk is the only thing that can
 * see one. Asking it means those three properties cannot be lost here by
 * someone reintroducing an obvious-looking recursion.
 *
 * @param nodes - the document's top-level nodes
 * @param maxNodes - the site's cap on how many nodes it will read
 * @returns a count per block type
 */
export function countByType(
  nodes: readonly BlockNode[],
  maxNodes?: number
): Map<string, number> {
  const counts = new Map<string, number>();
  walkNodes(
    // The walk takes a mutable array and does not write to it; the reading
    // surfaces above hold their nodes as readonly, which is the stronger claim.
    nodes as BlockNode[],
    node => {
      if (typeof node.type !== "string") return;
      counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    },
    maxNodes === undefined ? {} : { maxNodes }
  );
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
