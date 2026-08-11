import {
  declaresNoMarkup,
  isConditionGated,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { BlockResolver } from "./resolver";

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
  return pruneNodes(document, isUnconditional);
}

/**
 * Removes every node `keep` rejects, and its subtree with it.
 *
 * Three passes drop nodes from a tree before it is read, for three different
 * reasons — a visibility condition, a block that declares its props draw
 * nothing, and a node that will resolve to a placeholder. What they drop differs;
 * HOW they drop it must not, because the caller compares the result by IDENTITY
 * to decide whether a stored stylesheet still describes the tree that renders. A
 * pass that returned a fresh document when it had removed nothing would read as
 * a repair and withhold the sheet, and one that returned its input after
 * removing something would publish rules for markup that is gone.
 *
 * Dropping the subtree is not a shortcut in any of the three. A node that is not
 * served places none of the children it was holding, so leaving them behind
 * would keep rules for markup that had nowhere to appear.
 *
 * Returns the ORIGINAL document when nothing was removed, so the ordinary page
 * allocates nothing.
 */
export function pruneNodes(
  document: BlockDocument,
  keep: (node: BlockNode) => boolean
): BlockDocument {
  let changed = false;

  const prune = (nodes: BlockNode[]): BlockNode[] => {
    const kept: BlockNode[] = [];
    for (const node of nodes) {
      if (!keep(node)) {
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

/**
 * Whether a block has declared that this node's props make it draw nothing.
 *
 * The declaration is computed from stored props, so it is knowable before any
 * block runs — which is what lets the stylesheet decision use it. It is asked
 * through the engine's own rule rather than restated, for the reason
 * {@link isUnconditional} gives: the style compiler asks the same question about
 * the same node, and two implementations of it are two answers that can drift.
 */
export function drawsNothing(
  node: BlockNode,
  resolver: BlockResolver
): boolean {
  return declaresNoMarkup(node, type => resolver.get(type));
}
