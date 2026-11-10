"use client";

/**
 * The height a card holds while its data loads: the height it was last drawn at with an answer.
 *
 * A card is as tall as its content, so a card whose answer has not arrived has no height of its
 * own beyond its loading skeleton's, and the cards below it would move when the answer lands.
 * Each cell remembers the height its card was last drawn at with an answer, by placement, for as
 * long as the page is open; while the card loads again (a return to the dashboard, a refresh, a
 * card put back) the cell is drawn at exactly that height ({@link heldCellStyle}). A card never
 * drawn with an answer holds its skeleton's height, the default for its kind (`WidgetCard`'s
 * loading body).
 *
 * @module components/features/widgets/frame/held-height
 */

import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

import { observeSize } from "./observe-size";

/** The height each placement's card was last drawn at with an answer, in pixels. */
const lastDrawnHeights = new Map<string, number>();

/**
 * The height the card at `placementId` holds as its minimum while `loading`: the height it was
 * last drawn at with an answer, or `undefined` for none. While not loading, records the cell's
 * height (`cell`) as it changes, rounded to whole pixels, for the next load.
 */
export function useHeldCardHeight(
  placementId: string,
  loading: boolean,
  cell: RefObject<HTMLElement | null>
): number | undefined {
  // Read once per load: the height to hold is the one drawn before the load began.
  const [held, setHeld] = useState<number | undefined>(() =>
    loading ? lastDrawnHeights.get(placementId) : undefined
  );
  useLayoutEffect(() => {
    if (loading) {
      setHeld(lastDrawnHeights.get(placementId));
      return;
    }
    setHeld(undefined);
    const element = cell.current;
    if (element === null) return;
    const record = () => {
      const height = Math.round(element.getBoundingClientRect().height);
      if (height > 0) lastDrawnHeights.set(placementId, height);
    };
    return observeSize(element, record);
  }, [placementId, loading, cell]);
  return loading ? held : undefined;
}

/**
 * The style of a cell holding `heldPx` while its card loads: exactly that height, its skeleton
 * clipped to it. A minimum alone would let a skeleton taller than the answer it stands in for
 * grow the row while loading, and the row would close up again when the answer lands, moving
 * every card under it. Nothing for a cell that holds no height.
 */
export function heldCellStyle(
  heldPx: number | undefined
): CSSProperties | undefined {
  return heldPx === undefined
    ? undefined
    : { height: `${heldPx}px`, overflow: "hidden" };
}

/** Forgets every remembered height. For tests, which draw one placement id many times. */
export function forgetHeldCardHeights(): void {
  lastDrawnHeights.clear();
}
