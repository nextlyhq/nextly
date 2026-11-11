"use client";

/**
 * The cards sliding to their new places as a drag or an edge resize reflows the grid.
 *
 * The grid itself reflows, at once, to the order or width the gesture has reached: each card's
 * place is the grid's own answer, whatever the cards' widths. What slides is the drawing: just
 * before the change every card's place on the screen is noted (`capture`), and once the grid has
 * laid itself out again each card that moved is drawn from where it was to where it now is (FLIP:
 * first, last, invert, play). A card caught mid-slide is noted where it is drawn, so a second
 * change carries on from there rather than jumping.
 *
 * With reduced motion asked for, nothing slides: the cards are simply in their new places.
 *
 * @module components/features/widgets/edit/drag/useCardFlip
 */

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

import { usePrefersReducedMotion } from "../../charts/reduced-motion";

import { CELL_PLACEMENT_ATTRIBUTE } from "./cell-placement";

/** How long a card takes to slide to its new place. */
export const SLIDE_MS = 180;

/** Eased out: quick to leave, gentle to arrive, as a card set down. */
const SLIDE_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** The slide's own name, so a new slide replaces it and leaves any other animation alone. */
const SLIDE_ID = "dashboard-card-slide";

/** Each cell on the page, by its placement. */
function cellsOf(grid: HTMLElement): Map<string, HTMLElement> {
  const cells = new Map<string, HTMLElement>();
  for (const cell of grid.querySelectorAll<HTMLElement>(
    `[${CELL_PLACEMENT_ATTRIBUTE}]`
  )) {
    const id = cell.getAttribute(CELL_PLACEMENT_ATTRIBUTE);
    if (id !== null) cells.set(id, cell);
  }
  return cells;
}

/** Where each cell is drawn on the screen now, slides included. */
function drawnPlaces(grid: HTMLElement): Map<string, DOMRect> {
  const places = new Map<string, DOMRect>();
  for (const [id, cell] of cellsOf(grid)) {
    places.set(id, cell.getBoundingClientRect());
  }
  return places;
}

/** Stops a cell's slide, so it is measured where the grid lays it out. */
function stopSlide(cell: HTMLElement): void {
  if (typeof cell.getAnimations !== "function") return;
  for (const animation of cell.getAnimations()) {
    if (animation.id === SLIDE_ID) animation.cancel();
  }
}

export interface CardFlip {
  /** Notes where every card is drawn, just before a change that reflows the grid. */
  capture: () => void;
}

export function useCardFlip(gridRef: RefObject<HTMLElement | null>): CardFlip {
  const reduced = usePrefersReducedMotion();
  const before = useRef<Map<string, DOMRect> | null>(null);

  const capture = useCallback(() => {
    const grid = gridRef.current;
    before.current = grid === null ? null : drawnPlaces(grid);
  }, [gridRef]);

  // Every render, and cheap while nothing was captured: the change a capture announced is
  // whichever render comes next.
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    const grid = gridRef.current;
    if (was === null || grid === null) return;
    for (const [id, cell] of cellsOf(grid)) {
      const from = was.get(id);
      if (from === undefined) continue;
      stopSlide(cell);
      if (reduced || typeof cell.animate !== "function") continue;
      const to = cell.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      cell.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: SLIDE_MS, easing: SLIDE_EASING, id: SLIDE_ID }
      );
    }
  });

  return { capture };
}
