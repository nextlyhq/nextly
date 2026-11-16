/**
 * The blocks on the page an edit to a look reaches, marked dashed on the
 * canvas while the look is edited on its own: every block of its type for a
 * block's own look, which is the base every other look of the type is laid on,
 * and every block wearing it for any other look.
 *
 * Which look a block wears is the Style tab's own answer (`wornLook` over the
 * looks the library renders), so the marks and the tiles cannot disagree.
 *
 * @module look-reach
 * @experimental Settles with the Design panel's Block looks group.
 */

import {
  MAX_CLASSES_PER_NODE,
  walkNodes,
  type BlockDocument,
  type NamedClass,
} from "@nextlyhq/blocks-engine";

import type { BlockLookRow } from "./block-look-rows";
import { looksOfType } from "./look-tiles";

/** Marks a block an edit to the look being edited reaches. */
export const LOOK_REACH_ATTRIBUTE = "data-nx-look-reach";

/** The ids of the blocks in `document` an edit to `look` reaches. */
export function lookReach(
  document: BlockDocument,
  library: readonly NamedClass[],
  look: Pick<BlockLookRow, "id" | "blockType" | "own">
): Set<string> {
  const looks = looksOfType(library, look.blockType);
  const reached = new Set<string>();
  walkNodes(document.nodes, node => {
    if (node.type !== look.blockType) return;
    if (look.own || appliesLook(node.classes, looks, look.id)) {
      reached.add(node.id);
    }
  });
  return reached;
}

/**
 * Whether a block's classes apply the look: listed among the classes the
 * engine reads for a node, and one of the type's looks it renders. A block
 * listing two looks of its type has both applied, the later over the earlier,
 * so an edit to either reaches it.
 */
function appliesLook(
  classes: readonly string[] | undefined,
  looks: readonly NamedClass[],
  lookId: string
): boolean {
  return (
    looks.some(each => each.id === lookId) &&
    (classes ?? []).slice(0, MAX_CLASSES_PER_NODE).includes(lookId)
  );
}

/**
 * Mark, under `root`, the blocks whose ids are in `ids`, and clear every other
 * mark. `null` clears them all.
 */
export function markLookReach(
  root: ParentNode,
  ids: ReadonlySet<string> | null
): void {
  root.querySelectorAll(`[${LOOK_REACH_ATTRIBUTE}]`).forEach(element => {
    const id = element.getAttribute("data-nx-node");
    if (ids === null || id === null || !ids.has(id)) {
      element.removeAttribute(LOOK_REACH_ATTRIBUTE);
    }
  });
  if (ids === null) return;
  root.querySelectorAll("[data-nx-node]").forEach(element => {
    const id = element.getAttribute("data-nx-node");
    if (
      id !== null &&
      ids.has(id) &&
      !element.hasAttribute(LOOK_REACH_ATTRIBUTE)
    ) {
      element.setAttribute(LOOK_REACH_ATTRIBUTE, "");
    }
  });
}
