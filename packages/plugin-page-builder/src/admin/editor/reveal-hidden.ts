/**
 * Which hidden blocks the canvas draws anyway: a selected block the page
 * hides on the device being edited, and every hidden block around it, since
 * a block is drawn only if the blocks holding it are.
 *
 * Pure, so what is lifted for which selection is asserted without a canvas.
 * The canvas then draws the document with those blocks' device hiding lifted,
 * and the editor saves its own, so nothing here reaches what is stored.
 *
 * @module reveal-hidden
 */
import {
  findNode,
  hiddenOnDevice,
  type BlockDocument,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { ancestorIds } from "@nextlyhq/builder";

/** What the canvas lifts, and which selected blocks it shows because of it. */
export interface RevealedHidden {
  /** Every block whose device hiding the canvas lifts. */
  readonly lifted: readonly string[];
  /** The selected blocks drawn only because of the lift: their ring says so. */
  readonly shown: readonly string[];
}

export function revealedHidden(
  document: BlockDocument,
  selected: readonly string[],
  breakpoints: BreakpointSet | undefined,
  device: string
): RevealedHidden {
  const hidden = (id: string): boolean => {
    const node = findNode(document.nodes, id);
    return (
      node !== undefined && hiddenOnDevice(node.visibility, breakpoints, device)
    );
  };
  const lifted = new Set<string>();
  const shown: string[] = [];
  for (const id of selected) {
    if (findNode(document.nodes, id) === undefined) continue;
    // The builder's own reading of the path, the one Layers opens by.
    const path = [...ancestorIds(document, id), id].filter(hidden);
    if (path.length === 0) continue;
    shown.push(id);
    path.forEach(each => lifted.add(each));
  }
  return { lifted: [...lifted], shown };
}
