/**
 * How the Add panel answers a press of an add control on the canvas, and
 * where its tile card is anchored. Kept beside the panel rather than in it:
 * each is one decision the panel only calls.
 *
 * @module insert-panel-summon
 */
import * as React from "react";

import { boxInFrameViewport } from "./canvas/geometry-dom";
import type { Rect } from "./geometry";

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
  React.useEffect(() => {
    if (summoned === undefined || answered.current === summoned) return;
    answered.current = summoned;
    const panel = root.current;
    // Without scrolling the panel's region: the list going to the top is the
    // one movement the author should see.
    panel
      ?.querySelector<HTMLInputElement>("[cmdk-input]")
      ?.focus({ preventScroll: true });
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

/**
 * The answer to a press where the panel has nowhere to add: nothing to focus
 * or scroll, but the press is still said back as answered, so it does not
 * wait and steal focus when the panel can next draw its palette.
 */
export function SummonAnswerOnly({
  summoned,
  onSummoned,
}: {
  readonly summoned?: number | undefined;
  readonly onSummoned?: ((count: number) => void) | undefined;
}): null {
  const nowhere = React.useRef<HTMLDivElement | null>(null);
  useSummonAnswer(nowhere, summoned, onSummoned);
  return null;
}
