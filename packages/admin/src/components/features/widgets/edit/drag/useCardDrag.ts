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

import { drawnSize, drawnSpan, isOneColumn } from "../../sizes";
import type { ArrangedWidget } from "../useDashboardArrangement";
import type { DashboardFocus } from "../useDashboardFocus";

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
   * rectangles hold for its whole length.
   */
  cards: DrawnCard[];
  gridWidth: number;
  /**
   * The grid's corner on the screen at pick-up. A pointer's position is read against this one,
   * never against the grid's corner now: dnd-kit's drag delta already counts any scrolling
   * since pick-up, so the grid's current corner would count that scrolling a second time.
   */
  origin: { left: number; top: number };
  /** The dashboard's width at pick-up; any other width cancels the drag (`useCancelOnResize`). */
  atWidth: number | undefined;
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
export const DRAG_SCREEN_READER: {
  draggable: string;
} = { draggable: DRAG_INSTRUCTIONS };

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
 * The cards as drawn, relative to the grid, each with the span it is drawn at on a dashboard
 * `dashboardWidth` wide; or
 * `undefined` if any card is not on the page, since positions counted without one would put
 * the dragged card somewhere else.
 */
function measureCards(
  grid: HTMLElement,
  rows: readonly ArrangedWidget[],
  dashboardWidth: number
): Pick<DragInProgress, "cards" | "gridWidth" | "origin"> | undefined {
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
    const size = drawnSize(row.size, row.widget.size);
    cards.push({
      id: row.placementId,
      span: drawnSpan(size.w, dashboardWidth),
      rows: size.h,
      rect: {
        left: rect.left - box.left,
        top: rect.top - box.top,
        right: rect.right - box.left,
        bottom: rect.bottom - box.top,
      },
    });
  }
  return {
    cards,
    gridWidth: box.width,
    origin: { left: box.left, top: box.top },
  };
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
  carrying: Carrying
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
      if (held?.by !== "pointer" || point === undefined) return;
      // From the grid's corner at pick-up: the delta the point is built from already counts
      // scrolling since then, so the grid's corner now would count it twice.
      const final = finalPositionAt(
        held.cards,
        held.from,
        { x: point.x - held.origin.left, y: point.y - held.origin.top },
        held.gridWidth
      );
      if (final !== undefined && final !== held.final) {
        setDrag({ ...held, final });
      }
    },
    [current, setDrag]
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

/**
 * Ends a drag the dashboard's width changed under: narrowed to one column, where dragging is
 * off, or to any other width, where the cards reflow and the rectangles measured at pick-up no
 * longer say where each one is. Either way the card stays where it was, and the reader is told.
 */
function useCancelOnResize(
  drag: DragInProgress | null,
  enabled: boolean,
  width: number | undefined,
  carrying: Pick<Carrying, "setDrag" | "say"> & {
    requestFocus: DashboardFocus["request"];
  }
): void {
  const { setDrag, say, requestFocus } = carrying;
  useEffect(() => {
    if (drag === null) return;
    if (!enabled) {
      setDrag(null);
      say(dragMessages.cancelledByNarrowing());
      // One column draws no handles, so the one a keyboard drag was on is gone with its focus.
      // The card's menu, which moves it at every width, is where the reader goes on from.
      if (drag.by === "keyboard")
        requestFocus({ kind: "menu", placementId: drag.placementId });
    } else if (width !== drag.atWidth) {
      setDrag(null);
      say(dragMessages.cancelledByResize());
    }
  }, [drag, enabled, width, setDrag, say, requestFocus]);
}

export function useCardDrag({
  rows,
  width,
  gridRef,
  say,
  drop,
  requestFocus,
}: {
  /** The cards drawn, in order. */
  rows: readonly ArrangedWidget[];
  /** The dashboard's width, or `undefined` before it is measured. */
  width: number | undefined;
  gridRef: RefObject<HTMLElement | null>;
  /** Speak one sentence through the dashboard's region. */
  say: (sentence: string) => void;
  /** Put a card down at `final`, saying where it went. */
  drop: (placementId: string, final: number) => void;
  /** Asks for focus: a keyboard drag goes on from its card's menu once its handle is gone. */
  requestFocus: DashboardFocus["request"];
}): CardDrag {
  const oneColumn = width !== undefined && isOneColumn(width);
  const enabled = width !== undefined && !oneColumn;
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
      if (grid === null || width === undefined) return null;
      const measured = measureCards(grid, rows, width);
      const from = rows.findIndex(row => row.placementId === placementId);
      if (measured === undefined || from === -1) return null;
      return {
        placementId,
        title: rows[from].widget.title,
        from,
        final: from,
        by,
        ...measured,
        atWidth: width,
      };
    },
    [gridRef, width, rows]
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

  useCancelOnResize(drag, enabled, width, { setDrag, say, requestFocus });

  const carrying: Carrying = {
    enabled,
    current,
    setDrag,
    pickUp,
    finish,
    cancel,
    say,
  };
  const pointer = usePointerCarry(carrying);
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
