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
  revealDeviceHidden,
  type BlockDocument,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { ancestorIds } from "@nextlyhq/builder";
import { useMemo } from "react";

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

/**
 * The document the canvas draws, and the selected blocks it shows although
 * the page hides them on the device being edited.
 */
export interface Reveal {
  readonly document: BlockDocument;
  readonly ids: readonly string[];
}

/**
 * A selected block the page hides on the device shown is drawn anyway, while
 * it is selected, so the author can see and edit what they chose in Layers.
 *
 * Editor-only by construction: the canvas draws the derived document and the
 * editor saves its own, so nothing lifted here reaches what is stored or
 * published. Derived again only when the document, the selection or the
 * device changes, so the canvas keeps its rendered tree otherwise.
 */
export function useReveal(
  document: BlockDocument,
  selected: readonly string[],
  breakpoints: BreakpointSet | undefined,
  device: string
): Reveal {
  const { lifted, shown } = revealedHidden(
    document,
    selected,
    breakpoints,
    device
  );
  // Keyed by value, so a selection that lifts the same blocks keeps the
  // document the canvas draws, and with it the canvas's rendered tree. JSON,
  // which spells any id unambiguously, a newline or a NUL in one included.
  const key = JSON.stringify([lifted, shown]);
  return useMemo(() => {
    const [liftedIds, shownIds] = JSON.parse(key) as [string[], string[]];
    return {
      document:
        liftedIds.length === 0
          ? document
          : revealDeviceHidden(document, liftedIds),
      ids: shownIds,
    };
  }, [document, key]);
}
