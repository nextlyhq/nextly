"use client";

/**
 * Dragging a card by its handle: the other cards move aside as it goes, and it lands where its
 * outline is.
 *
 * While a card is held the grid draws the cards in the order the drag has reached, the held one
 * as an outline of its own size (the placeholder) and a picture of it under the pointer (the
 * ghost, `CardDragContext`). The grid lays itself out in that order, so every card's place is the
 * grid's own answer whatever the cards' widths, and the cards slide there (`useCardFlip`). On
 * release the card takes the outline's place; on cancel every card goes back.
 *
 * The pointer drags through dnd-kit's draggable primitive: its activation distance, pointer
 * capture and edge scrolling. Where the held card goes is asked of the grid as it is laid out
 * at each step (`reflow`), never of the screen, so a card caught mid-slide is aimed at where it
 * is going. The keyboard moves cards from each card's menu, Move earlier and Move later, at
 * every width; the handle is for a pointer.
 *
 * Off while the dashboard draws one column: every card is full width there and touch dragging
 * fights scrolling. A drag in progress when the dashboard's width changes is cancelled and says
 * so, since the place it was aimed at moved.
 *
 * @module components/features/widgets/edit/drag/useCardDrag
 */

import {
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragMoveEvent,
  type DragStartEvent,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { isOneColumn } from "../../sizes";
import type { ArrangedWidget } from "../useDashboardArrangement";

import { CELL_PLACEMENT_ATTRIBUTE, cellsOf } from "./cell-placement";
import { dragMessages } from "./drag-messages";
import { reflowTargetAt, reorderAround, type LaidOutCard } from "./reflow";
import type { CardFlip } from "./useCardFlip";

/** How far a pointer moves before a press on the handle becomes a drag, so a click stays one. */
const ACTIVATION_DISTANCE_PX = 5;

/** A card being dragged. */
export interface DragInProgress {
  placementId: string;
  title: string;
  /** Where it was picked up, among the drawn cards. */
  from: number;
  /** The cards' order as the grid draws it now: the held card where it would land. */
  order: readonly string[];
  /**
   * The grid's corner on the screen at pick-up. A pointer's position is read against this one,
   * never against the grid's corner now: dnd-kit's drag delta already counts any scrolling
   * since pick-up, so the grid's current corner would count that scrolling a second time.
   */
  origin: { left: number; top: number };
  gridWidth: number;
  /** The dashboard's width at pick-up; any other width cancels the drag (`useCancelOnResize`). */
  atWidth: number | undefined;
  /**
   * The card and half the held card was last moved beside, so a pointer resting on that half
   * as the cards settle moves nothing more.
   */
  last?: string;
  /** A picture of the card as it was picked up, drawn under the pointer. */
  ghost: HTMLElement | null;
}

export interface CardDrag {
  /** Whether cards can be dragged now: the dashboard is measured and wider than one column. */
  enabled: boolean;
  /** Whether the dashboard draws one column: every card full width, and dragging off. */
  oneColumn: boolean;
  /** The drag in progress, or none. */
  drag: DragInProgress | null;
  sensors: SensorDescriptor<SensorOptions>[];
  onDragStart: (event: DragStartEvent) => void;
  onDragMove: (event: DragMoveEvent) => void;
  onDragEnd: () => void;
  onDragCancel: () => void;
}

/**
 * Silent, because the dashboard speaks for the drag through its own region: dnd-kit's region
 * would read ids, and a second region would talk over the first.
 */
export const SILENT_DRAG: Announcements = {
  onDragStart: () => undefined,
  onDragMove: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

/** The pointer's position on the page, from where the drag started and how far it has gone. */
function pointerAt(event: DragMoveEvent): { x: number; y: number } | undefined {
  const start = event.activatorEvent;
  if (!("clientX" in start) || !("clientY" in start)) return undefined;
  const { clientX, clientY } = start as MouseEvent;
  return { x: clientX + event.delta.x, y: clientY + event.delta.y };
}

/**
 * The cards as the grid lays them out now, relative to its corner: from layout (`offset*`), which
 * a slide's transform does not move, so a card is where it is going. A cell not drawn (no offset
 * parent) is left out.
 */
function laidOutCards(grid: HTMLElement): LaidOutCard[] {
  const cards: LaidOutCard[] = [];
  for (const [id, cell] of cellsOf(grid)) {
    if (cell.offsetParent === null) continue;
    const left = cell.offsetLeft;
    const top = cell.offsetTop;
    cards.push({
      id,
      rect: {
        left,
        top,
        right: left + cell.offsetWidth,
        bottom: top + cell.offsetHeight,
      },
    });
  }
  return cards;
}

/**
 * A picture of a cell to drag under the pointer: a copy of it, with nothing a page or a test
 * could take for the card itself (ids, test ids, its placement, focus stops).
 */
function ghostOf(cell: HTMLElement): HTMLElement {
  const ghost = cell.cloneNode(true) as HTMLElement;
  for (const element of [ghost, ...ghost.querySelectorAll("*")]) {
    for (const name of [
      "id",
      "data-testid",
      CELL_PLACEMENT_ATTRIBUTE,
      "data-highlighted",
      "tabindex",
    ]) {
      element.removeAttribute(name);
    }
  }
  ghost.style.width = "100%";
  ghost.style.height = "100%";
  return ghost;
}

/**
 * Ends a drag the dashboard's width changed under: narrowed to one column, where dragging is
 * off, or to any other width, where the cards are laid out afresh and the place the reader was
 * aiming at moved. Either way the card stays where it was, and the reader is told.
 */
function useCancelOnResize(
  drag: DragInProgress | null,
  enabled: boolean,
  width: number | undefined,
  carrying: {
    setDrag: (next: DragInProgress | null) => void;
    say: (sentence: string) => void;
  }
): void {
  const { setDrag, say } = carrying;
  useEffect(() => {
    if (drag === null) return;
    if (!enabled) {
      setDrag(null);
      say(dragMessages.cancelledByNarrowing());
    } else if (width !== drag.atWidth) {
      setDrag(null);
      say(dragMessages.cancelledByResize());
    }
  }, [drag, enabled, width, setDrag, say]);
}

export function useCardDrag({
  rows,
  width,
  gridRef,
  flip,
  say,
  drop,
}: {
  /** The cards drawn, in order. */
  rows: readonly ArrangedWidget[];
  /** The dashboard's width, or `undefined` before it is measured. */
  width: number | undefined;
  gridRef: RefObject<HTMLElement | null>;
  /** Slides the cards to their new places as the order changes. */
  flip: CardFlip;
  /** Speak one sentence through the dashboard's region. */
  say: (sentence: string) => void;
  /** Put a card down at `final`, among the drawn cards, saying where it went. */
  drop: (placementId: string, final: number) => void;
}): CardDrag {
  const oneColumn = width !== undefined && isOneColumn(width);
  const enabled = width !== undefined && !oneColumn;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: ACTIVATION_DISTANCE_PX },
    })
  );

  // The state draws the grid; the ref answers the handlers, which can run more than once
  // before a render and must see the drag the last one left.
  const [drag, setDragState] = useState<DragInProgress | null>(null);
  const current = useRef<DragInProgress | null>(null);
  const setDrag = useCallback((next: DragInProgress | null) => {
    current.current = next;
    setDragState(next);
  }, []);

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const grid = gridRef.current;
      const placementId = String(event.active.id);
      const from = rows.findIndex(row => row.placementId === placementId);
      if (grid === null || width === undefined || from === -1) return;
      const box = grid.getBoundingClientRect();
      const cell = cellsOf(grid).get(placementId);
      const title = rows[from].widget.title;
      setDrag({
        placementId,
        title,
        from,
        order: rows.map(row => row.placementId),
        origin: { left: box.left, top: box.top },
        gridWidth: box.width,
        atWidth: width,
        // Taken before the card turns into its outline, so the picture is of the card.
        ghost: cell === undefined ? null : ghostOf(cell),
      });
      say(dragMessages.pickedUp(title));
    },
    [gridRef, rows, width, setDrag, say]
  );

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      const held = current.current;
      const grid = gridRef.current;
      const point = pointerAt(event);
      if (held === null || grid === null || point === undefined) return;
      // From the grid's corner at pick-up: the delta the point is built from already counts
      // scrolling since then, so the grid's corner now would count it twice.
      const target = reflowTargetAt(
        laidOutCards(grid),
        held.placementId,
        { x: point.x - held.origin.left, y: point.y - held.origin.top },
        held.gridWidth
      );
      if (target === undefined) return;
      const last = `${target.id}:${target.side}`;
      if (last === held.last) return;
      const order = reorderAround(held.order, held.placementId, target);
      if (order !== held.order) flip.capture();
      setDrag({ ...held, order, last });
    },
    [gridRef, flip, setDrag]
  );

  const onDragEnd = useCallback(() => {
    const held = current.current;
    if (held === null) return;
    setDrag(null);
    // Counted among the cards drawn now, in case one left the page while the card was held.
    const drawn = new Set(rows.map(row => row.placementId));
    const final = held.order
      .filter(id => drawn.has(id))
      .indexOf(held.placementId);
    if (final === -1 || final === held.from) {
      say(dragMessages.droppedInPlace(held.title));
    } else {
      drop(held.placementId, final);
    }
  }, [rows, setDrag, say, drop]);

  const onDragCancel = useCallback(() => {
    if (current.current === null) return;
    // Every card slides back to where it was.
    flip.capture();
    setDrag(null);
    say(dragMessages.cancelled());
  }, [flip, setDrag, say]);

  useCancelOnResize(drag, enabled, width, { setDrag, say });

  return {
    enabled,
    oneColumn,
    drag,
    sensors,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
  };
}
