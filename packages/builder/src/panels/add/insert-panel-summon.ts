/**
 * How the Add panel answers a press of an add control on the canvas, and
 * where its tile card is anchored. Kept beside the panel rather than in it:
 * each is one decision the panel only calls.
 *
 * @module insert-panel-summon
 */
import * as React from "react";

import { boxInFrameViewport } from "../../canvas/geometry-dom";
import type { Rect } from "../../geometry";

/**
 * Where a tile's card is anchored: a point on the panel's right edge, as
 * tall as the tile and level with it. Placed to its right, the card sits
 * outside the panel whichever column the tile is in.
 *
 * @param panel - the panel's box
 * @param tile - the tile's box
 * @returns the anchor's box, no wider than a line
 */
export function besidePanel(panel: Rect, tile: Rect): DOMRect {
  return new DOMRect(panel.x + panel.width, tile.y, 0, tile.height);
}

/**
 * Anything a popover can be anchored to: a point beside a tile, with the
 * tile as the element whose scrolling moves it, or nowhere while there is no
 * tile in the document to measure.
 */
export interface Measurable {
  getBoundingClientRect(): DOMRect;
  readonly contextElement?: Element;
}

/** The anchor for a popover with no tile under it: a point at the origin. */
export const NOWHERE: Measurable = {
  getBoundingClientRect: () => new DOMRect(),
};

/**
 * A tile card's anchor: a point on the panel's right edge, level with the
 * tile, so the card drawn to its right sits outside the panel, never over
 * the tiles beside it. The tile is its context element, so the card moves
 * with the list as it scrolls. Boxes are read through the module that reads
 * them. `NOWHERE` while either is missing.
 */
export function cardAnchor(
  panel: HTMLElement | null,
  tile: HTMLElement | null
): Measurable {
  if (panel === null || tile === null) return NOWHERE;
  return {
    contextElement: tile,
    getBoundingClientRect: () =>
      besidePanel(boxInFrameViewport(panel), boxInFrameViewport(tile)),
  };
}

/**
 * How many frames the search is held focused after a press, while the tab
 * the press opened draws: a Saved sections tab reads the site's sections
 * first, and draws its search again once they arrive.
 */
const FOCUS_FRAMES = 90;

/** The open tab's search, or the panel's only one. */
function searchOf(panel: HTMLElement): HTMLInputElement | null {
  return (
    panel.querySelector<HTMLInputElement>(
      '[role="tabpanel"][data-state="active"] [cmdk-input]'
    ) ?? panel.querySelector<HTMLInputElement>("[cmdk-input]")
  );
}

/**
 * Focus the panel's search, without scrolling the panel's region (the list
 * going to the top is the one movement the author should see), and keep it
 * there while the tab draws: a search drawn again takes the focus its last
 * drawing held. Lets go the moment focus is somewhere else on purpose, or
 * after a moment and a half. Answers the way to stop early.
 */
function keepSearchFocused(panel: HTMLElement | null): () => void {
  if (panel === null) return () => undefined;
  const doc = panel.ownerDocument;
  const view = doc.defaultView;
  let frames = 0;
  let handle = 0;
  const hold = (): void => {
    if (!panel.isConnected) return;
    const search = searchOf(panel);
    const active = doc.activeElement;
    // Somewhere else on purpose: an author moved on.
    const lost = active === null || active === doc.body;
    if (search !== null && active !== search && (frames === 0 || lost)) {
      search.focus({ preventScroll: true });
    } else if (!lost && active !== search) {
      return;
    }
    frames += 1;
    if (frames < FOCUS_FRAMES && view !== null) {
      handle = view.requestAnimationFrame(hold);
    }
  };
  hold();
  return () => view?.cancelAnimationFrame(handle);
}

/** How long the line naming the place stays highlighted after a press. */
const FLASH_MS = 1200;

/**
 * The panel's answer to each press of an add control on the canvas: the
 * search focused, the list back at the top, and the press's count while the
 * line naming the place is highlighted (`undefined` after). Each count is
 * answered once, and said back through `onSummoned`.
 */
export function useSummonAnswer(
  root: React.RefObject<HTMLDivElement | null>,
  summoned: number | undefined,
  onSummoned: ((count: number) => void) | undefined
): number | undefined {
  const [flash, setFlash] = React.useState<number | undefined>(undefined);
  const answered = React.useRef<number | undefined>(undefined);
  // The hold on the search outlives the press's own render, which the host
  // answers at once by taking the press back, and this line itself, which a
  // tab drawn again replaces; it ends by itself, or when the panel goes.
  const stopHolding = React.useRef<() => void>(() => undefined);
  React.useEffect(() => {
    if (summoned === undefined || answered.current === summoned) return;
    answered.current = summoned;
    const panel = root.current;
    stopHolding.current();
    stopHolding.current = keepSearchFocused(panel);
    const list = panel?.querySelector<HTMLElement>(".nx-insert-panel__list");
    if (list !== null && list !== undefined) list.scrollTop = 0;
    setFlash(summoned);
    onSummoned?.(summoned);
  }, [root, summoned, onSummoned]);
  React.useEffect(() => {
    if (flash === undefined) return;
    const done = setTimeout(() => setFlash(undefined), FLASH_MS);
    return () => clearTimeout(done);
  }, [flash]);
  return flash;
}
