import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

/**
 * Whether a node is shown regardless of the entry it renders against.
 *
 * The document format is explicit that conditionally hidden nodes are OMITTED
 * from server output rather than hidden with CSS, so a node carrying conditions
 * must not reach the page unless something has decided they hold. Nothing here
 * can decide that: a `Condition` is `{ field, op, value }` with `op` an open
 * string, and the engine defines no evaluator for it.
 *
 * So this fails CLOSED. Conditions gate personalised and status-restricted
 * content, and showing everyone what was meant for some of them is the failure
 * that cannot be taken back; content missing from a page is visible and
 * reportable. When the evaluator arrives this becomes a call into it.
 *
 * Two shapes are NOT gates. No groups at all is no restriction, and neither is
 * a group with no predicates: the storage is OR-of-AND, and an AND of nothing
 * is satisfied, so a node whose only group was emptied by removing its last
 * predicate is visible again.
 */
export function isUnconditional(node: BlockNode): boolean {
  const groups = node.visibility?.conditions;
  if (groups === undefined || groups === null) return true;
  // A malformed value — a flat list of predicates from an older writer, an
  // object, a string — is still an author saying this node is restricted, and a
  // shape this renderer cannot read is the last thing to resolve in favour of
  // showing it.
  if (!Array.isArray(groups)) return false;
  if (groups.length === 0) return true;
  return groups.some(group => Array.isArray(group) && group.length === 0);
}

/**
 * Removes condition-gated nodes from a document before anything reads it.
 *
 * Done to the DOCUMENT rather than while rendering, because the tree is read
 * twice: once to render HTML and once to compile the stylesheet. Filtering only
 * the render left a gated node's scoped CSS in the page — a background image
 * URL, a font, whatever the design carried — so the markup was withheld while
 * the assets it referenced were still announced. "Omitted from server output"
 * has to mean both, and the only way to be sure they agree is to give them the
 * same tree.
 *
 * Returns the ORIGINAL document when nothing is gated, so the ordinary page
 * allocates nothing.
 */
export function pruneHiddenNodes(document: BlockDocument): BlockDocument {
  let changed = false;

  const prune = (nodes: BlockNode[]): BlockNode[] => {
    const kept: BlockNode[] = [];
    for (const node of nodes) {
      if (!isUnconditional(node)) {
        changed = true;
        continue;
      }

      const slots = node.slots;
      if (slots === undefined) {
        kept.push(node);
        continue;
      }

      let slotsChanged = false;
      const nextSlots: Record<string, BlockNode[]> = {};
      for (const [name, children] of Object.entries(slots)) {
        const prunedChildren = prune(children);
        if (prunedChildren !== children) slotsChanged = true;
        nextSlots[name] = prunedChildren;
      }
      kept.push(slotsChanged ? { ...node, slots: nextSlots } : node);
    }
    return changed ? kept : nodes;
  };

  const nodes = prune(document.nodes);
  return changed ? { ...document, nodes } : document;
}
