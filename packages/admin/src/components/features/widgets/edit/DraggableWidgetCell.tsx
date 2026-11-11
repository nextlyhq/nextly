"use client";

/**
 * One grid cell, draggable by its handle and resizable by its right edge while the reader is
 * customising.
 *
 * A component rather than a branch inside the grid's map, because `useDraggable` is a hook and a
 * hook cannot be called from a loop body. That constraint is also the right shape: the cell owns
 * its own drag wiring, and the grid stays a list of cells.
 *
 * ## Drag is the SECOND way to move or size a card, never the only one
 *
 * The moves in each card's menu (`CardActionsMenu`) and the width in its settings drawer are what
 * satisfy WCAG 2.2 SC 2.5.7, which requires a single-pointer alternative to every dragging
 * movement, and they are the keyboard's way too. They work at every width; the handle is drawn
 * wherever the dashboard shows more than one column, and the edge from 1,024px. Both are for a
 * pointer, so neither is a stop for Tab or a thing a screen reader reads out.
 *
 * ## The handle stands where the card's header leads
 *
 * Left of the title, in the header's leading slot, which the card keeps clear for it
 * (`CardHandleSpace`), so it adds no row. It is drawn over the card rather than inside it because
 * the card's own content is out of reach while customising (`CustomizingFence`), and the handle
 * must not be. The handle carries the drag rather than the whole cell, so the card's menu stays
 * pressable.
 *
 * ## While held
 *
 * The cell keeps its place in the grid as an outline of its own size, and a picture of the card
 * follows the pointer (`CardDragContext`); the other cards move aside as it goes (`useCardDrag`).
 *
 * @module components/features/widgets/edit/DraggableWidgetCell
 */

import { useDraggable } from "@dnd-kit/core";
import {
  useCallback,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  type JSX,
} from "react";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { widthPercent } from "../sizes";

import { CELL_PLACEMENT_ATTRIBUTE } from "./drag/cell-placement";
import type { CardEdge } from "./drag/useCardResize";

/** What the cell's handle does, while dragging is on. */
export interface CellDrag {
  /** The card is the one being dragged: drawn as the outline of where it will land. */
  held: boolean;
}

/** The cell's right edge, where a card's width can be dragged. */
export interface CellResize {
  edge: CardEdge;
  /** The width the card is drawn at while its edge is held, in columns; absent otherwise. */
  resizingTo?: number;
}

export interface DraggableWidgetCellProps {
  id: string;
  isEditing: boolean;
  /**
   * The drag, while it is on. Absent at one column, where the handle is not drawn at all and
   * the card menu moves the card.
   */
  drag?: CellDrag;
  /** The edge, where the card's width can be dragged; absent where it cannot. */
  resize?: CellResize;
  /** The card just placed (moved, resized, added or put back): ringed so the reader sees it. */
  highlighted?: boolean;
  className?: string;
  /** The cell's own style: the height it holds while its card loads (`frame/held-height`). */
  style?: CSSProperties;
  /** Where the cell's element is kept, for whatever measures it. */
  cellRef?: RefObject<HTMLDivElement | null>;
  "data-testid"?: string;
  children: ReactNode;
}

/** The attribute the held card's outline carries, which the cell's hiding of its card spares. */
const OUTLINE_ATTRIBUTE = "data-cell-outline";

/**
 * The handle, over the card's header where the title leads. `left-2 top-5` within the card's
 * border (`inset-px`) is where the header's padding, less the leading slot's pull to the left,
 * puts the room the header keeps for it, as `CardControlsOverlay` does the menu at its other end.
 */
function DragHandle({
  setHandle,
  listeners,
}: {
  setHandle: (element: HTMLElement | null) => void;
  listeners: ReturnType<typeof useDraggable>["listeners"];
}) {
  return (
    <div className="pointer-events-none absolute inset-px z-10">
      <span
        ref={setHandle}
        {...listeners}
        aria-hidden
        title="Drag to move"
        data-testid="widget-drag-handle"
        // `cursor-grab`, not `cursor-move`: this reorders within a list, it does not move the
        // card to an arbitrary point. `touch-none` on the handle alone: a finger on it drags,
        // a finger anywhere else on the page still scrolls it.
        className="pointer-events-auto absolute left-2 top-5 flex h-7 w-6 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
      >
        <Icons.GripVertical className="size-4" />
      </span>
    </div>
  );
}

/**
 * The card's right edge: a strip astride the gap beside the card, where the pointer resizes it,
 * marked with a bar while the pointer is over the card or the edge is held.
 */
function ResizeEdge({ edge }: { edge: CardEdge }) {
  return (
    <div
      aria-hidden
      title="Drag to resize"
      data-testid="widget-resize-edge"
      onPointerDown={edge.onPointerDown}
      onPointerMove={edge.onPointerMove}
      onPointerUp={edge.onPointerUp}
      onPointerCancel={edge.onPointerCancel}
      className="absolute -right-3 bottom-2.5 top-2.5 z-20 flex w-6 cursor-ew-resize touch-none items-center justify-center"
    >
      <span className="h-9 w-1 rounded-full bg-control-border opacity-0 transition-opacity group-hover/cell:opacity-100 group-data-[resizing]/cell:opacity-100 motion-reduce:transition-none" />
    </div>
  );
}

/** The width the card is at while its edge is held, above its top right corner. */
function WidthTip({ w }: { w: number }) {
  return (
    <span
      aria-hidden
      data-testid="widget-resize-width"
      className="pointer-events-none absolute -top-[30px] right-0 z-30 whitespace-nowrap rounded-md bg-primary px-2 py-[3px] font-mono text-xs tabular-nums text-primary-foreground shadow-sm"
    >
      {widthPercent(w)}
    </span>
  );
}

export function DraggableWidgetCell({
  id,
  isEditing,
  drag,
  resize,
  highlighted = false,
  className,
  style,
  cellRef,
  "data-testid": testId,
  children,
}: DraggableWidgetCellProps): JSX.Element {
  const draggable = isEditing && drag !== undefined;
  const held = draggable && drag.held;
  const resizingTo = isEditing ? resize?.resizingTo : undefined;
  const { listeners, setNodeRef, setActivatorNodeRef } = useDraggable({
    id,
    disabled: !draggable,
  });

  // One element, two registrations: dnd-kit's node, and the cell's own ref for what measures it.
  const setCell = useCallback(
    (element: HTMLDivElement | null) => {
      setNodeRef(element);
      if (cellRef) cellRef.current = element;
    },
    [setNodeRef, cellRef]
  );

  return (
    <div
      ref={setCell}
      // A place to land, focusable only programmatically: the header's summary
      // sends focus to the card a part names.
      tabIndex={-1}
      data-testid={testId}
      {...{ [CELL_PLACEMENT_ATTRIBUTE]: id }}
      data-highlighted={highlighted || undefined}
      data-held={held || undefined}
      data-resizing={resizingTo === undefined ? undefined : true}
      style={style}
      className={cn(
        className,
        "group/cell rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
        // Ringed in the primary colour, offset from the card so it reads in both schemes. It
        // fades in only where motion is welcome; with reduced motion it simply appears.
        highlighted &&
          !held &&
          "rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300",
        // The held card keeps its place and its size, drawn as its outline only: the card
        // itself is under the pointer. Spelled out in full, not built from `OUTLINE_ATTRIBUTE`:
        // Tailwind generates only the classes it finds written in the source.
        held && "[&>:not([data-cell-outline])]:invisible"
      )}
    >
      {draggable ? (
        <DragHandle setHandle={setActivatorNodeRef} listeners={listeners} />
      ) : null}
      {children}
      {held ? (
        <div
          aria-hidden
          {...{ [OUTLINE_ATTRIBUTE]: "" }}
          data-testid="widget-drop-outline"
          className="pointer-events-none absolute inset-0 rounded-lg border-[1.5px] border-dashed border-control-border"
        />
      ) : null}
      {resize !== undefined && isEditing && !held ? (
        <ResizeEdge edge={resize.edge} />
      ) : null}
      {resizingTo === undefined ? null : <WidthTip w={resizingTo} />}
    </div>
  );
}
