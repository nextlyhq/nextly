import {
  isConditionGated,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

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
 * The predicate itself lives in the engine and is NOT restated here. The style
 * compiler asks the same question about the same node — whether to hold its
 * rules out of the sheet — and while the two derived it separately they
 * disagreed in both directions: on `conditions: [[]]` this served a node whose
 * rules the compiler had withheld, and on an unreadable shape this withheld a
 * node whose rules the compiler left in a sheet served to everyone. The second
 * published the assets of a block deliberately hidden, which is the leak the
 * gate exists to prevent. One function cannot disagree with itself.
 */
export function isUnconditional(node: BlockNode): boolean {
  return !isConditionGated(node);
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
