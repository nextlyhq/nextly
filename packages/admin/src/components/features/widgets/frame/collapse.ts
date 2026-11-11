"use client";

/**
 * A card its body has collapsed to one line, with the frame's gap and footer given up so its
 * header is the whole card.
 *
 * A body that offers collapsing (the setup card) reports it with `useCardCollapsed`. The frame
 * then draws its header alone, and the card, as tall as its content, is one header line tall: the
 * title, its count, the body's own controls (`header-slot`) and the card's menu, each visible and
 * in reach, so no control is focusable while it cannot be seen. Nothing is written to the
 * layout: the body keeps whether it is collapsed wherever it keeps it, and the card is drawn
 * whole again once the body reports it open. Never in customise mode, where the card's
 * stored size is what is being edited and its controls stand over the frame's header.
 *
 * @module components/features/widgets/frame/collapse
 */

import { createContext, useContext, useLayoutEffect } from "react";

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
 * card is one line from the first frame it is drawn in; drawn whole again when the body
 * unmounts.
 */
export function useCardCollapsed(collapsed: boolean): void {
  const set = useContext(CardCollapseContext)?.setCollapsed;
  useLayoutEffect(() => {
    set?.(collapsed);
  }, [set, collapsed]);
  useLayoutEffect(() => () => set?.(false), [set]);
}
