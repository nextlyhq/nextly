"use client";

/**
 * Dragging a card by its handle: picked up, a line where it would land, put down on release.
 *
 * Nothing reflows while a card is held. The cards stay where they are drawn, the held one
 * dims, and a line says where it will land; the order changes once, on release. Live reflow
 * with cards of mixed widths reshuffles the rows under the pointer, so the place it is over
 * moves away from it.
 *
 * Two ways in, one set of answers. A pointer drags through dnd-kit's draggable primitive (its
 * activation distance, pointer capture and edge scrolling); the keyboard drives the same state
 * from the handle, stepping one place in list order per arrow. Both ask `drop-geometry` where
 * the card lands, and both put it down through the same `drop`, so a card dragged either way
 * ends up where the line said.
 *
 * Off while the dashboard draws one column: every card is full width there, a line could only
 * say "between these two", and touch dragging fights scrolling. The card menu moves cards at
 * every width. A drag in progress when the dashboard narrows is cancelled and says so.
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
  type Modifier,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { drawnSpan, drawnWidth, type DashboardBand } from "../../sizes";
import type { ArrangedWidget } from "../useDashboardArrangement";

import { DRAG_INSTRUCTIONS, dragMessages } from "./drag-messages";
import {
  dropLineFor,
  finalPositionAt,
  keyboardStep,
  type DrawnCard,
  type DropLine,
} from "./drop-geometry";

/** The attribute each cell carries its placement in, so a drag can measure the cards drawn. */
export const CELL_PLACEMENT_ATTRIBUTE = "data-placement-id";

/** How far a pointer moves before a press on the handle becomes a drag, so a click stays one. */
const ACTIVATION_DISTANCE_PX = 5;

/** A card being dragged, and the cards it is dragged among as they were drawn at pick-up. */
export interface DragInProgress {
  placementId: string;
  title: string;
  /** Where it is now, among the drawn cards. */
  from: number;
  /** Where it would land, counted among the others (`drop-geometry`). */
  final: number;
  by: "keyboard" | "pointer";
  /**
   * Measured once, at pick-up, relative to the grid. Nothing reflows during a drag, so the
   * rectangles hold for its whole length, and scrolling moves the grid with them.
   */
  cards: DrawnCard[];
  gridWidth: number;
}

export interface CardDrag {
  /** Whether cards can be dragged now: the dashboard is measured and wider than one column. */
  enabled: boolean;
  /** Whether the dashboard draws one column: every card full width, and dragging off. */
  oneColumn: boolean;
  /** The drag in progress, or none. */
  drag: DragInProgress | null;
  /** Where to draw the drop line, or none (no drag, or a drop that changes nothing). */
  line: DropLine | undefined;
  sensors: SensorDescriptor<SensorOptions>[];
  onDragStart: (event: DragStartEvent) => void;
  onDragMove: (event: DragMoveEvent) => void;
  onDragEnd: () => void;
  onDragCancel: () => void;
  /** A key pressed on a card's handle: Space or Enter picks up and drops, arrows move. */
  onHandleKeyDown: (placementId: string, event: KeyboardEvent) => void;
  /** Focus left a handle: a keyboard drag of its card ends there, unmoved. */
  onHandleBlur: (placementId: string) => void;
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

/** What dnd-kit reads to a screen reader on a handle: how to drag from the keyboard. */
export const DRAG_SCREEN_READER = { draggable: DRAG_INSTRUCTIONS };

/** The pointer's position on the page, from where the drag started and how far it has gone. */
function pointerAt(event: DragMoveEvent): { x: number; y: number } | undefined {
  const start = event.activatorEvent;
  if (!("clientX" in start) || !("clientY" in start)) return undefined;
  const { clientX, clientY } = start as MouseEvent;
  return { x: clientX + event.delta.x, y: clientY + event.delta.y };
}

/**
 * Puts the name chip at the pointer, rather than at the card's top-left corner where the
 * overlay would otherwise start: the chip names what is held, so it goes where the hand is.
 */
export const chipAtPointer: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (
    activatorEvent === null ||
    draggingNodeRect === null ||
    !("clientX" in activatorEvent)
  ) {
    return transform;
  }
  const { clientX, clientY } = activatorEvent as MouseEvent;
  return {
    ...transform,
    x: transform.x + clientX - draggingNodeRect.left,
    y: transform.y + clientY - draggingNodeRect.top,
  };
};

/**
 * The cards as drawn, relative to the grid, each with the span it is drawn at in `band`; or
 * `undefined` if any card is not on the page, since positions counted without one would put
 * the dragged card somewhere else.
 */
function measureCards(
  grid: HTMLElement,
  rows: readonly ArrangedWidget[],
  band: DashboardBand
): { cards: DrawnCard[]; gridWidth: number } | undefined {
  const box = grid.getBoundingClientRect();
  // Every cell at once, by its placement: one query rather than one per card.
  const cells = new Map<string, Element>();
  for (const cell of grid.querySelectorAll(`[${CELL_PLACEMENT_ATTRIBUTE}]`)) {
    const id = cell.getAttribute(CELL_PLACEMENT_ATTRIBUTE);
    if (id !== null) cells.set(id, cell);
  }
  const cards: DrawnCard[] = [];
  for (const row of rows) {
    const cell = cells.get(row.placementId);
    if (cell === undefined) return undefined;
    const rect = cell.getBoundingClientRect();
    cards.push({
      id: row.placementId,
      span: drawnSpan(drawnWidth(row.width, row.allowedWidths), band),
      rect: {
        left: rect.left - box.left,
        top: rect.top - box.top,
        right: rect.right - box.left,
        bottom: rect.bottom - box.top,
      },
    });
  }
  return { cards, gridWidth: box.width };
}

/** Whether a key picks a card up or puts it down. */
function isPickOrDrop(key: string): boolean {
  return key === " " || key === "Enter";
}

/**
 * What a key does to a card the keyboard is carrying, or nothing. A cancel's `consume` says
 * whether the key is kept from the page: Escape here ends the drag, not customise mode or a
 * dialog, while Tab still moves focus on and the drag ends where it was.
 */
type KeyOutcome =
  | { kind: "step"; final: number }
  | { kind: "drop" }
  | { kind: "cancel"; consume: boolean };

function keyOutcome(held: DragInProgress, key: string): KeyOutcome | undefined {
  const step = keyboardStep(held.final, key, held.cards.length);
  if (step !== undefined) return { kind: "step", final: step };
  if (isPickOrDrop(key)) return { kind: "drop" };
  if (key === "Escape") return { kind: "cancel", consume: true };
  if (key === "Tab") return { kind: "cancel", consume: false };
  return undefined;
}

/** What both ways of carrying a card share: the drag, and picking up, putting down, cancelling. */
interface Carrying {
  enabled: boolean;
  current: RefObject<DragInProgress | null>;
  setDrag: (next: DragInProgress | null) => void;
  pickUp: (
    placementId: string,
    by: DragInProgress["by"]
  ) => DragInProgress | null;
  finish: (held: DragInProgress) => void;
  cancel: () => void;
  say: (sentence: string) => void;
}

/** Says a card was picked up: by the keyboard, with where it is and how many there are. */
function announcePickUp(say: Carrying["say"], held: DragInProgress): void {
  say(dragMessages.pickedUp(held.title, held.from, held.cards.length, held.by));
}

/** The pointer's drag, through dnd-kit's events. */
function usePointerCarry(
  carrying: Carrying,
  gridRef: RefObject<HTMLElement | null>
): Pick<CardDrag, "onDragStart" | "onDragMove" | "onDragEnd" | "onDragCancel"> {
  const { current, setDrag, pickUp, finish, cancel, say } = carrying;
  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const held = pickUp(String(event.active.id), "pointer");
      if (held === null) return;
      setDrag(held);
      announcePickUp(say, held);
    },
    [pickUp, setDrag, say]
  );

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      const held = current.current;
      const point = pointerAt(event);
      const grid = gridRef.current;
      if (held?.by !== "pointer" || point === undefined || grid === null)
        return;
      // The grid's own corner, read again each move: the page may have scrolled under it.
      const box = grid.getBoundingClientRect();
      const final = finalPositionAt(
        held.cards,
        held.from,
        { x: point.x - box.left, y: point.y - box.top },
        held.gridWidth
      );
      if (final !== undefined && final !== held.final) {
        setDrag({ ...held, final });
      }
    },
    [current, gridRef, setDrag]
  );

  const onDragEnd = useCallback(() => {
    const held = current.current;
    if (held?.by === "pointer") finish(held);
  }, [current, finish]);

  const onDragCancel = useCallback(() => {
    if (current.current?.by === "pointer") cancel();
  }, [current, cancel]);

  return { onDragStart, onDragMove, onDragEnd, onDragCancel };
}

/** The keyboard's drag, from a card's handle. */
function useKeyboardCarry(
  carrying: Carrying
): Pick<CardDrag, "onHandleKeyDown" | "onHandleBlur"> {
  const { enabled, current, setDrag, pickUp, finish, cancel, say } = carrying;
  const carry = useCallback(
    (held: DragInProgress, event: KeyboardEvent) => {
      const outcome = keyOutcome(held, event.key);
      if (outcome === undefined) return;
      if (outcome.kind !== "cancel" || outcome.consume) event.preventDefault();
      if (outcome.kind === "step") {
        setDrag({ ...held, final: outcome.final });
        say(dragMessages.position(outcome.final, held.cards.length));
      } else if (outcome.kind === "drop") {
        finish(held);
      } else {
        if (outcome.consume) event.stopPropagation();
        cancel();
      }
    },
    [setDrag, say, finish, cancel]
  );

  const onHandleKeyDown = useCallback(
    (placementId: string, event: KeyboardEvent) => {
      if (!enabled) return;
      const held = current.current;
      if (held !== null) {
        // Only the card being carried, and only by the keyboard, answers its keys.
        if (held.placementId === placementId && held.by === "keyboard")
          carry(held, event);
        return;
      }
      if (!isPickOrDrop(event.key)) return;
      event.preventDefault();
      const next = pickUp(placementId, "keyboard");
      if (next === null) return;
      setDrag(next);
      announcePickUp(say, next);
    },
    [enabled, current, carry, pickUp, setDrag, say]
  );

  const onHandleBlur = useCallback(
    (placementId: string) => {
      const held = current.current;
      if (held?.by === "keyboard" && held.placementId === placementId) cancel();
    },
    [current, cancel]
  );

  return { onHandleKeyDown, onHandleBlur };
}

export function useCardDrag({
  rows,
  band,
  gridRef,
  say,
  drop,
}: {
  /** The cards drawn, in order. */
  rows: readonly ArrangedWidget[];
  /** The dashboard's band, or `undefined` before it is measured. */
  band: DashboardBand | undefined;
  gridRef: RefObject<HTMLElement | null>;
  /** Speak one sentence through the dashboard's region. */
  say: (sentence: string) => void;
  /** Put a card down at `final`, saying where it went. */
  drop: (placementId: string, final: number) => void;
}): CardDrag {
  const oneColumn = band === "narrow";
  const enabled = band !== undefined && !oneColumn;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: ACTIVATION_DISTANCE_PX },
    })
  );

  // The state draws the line; the ref answers the handlers, which can run twice before a
  // render (a Tab's keydown, then its blur) and must see the drag the first one ended.
  const [drag, setDragState] = useState<DragInProgress | null>(null);
  const current = useRef<DragInProgress | null>(null);
  const setDrag = useCallback((next: DragInProgress | null) => {
    current.current = next;
    setDragState(next);
  }, []);

  const pickUp = useCallback(
    (placementId: string, by: DragInProgress["by"]): DragInProgress | null => {
      const grid = gridRef.current;
      if (grid === null || band === undefined) return null;
      const measured = measureCards(grid, rows, band);
      const from = rows.findIndex(row => row.placementId === placementId);
      if (measured === undefined || from === -1) return null;
      return {
        placementId,
        title: rows[from].widget.title,
        from,
        final: from,
        by,
        ...measured,
      };
    },
    [gridRef, band, rows]
  );

  const finish = useCallback(
    (held: DragInProgress) => {
      setDrag(null);
      if (held.final === held.from)
        say(dragMessages.droppedInPlace(held.title));
      else drop(held.placementId, held.final);
    },
    [setDrag, say, drop]
  );

  const cancel = useCallback(() => {
    setDrag(null);
    say(dragMessages.cancelled());
  }, [setDrag, say]);

  // Narrowed to one column mid-drag: dragging is off there, so the card stays where it was.
  useEffect(() => {
    if (enabled || drag === null) return;
    setDrag(null);
    say(dragMessages.cancelledByNarrowing());
  }, [enabled, drag, setDrag, say]);

  const carrying: Carrying = {
    enabled,
    current,
    setDrag,
    pickUp,
    finish,
    cancel,
    say,
  };
  const pointer = usePointerCarry(carrying, gridRef);
  const keyboard = useKeyboardCarry(carrying);

  return {
    enabled,
    oneColumn,
    drag,
    line:
      drag === null
        ? undefined
        : dropLineFor(drag.cards, drag.from, drag.final, drag.gridWidth),
    sensors,
    ...pointer,
    ...keyboard,
  };
}
