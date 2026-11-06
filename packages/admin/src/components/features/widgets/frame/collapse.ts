"use client";

/**
 * A card its body has collapsed to one line: drawn one grid row tall, with the frame's gap and
 * footer given up so its header is the whole card.
 *
 * A body that offers collapsing (the setup card) reports it with `useCardCollapsed`. The cell
 * then spans one row in place of its stored rows, and the frame draws its header alone: the
 * title, its count, the body's own controls (`header-slot`) and the card's menu, each visible and
 * in reach, so no control is focusable while it cannot be seen. Nothing is written to the
 * layout: the body keeps whether it is collapsed wherever it keeps it, and the card is drawn at
 * its stored rows again once the body reports it open. Never in customise mode, where the card's
 * stored size is what is being edited and its controls stand over the frame's header.
 *
 * @module components/features/widgets/frame/collapse
 */

import { createContext, useContext, useLayoutEffect } from "react";

/** The rows a collapsed card spans. */
export const COLLAPSED_ROWS = 1;

/**
 * The padding a collapsed card is drawn with: the frame's sides, and top and bottom one pixel
 * less, so its border, its padding and one header-high line make exactly one grid row (72 px).
 */
export const COLLAPSED_PADDING_CLASS = "px-4 py-[15px]";

/** What the cell shares with its card: whether it is collapsed, and how the body says so. */
export interface CardCollapse {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

/** Provided by a cell that can draw its card collapsed; absent elsewhere. */
export const CardCollapseContext = createContext<CardCollapse | undefined>(
  undefined
);

/** Whether the frame around this body is drawn collapsed. */
export function useFrameCollapsed(): boolean {
  return useContext(CardCollapseContext)?.collapsed === true;
}

/**
 * Draws the card collapsed while `collapsed` holds, before the paint (a layout effect), so the
 * card is one line from the first frame it is drawn in; drawn at its stored rows again when the
 * body unmounts.
 */
export function useCardCollapsed(collapsed: boolean): void {
  const set = useContext(CardCollapseContext)?.setCollapsed;
  useLayoutEffect(() => {
    set?.(collapsed);
  }, [set, collapsed]);
  useLayoutEffect(() => () => set?.(false), [set]);
}

/** The rows a cell spans: its own, or one while its card is collapsed. */
export function collapsedRows(rows: number, collapsed: boolean): number {
  return collapsed ? COLLAPSED_ROWS : rows;
}
