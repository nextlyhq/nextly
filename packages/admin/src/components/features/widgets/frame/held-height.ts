"use client";

/**
 * The height a card holds while its data loads: the height it was last drawn at with an answer.
 *
 * A card is as tall as its content, so a card whose answer has not arrived has no height of its
 * own beyond its loading skeleton's, and the cards below it would move when the answer lands.
 * Each cell remembers the height its card was last drawn at with an answer, by placement and by
 * how wide the cell was; while the card loads again (a return to the dashboard, a refresh, a card
 * put back, a fresh tab) the cell is drawn at exactly that height ({@link heldCellStyle}). The
 * heights are kept on the device (`rememberLayout`, numbers alone, forgotten with the person and
 * by the site's switch), so the first paint of a fresh tab holds them too, and in this page's
 * memory, which holds them for the page where the device keeps nothing. A card never drawn with
 * an answer holds its skeleton's height, the default for its kind (`WidgetCard`'s loading body).
 *
 * @module components/features/widgets/frame/held-height
 */

import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

import {
  recallLayout,
  rememberLayout,
} from "@admin/lib/device-memory/device-memory";

import { observeSize } from "./observe-size";

/**
 * How a cell's width is counted for the height it holds: by the band of 32px it falls in. A
 * card's height follows its width (its rows wrap), so a height is held only for a cell about as
 * wide as the one it was drawn in; a band, not the exact width, so a pixel's difference between
 * two visits does not lose it.
 */
const WIDTH_BAND_PX = 32;

/** The name a placement's height is kept under, at a cell of `width` pixels. */
function heightPart(placementId: string, width: number): string {
  return `card-height:${placementId}:${Math.round(width / WIDTH_BAND_PX)}`;
}

/** The heights this page has drawn, by the name each is kept under. */
const drawnHeights = new Map<string, number>();

/** The height last drawn under `part`: this page's, else the device's. */
function heldFor(part: string): number | undefined {
  return drawnHeights.get(part) ?? recallLayout(part);
}

/**
 * The height the card at `placementId` holds as its minimum while `loading`: the height it was
 * last drawn at with an answer, in a cell this wide, or `undefined` for none. Read in a layout
 * effect, before the browser paints, where the cell's width is known. While not loading, records
 * the cell's height (`cell`) as it changes, rounded to whole pixels, for the next load.
 */
export function useHeldCardHeight(
  placementId: string,
  loading: boolean,
  cell: RefObject<HTMLElement | null>
): number | undefined {
  const [held, setHeld] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const element = cell.current;
    if (loading) {
      const width = element?.getBoundingClientRect().width ?? 0;
      setHeld(width > 0 ? heldFor(heightPart(placementId, width)) : undefined);
      return;
    }
    setHeld(undefined);
    if (element === null) return;
    const record = () => {
      const box = element.getBoundingClientRect();
      const height = Math.round(box.height);
      if (height <= 0 || box.width <= 0) return;
      const part = heightPart(placementId, box.width);
      drawnHeights.set(part, height);
      rememberLayout(part, height);
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

/** Forgets this page's heights. For tests, which draw one placement id many times. */
export function forgetHeldCardHeights(): void {
  drawnHeights.clear();
}
