"use client";

/**
 * Resizing a card by dragging its right edge, while customising on a dashboard at least
 * 1,024px wide.
 *
 * The card snaps to the nearest of its width choices (`widthChoices`: the named widths inside its
 * bounds, its bounds' own ends, its default and the width it is drawn at) as the pointer moves,
 * and the grid lays itself out at that width at once, so the other cards move to fit and slide
 * there (`useCardFlip`). Past its widest choice it stays at its widest: the maximum is where it
 * stops. Taken past the grid's right edge, the pointer asks for the widest choice, so a card in
 * the row's last column, with no room to its right, widens from its edge too (`columnsReached`).
 * A card with one choice has no edge to drag.
 *
 * The width is staged once, on release, with the dashboard's other unsaved changes, and said
 * then; a cancelled drag (Escape, or the pointer taken away) puts the card back. Below 1,024px
 * the dashboard draws widths in bands, where a 25% and a 33% card look the same, so no edge is
 * offered there: the card's settings set its width at every size. The edge is for a pointer;
 * the keyboard sets a width in the settings drawer.
 *
 * @module components/features/widgets/edit/drag/useCardResize
 */

import type { GridSize } from "nextly/config";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { AS_SIZED_FROM_PX, drawnSize, widthChoices } from "../../sizes";
import type { ArrangedWidget } from "../useDashboardArrangement";

import { CELL_PLACEMENT_ATTRIBUTE } from "./cell-placement";
import { columnsReached, nearestWidth } from "./reflow";
import type { CardFlip } from "./useCardFlip";

/** A card whose edge is being dragged. */
export interface ResizeInProgress {
  placementId: string;
  /** The width it is drawn at now, in columns. */
  w: number;
  /** The width it had when the edge was picked up. */
  from: number;
}

/** What one card's edge answers. */
export interface CardEdge {
  /** The widths the edge snaps to, narrowest first. */
  choices: readonly number[];
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
}

export interface CardResize {
  /** Whether an edge is offered: the dashboard is at least 1,024px wide. */
  enabled: boolean;
  /** The resize in progress, or none. */
  resizing: ResizeInProgress | null;
  /** One card's edge, or `undefined` where none is offered (too narrow, or one width). */
  edgeFor: (row: ArrangedWidget) => CardEdge | undefined;
  /** Puts the held card back at the width it was picked up at; nothing while none is held. */
  cancel: () => void;
}

export function useCardResize({
  width,
  gridRef,
  flip,
  setSize,
}: {
  /** The dashboard's width, or `undefined` before it is measured. */
  width: number | undefined;
  gridRef: RefObject<HTMLElement | null>;
  /** Slides the other cards to their new places as the width changes. */
  flip: CardFlip;
  /** Stage a card's new size, saying so: the same change the settings drawer's Width makes. */
  setSize: (placementId: string, size: GridSize) => void;
}): CardResize {
  const enabled = width !== undefined && width >= AS_SIZED_FROM_PX;
  const [resizing, setState] = useState<ResizeInProgress | null>(null);
  const current = useRef<ResizeInProgress | null>(null);
  const setResizing = useCallback((next: ResizeInProgress | null) => {
    current.current = next;
    setState(next);
  }, []);

  /** Puts the card back as it was picked up: every card slides back too. */
  const cancel = useCallback(() => {
    if (current.current === null) return;
    flip.capture();
    setResizing(null);
  }, [flip, setResizing]);

  // The dashboard narrowing below where edges are offered puts the card back. Escape does too,
  // through the admin's one shortcut owner (`EscapePutsCardBack`, drawn while a card is held).
  useEffect(() => {
    if (resizing !== null && !enabled) cancel();
  }, [resizing, enabled, cancel]);

  const edgeFor = useCallback(
    (row: ArrangedWidget): CardEdge | undefined => {
      if (!enabled) return undefined;
      const size = drawnSize(row.size, row.widget.size);
      const choices = widthChoices(row.widget.size, size.w);
      if (choices.length < 2) return undefined;
      const { placementId } = row;
      return {
        choices,
        onPointerDown: event => {
          if (event.button !== 0 || current.current !== null) return;
          // No text selected and no drag of anything else begun by this press.
          event.preventDefault();
          event.stopPropagation();
          // Held by the edge until release, wherever the pointer goes, so the drag never drops a
          // move or loses its release to whatever the pointer passes over.
          const edge = event.currentTarget;
          if (typeof edge.setPointerCapture === "function") {
            edge.setPointerCapture(event.pointerId);
          }
          setResizing({ placementId, w: size.w, from: size.w });
        },
        onPointerMove: event => {
          const held = current.current;
          const grid = gridRef.current;
          if (held?.placementId !== placementId || grid === null) return;
          const cell = event.currentTarget.closest<HTMLElement>(
            `[${CELL_PLACEMENT_ATTRIBUTE}]`
          );
          if (cell === null) return;
          const box = grid.getBoundingClientRect();
          // From where the card's left edge is laid out now: a card widened past the end of
          // its row starts the next one, and goes on growing from there.
          const reached = columnsReached(
            cell.offsetLeft,
            event.clientX - box.left,
            box.width
          );
          const w = nearestWidth(choices, reached);
          if (w === undefined || w === held.w) return;
          flip.capture();
          setResizing({ ...held, w });
        },
        onPointerUp: () => {
          const held = current.current;
          if (held?.placementId !== placementId) return;
          setResizing(null);
          if (held.w !== held.from)
            setSize(placementId, { ...size, w: held.w });
        },
        onPointerCancel: cancel,
      };
    },
    [enabled, gridRef, flip, setResizing, setSize, cancel]
  );

  return { enabled, resizing, edgeFor, cancel };
}
