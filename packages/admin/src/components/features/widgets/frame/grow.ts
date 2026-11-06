"use client";

/**
 * A card that grows in place, past its stored rows, while the reader has asked to see more of it.
 *
 * A card keeps the rows its placement stores, and never scrolls. A body that folds the rest of
 * its content behind "Show N more" may, on that click, report how tall its content needs the body
 * to be; the cell then spans enough rows to hold it, and spans its stored rows again once the
 * body reports nothing. It is the reader's own click that moves the cards below, so it is no
 * unexpected shift, and nothing is written to the layout: the card is drawn at its stored size
 * again on the next load.
 *
 * @module components/features/widgets/frame/grow
 */

import { createContext } from "react";

import { ROW_GAP_PX, ROW_HEIGHT_PX } from "../sizes";

import { cardBodyHeightPx } from "./measures";

/** Report the body height a card's content needs, in pixels, or `undefined` for its own rows. */
export type ReportContentHeight = (bodyPx: number | undefined) => void;

/** Where a card's body reports the height it needs; absent outside a cell that can grow. */
export const CardGrowContext = createContext<ReportContentHeight | undefined>(
  undefined
);

/**
 * The rows a card stored at `h` spans when its body needs `bodyPx`: `h`, or the fewest rows past
 * it whose body (`cardBodyHeightPx`) holds that much. Never fewer than `h`: growing is for showing
 * more, and a card is never drawn shorter than its reader made it.
 */
export function grownRows(h: number, bodyPx: number | undefined): number {
  if (bodyPx === undefined || !Number.isFinite(bodyPx)) return h;
  const short = bodyPx - cardBodyHeightPx(h);
  // Each row more adds one row and one gap to the body (`cardBodyHeightPx`).
  return short <= 0 ? h : h + Math.ceil(short / (ROW_HEIGHT_PX + ROW_GAP_PX));
}
