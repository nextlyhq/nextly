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
  hiddenOnDevice,
  revealDeviceHidden,
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

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
  const wanted = new Set(selected);
  const lifted = new Set<string>();
  const shown: string[] = [];
  if (wanted.size === 0) return { lifted: [], shown };
  /*
   * ONE walk of the document, carrying the hidden blocks above each node, so
   * a selection of thousands of blocks costs one pass rather than a path
   * search per block. A block is drawn only if every block holding it is, so
   * a selected block lifts each hidden block on its path, itself included.
   */
  const walk = (
    nodes: readonly BlockNode[],
    above: readonly string[]
  ): void => {
    for (const node of nodes) {
      const path = hiddenOnDevice(node.visibility, breakpoints, device)
        ? [...above, node.id]
        : above;
      if (wanted.has(node.id) && path.length > 0) {
        shown.push(node.id);
        path.forEach(id => lifted.add(id));
      }
      for (const children of Object.values(node.slots ?? {})) {
        if (Array.isArray(children)) walk(children, path);
      }
    }
  };
  walk(document.nodes, []);
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
  // Derived only when what it reads changes: the document, the selection,
  // the breakpoints or the device. The selection is keyed by value, as JSON,
  // which spells any id unambiguously, so a host handing a new array of the
  // same ids derives nothing again.
  const selectedKey = JSON.stringify(selected);
  const key = React.useMemo(() => {
    const ids = JSON.parse(selectedKey) as string[];
    const { lifted, shown } = revealedHidden(
      document,
      ids,
      breakpoints,
      device
    );
    return JSON.stringify([lifted, shown]);
  }, [document, selectedKey, breakpoints, device]);
  return React.useMemo(() => {
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
